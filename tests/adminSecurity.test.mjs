/**
 * Tab-scoped admin sessions and permanent project deletion (fake storage / fake Supabase;
 * nothing touches a real database). Run: npm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let S, A, M, Auth
before(async () => {
  ;[S, A, M, Auth] = await loadModules(['/src/lib/authStorage.ts', '/src/admin/content/api.ts', '/src/admin/content/model.ts', '/src/admin/adminAuth.ts'])
})
after(closeModules)

const quiet = async (fn) => {
  const w = console.warn
  console.warn = () => {}
  try { return await fn() } finally { console.warn = w }
}

function fakeStorage(entries = {}, { broken = false } = {}) {
  const m = new Map(Object.entries(entries))
  const guard = () => { if (broken) throw new Error('SecurityError') }
  return {
    map: m,
    get length() { guard(); return m.size },
    key: (i) => { guard(); return [...m.keys()][i] ?? null },
    getItem: (k) => { guard(); return m.has(k) ? m.get(k) : null },
    setItem: (k, v) => { guard(); m.set(k, String(v)) },
    removeItem: (k) => { guard(); m.delete(k) },
  }
}

// ---------------------------------------------------------------------------- sessions

describe('tab-scoped session storage', () => {
  test('uses the tab’s sessionStorage (refresh keeps it; a new tab has its own, empty one)', () => {
    const tab = fakeStorage()
    const st = S.tabScopedStorage(tab)
    st.setItem('sb-abc-auth-token', '{"access_token":"t"}')
    assert.equal(tab.map.get('sb-abc-auth-token'), '{"access_token":"t"}', 'written to sessionStorage')
    assert.equal(S.tabScopedStorage(tab).getItem('sb-abc-auth-token'), '{"access_token":"t"}', 'same tab after a refresh')
    assert.equal(S.tabScopedStorage(fakeStorage()).getItem('sb-abc-auth-token'), null, 'a fresh tab starts signed out')
    st.removeItem('sb-abc-auth-token')
    assert.equal(tab.map.size, 0, 'sign-out removes it')
  })

  test('blocked or missing sessionStorage → memory only, never a persistent fallback', () => {
    for (const s of [undefined, fakeStorage({}, { broken: true })]) {
      const st = S.tabScopedStorage(s)
      st.setItem('sb-abc-auth-token', 'x')
      assert.equal(st.getItem('sb-abc-auth-token'), 'x')
      assert.equal(S.tabScopedStorage(s).getItem('sb-abc-auth-token'), null, 'a reload starts signed out')
    }
  })

  test('old persistent sessions (localStorage) are removed; other keys kept', () => {
    const legacy = fakeStorage({
      'sb-abcdefghijklmnopqrst-auth-token': '{"refresh_token":"old"}',
      'sb-abcdefghijklmnopqrst-auth-token-code-verifier': 'v',
      'sb-abcdefghijklmnopqrst-auth-token-user': 'u',
      theme: 'dark',
      'my-auth-token': 'not supabase',
    })
    assert.equal(S.removeSessionKeys(legacy), 3)
    assert.deepEqual([...legacy.map.keys()].sort(), ['my-auth-token', 'theme'])
    assert.equal(S.removeSessionKeys(fakeStorage({}, { broken: true })), 0, 'blocked storage: no crash')
    assert.equal(S.removeSessionKeys(undefined), 0)
  })

  test('sign-out clearing covers the tab session and any old persistent copy', () => {
    const tab = fakeStorage({ 'sb-x1-auth-token': 'a' })
    const legacy = fakeStorage({ 'sb-x1-auth-token': 'b', keep: '1' })
    Auth.clearStoredSession(tab, legacy)
    assert.equal(tab.map.size, 0)
    assert.deepEqual([...legacy.map.keys()], ['keep'])
  })
})

// ---------------------------------------------------------------------------- deletion

describe('delete confirmation rule', () => {
  test('exact title (case/spaces ignored) or DELETE; anything else is refused', () => {
    const title = 'Demo Project 2'
    for (const ok of ['Demo Project 2', ' demo project 2 ', 'DELETE']) assert.equal(M.deleteConfirmed(ok, title), true, ok)
    for (const bad of ['', 'Demo Project', 'delete', 'Delete', 'Demo Project 2!', 'yes']) assert.equal(M.deleteConfirmed(bad, title), false, bad)
    assert.equal(M.deleteConfirmed('', ''), false, 'an empty title never matches empty input')
  })
})

/** Fake client that records the delete request and answers as scripted. */
function fakeClient({ del = { data: [], error: null }, get = { data: null, error: null }, hang = false } = {}) {
  const calls = []
  return {
    calls,
    storage: { from: () => { throw new Error('Storage must not be used by project deletion') } },
    from(table) {
      const q = { table, op: 'select', filters: [], cols: null }
      calls.push(q)
      const b = {
        delete() { q.op = 'delete'; return b },
        select(cols) { q.cols = cols; return b },
        eq(c, v) { q.filters.push([c, v]); return b },
        maybeSingle() { return b },
        retry() { return Promise.resolve(get) },
        then(res, rej) { return (hang ? new Promise(() => {}) : Promise.resolve(del)).then(res, rej) },
      }
      return b
    },
  }
}

const project = { id: '00000000-0000-4000-8000-000000000042', updated_at: '2026-11-22T10:00:00.123456+00:00', title: 'Demo', status: 'draft' }

describe('deleteProjectRow', () => {
  test('deletes exactly the selected row: projects table, its id AND its loaded updated_at', async () => {
    const sb = fakeClient({ del: { data: [{ id: project.id }], error: null } })
    assert.deepEqual(await A.deleteProjectRow(sb, project), { kind: 'deleted', id: project.id })
    assert.equal(sb.calls.length, 1)
    const q = sb.calls[0]
    assert.equal(q.table, 'projects')
    assert.equal(q.op, 'delete')
    assert.deepEqual(q.filters, [['id', project.id], ['updated_at', project.updated_at]], 'never an unfiltered delete')
    assert.equal(q.cols, 'id', 'the deleted row is requested back')
  })

  test('refuses to send without an id / updated_at (could never be a table-wide delete)', async () => {
    for (const p of [{ id: '', updated_at: 'x' }, { id: 'x', updated_at: '' }, {}]) {
      const sb = fakeClient()
      assert.equal((await A.deleteProjectRow(sb, p)).kind, 'error')
      assert.equal(sb.calls.length, 0)
    }
  })

  test('zero rows: changed since loaded → conflict; already gone → gone; unchanged → denied (RLS)', async () => {
    const newer = { ...project, updated_at: '2026-11-22T11:00:00+00:00', title: 'Demo (edited)' }
    assert.deepEqual(await A.deleteProjectRow(fakeClient({ get: { data: newer, error: null } }), project), { kind: 'conflict', latest: newer })
    assert.deepEqual(await A.deleteProjectRow(fakeClient({ get: { data: null, error: null } }), project), { kind: 'gone' })
    assert.deepEqual(await A.deleteProjectRow(fakeClient({ get: { data: project, error: null } }), project), { kind: 'denied' })
  })

  test('errors: permission, expired session, network, timeout, unexpected', async () => {
    const del = (error) => quiet(() => A.deleteProjectRow(fakeClient({ del: { data: null, error } }), project))
    assert.equal((await del({ code: '42501', message: 'permission denied for table projects' })).kind, 'denied')
    assert.equal((await del({ code: 'PGRST301', message: 'JWT expired' })).kind, 'expired')
    assert.equal((await del({ code: '', message: 'TypeError: Failed to fetch' })).kind, 'unconfirmed')
    assert.equal((await del({ code: 'XX000', message: 'boom' })).kind, 'error')
    assert.equal((await quiet(() => A.deleteProjectRow(fakeClient({ hang: true }), project, 20))).kind, 'unconfirmed', 'timeout after sending')
    assert.equal((await A.deleteProjectRow(fakeClient({ del: { data: [{ id: 'a' }, { id: 'b' }], error: null } }), project)).kind, 'error', 'more than one row is never success')
    assert.equal((await A.deleteProjectRow(fakeClient({ del: { data: [{ id: 'other' }], error: null } }), project)).kind, 'error', 'a different row back is not success')
    for (const m of Object.values(A.DELETE_MESSAGES)) assert.ok(!/permission denied|JWT|constraint "/.test(m))
  })

  test('never touches Storage (the screenshot stays in the Media Library)', async () => {
    // The fake throws if storage is used at all.
    await A.deleteProjectRow(fakeClient({ del: { data: [{ id: project.id }], error: null } }), { ...project, image_path: 'projects/demo.png' })
  })
})
