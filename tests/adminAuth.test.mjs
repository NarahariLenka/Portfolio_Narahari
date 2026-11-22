/**
 * Admin panel (Phase A): routing, sign-in error handling and the admin check, against a
 * fake Supabase client (no network). Run: npm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let Auth, Route
before(async () => {
  ;[Auth, Route] = await loadModules(['/src/admin/adminAuth.ts', '/src/admin/route.ts'])
})
after(closeModules)

const USER = { id: '00000000-0000-4000-8000-000000000001', email: 'owner@example.test' }
const NET = { message: 'TypeError: Failed to fetch', code: '', details: '', hint: '' }

/** Minimal stand-in for the parts of supabase-js the admin uses. */
function fakeClient({ session = true, user = USER, userError = null, sessionError = null, row = { user_id: USER.id }, rowError = null, signInError = null, hang = null } = {}) {
  const calls = { signOut: 0, signIn: 0, queries: [] }
  const slow = (step, value) => (hang === step ? new Promise(() => {}) : Promise.resolve(value))
  const query = {
    select(cols) { calls.queries.push(['select', cols]); return this },
    eq(col, val) { calls.queries.push(['eq', col, val]); return this },
    maybeSingle() { return this },
    retry() { return slow('row', { data: rowError ? null : row, error: rowError }) },
  }
  return {
    calls,
    auth: {
      getSession: () => slow('session', { data: { session: session ? { access_token: 'x' } : null }, error: sessionError }),
      getUser: () => slow('user', { data: { user: userError ? null : user }, error: userError }),
      signInWithPassword: (creds) => { calls.signIn++; calls.creds = creds; return slow('signIn', { data: {}, error: signInError }) },
      signOut: () => { calls.signOut++; return Promise.resolve({ error: null }) },
    },
    from(table) { calls.queries.push(['from', table]); return query },
  }
}

describe('route', () => {
  test('only #admin opens the admin panel', () => {
    for (const h of ['#admin', '#ADMIN', '#Admin']) assert.equal(Route.isAdminRoute(h), true, h)
    for (const h of ['', '#', '#about', '#admin/', '#administrator', '#/admin', 'admin']) assert.equal(Route.isAdminRoute(h), false, h)
  })
})

describe('verifyAdmin', () => {
  test('admin: session accepted by the server and own row returned', async () => {
    const sb = fakeClient()
    assert.deepEqual(await Auth.verifyAdmin(sb), { kind: 'admin', userId: USER.id, email: USER.email })
    assert.deepEqual(sb.calls.queries, [['from', 'admins'], ['select', 'user_id'], ['eq', 'user_id', USER.id]])
  })

  test('no session → signed out, without asking the server', async () => {
    const sb = fakeClient({ session: false })
    assert.deepEqual(await Auth.verifyAdmin(sb), { kind: 'signedOut' })
    assert.equal(sb.calls.queries.length, 0)
  })

  test('signed in but not in public.admins → unauthorized', async () => {
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ row: null })), { kind: 'unauthorized' })
    // A row for someone else can't be returned under RLS; treated as unauthorized anyway.
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ row: { user_id: 'other' } })), { kind: 'unauthorized' })
  })

  test('session rejected by the server → expired', async () => {
    const r = await Auth.verifyAdmin(fakeClient({ userError: { name: 'AuthApiError', status: 403, code: 'session_not_found', message: 'Session not found' } }))
    assert.deepEqual(r, { kind: 'expired' })
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ userError: { name: 'AuthSessionMissingError', status: 400 } })), { kind: 'expired' })
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ rowError: { code: 'PGRST301', message: 'JWT expired' } })), { kind: 'expired' })
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ sessionError: { name: 'AuthApiError', status: 400, code: 'refresh_token_not_found' } })), { kind: 'expired' })
  })

  test('network failures → failed (network), never "unauthorized"', async () => {
    const net = { kind: 'failed', reason: 'network' }
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ userError: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' } })), net)
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ rowError: NET })), net)
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ sessionError: { name: 'AuthRetryableFetchError', status: 0 } })), net)
    for (const step of ['session', 'user', 'row']) assert.deepEqual(await Auth.verifyAdmin(fakeClient({ hang: step }), 20), net, `timeout at ${step}`)
  })

  test('other database errors → failed (unknown)', async () => {
    assert.deepEqual(await Auth.verifyAdmin(fakeClient({ rowError: { code: '42501', message: 'permission denied for table admins' } })), { kind: 'failed', reason: 'unknown' })
  })

  test('a throwing client never escapes', async () => {
    const sb = fakeClient()
    sb.auth.getSession = () => { throw new Error('boom') }
    assert.deepEqual(await Auth.verifyAdmin(sb), { kind: 'failed', reason: 'unknown' })
  })
})

describe('signIn', () => {
  test('success; email is trimmed, password passed as typed', async () => {
    const sb = fakeClient()
    assert.deepEqual(await Auth.signIn(sb, '  owner@example.test ', ' pw '), { ok: true })
    assert.deepEqual(sb.calls.creds, { email: 'owner@example.test', password: ' pw ' })
  })

  test('missing fields never reach Supabase', async () => {
    const sb = fakeClient()
    for (const [e, p] of [['', 'x'], ['  ', 'x'], ['a@b.c', '']]) assert.deepEqual(await Auth.signIn(sb, e, p), { ok: false, problem: 'missing' })
    assert.equal(sb.calls.signIn, 0)
  })

  test('errors are mapped to safe messages', async () => {
    const cases = [
      [{ name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' }, 'invalid'],
      [{ name: 'AuthApiError', status: 400, message: 'Invalid login credentials' }, 'invalid'],
      [{ name: 'AuthApiError', status: 400, code: 'email_not_confirmed' }, 'unconfirmed'],
      [{ name: 'AuthApiError', status: 429, code: 'over_request_rate_limit' }, 'rateLimited'],
      [{ name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' }, 'network'],
      [{ name: 'AuthApiError', status: 500, code: 'unexpected_failure', message: 'internal detail' }, 'unknown'],
    ]
    for (const [error, problem] of cases) {
      assert.deepEqual(await Auth.signIn(fakeClient({ signInError: error }), 'a@b.c', 'pw'), { ok: false, problem }, JSON.stringify(error))
      assert.equal(typeof Auth.SIGN_IN_MESSAGES[problem], 'string')
      assert.ok(!Auth.SIGN_IN_MESSAGES[problem].includes('internal detail'))
    }
    assert.deepEqual(await Auth.signIn(fakeClient({ hang: 'signIn' }), 'a@b.c', 'pw', 20), { ok: false, problem: 'network' })
  })

  test('nothing secret is logged', async () => {
    const logged = []
    const warn = console.warn
    console.warn = (...a) => logged.push(JSON.stringify(a))
    try {
      await Auth.signIn(fakeClient({ signInError: { name: 'AuthApiError', status: 400, code: 'invalid_credentials', message: 'Invalid login credentials' } }), 'owner@example.test', 'hunter2-secret')
      await Auth.verifyAdmin(fakeClient({ rowError: { code: 'PGRST301', message: 'JWT expired eyJhbGciOi.token' } }))
    } finally {
      console.warn = warn
    }
    const all = logged.join('\n')
    assert.ok(logged.length >= 2)
    for (const s of ['hunter2-secret', 'owner@example.test', 'eyJhbGciOi']) assert.ok(!all.includes(s), s)
  })
})

/** In-memory Storage with the parts clearStoredSession uses. */
function fakeStorage(entries) {
  const m = new Map(Object.entries(entries))
  return { get length() { return m.size }, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => m.delete(k), keys: () => [...m.keys()].sort() }
}

describe('signOut', () => {
  const quiet = async (fn) => {
    const warn = console.warn
    console.warn = () => {}
    try { return await fn() } finally { console.warn = warn }
  }

  test('confirmed by the server → "server", using local scope (this browser’s session only)', async () => {
    const sb = fakeClient()
    let scope
    sb.auth.signOut = (o) => { scope = o?.scope; return Promise.resolve({ error: null }) }
    assert.equal(await Auth.signOut(sb), 'server')
    assert.equal(scope, 'local')
  })

  test('server unreachable, rejected or slow → "localOnly", never throws', async () => {
    for (const impl of [
      () => Promise.reject(new Error('offline')),
      () => Promise.resolve({ error: { name: 'AuthRetryableFetchError', status: 0 } }),
      () => { throw new Error('sync boom') },
    ]) {
      const sb = fakeClient()
      sb.auth.signOut = impl
      assert.equal(await quiet(() => Auth.signOut(sb)), 'localOnly')
    }
  })

  test('clearStoredSession removes only Supabase session keys', () => {
    const s = fakeStorage({
      'sb-abcdefghijklmnopqrst-auth-token': '{"access_token":"x"}',
      'sb-abcdefghijklmnopqrst-auth-token-code-verifier': 'v',
      'theme': 'dark',
      'sb-other-setting': '1',
      'my-auth-token': 'not supabase',
    })
    Auth.clearStoredSession(s)
    assert.deepEqual(s.keys(), ['my-auth-token', 'sb-other-setting', 'theme'])
    Auth.clearStoredSession(undefined) // no storage available: no crash
    Auth.clearStoredSession({ get length() { throw new Error('blocked') } })
  })
})

describe('the admin code never stores credentials', () => {
  test('no storage writes in src/admin (only Supabase’s own session key, written by supabase-js)', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const dir = new URL('../src/admin/', import.meta.url)
    for (const f of readdirSync(dir).filter((n) => /\.(ts|tsx)$/.test(n))) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      // Removing Supabase's session keys (sign-out) is allowed; writing anything is not.
      assert.ok(!/\.setItem\(|indexedDB|document\.cookie/.test(src), `${f} writes to browser storage`)
    }
  })
})
