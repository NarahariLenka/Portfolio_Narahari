/**
 * Phase B — settings infrastructure: JSON path edits and sizes, record validation,
 * saved/draft state, load/save against a fake Supabase client (no network), previews.
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let J, S, D, A, P
before(async () => {
  ;[J, S, D, A, P] = await loadModules([
    '/src/admin/settings/json.ts',
    '/src/admin/settings/schema.ts',
    '/src/admin/settings/draft.ts',
    '/src/admin/settings/api.ts',
    '/src/admin/settings/preview.ts',
  ])
})
after(closeModules)

const quiet = async (fn) => {
  const warn = console.warn
  console.warn = () => {}
  try { return await fn() } finally { console.warn = warn }
}

const RECORD = () => ({
  id: 1,
  site_title: 'Narahari Lenka — Portfolio',
  meta_description: null,
  owner_name: 'Narahari Lenka',
  location: null,
  footer_copyright: null,
  footer_signoff: null,
  footer_back_to_top: null,
  ui_labels: { githubLink: 'GitHub', futureLabel: 'kept' },
  appearance: {},
  animation: {
    version: 1,
    global: { enabled: true, speed: 1.5 },
    animations: {
      themeInkTransition: { desktop: { durationMs: 2000 }, mobile: { swirl: 1 }, futureFlag: 'x' },
      contactDotField: { enabled: false },
      someFutureAnimation: { enabled: true },
    },
    futureTopLevel: { a: 1 },
  },
  backgrounds: { experimental: true },
  updated_at: '2026-11-22T10:00:00.123456+00:00',
})

// ---------------------------------------------------------------------------- fake client

function fakeClient({ read = [], update = null, hang = null } = {}) {
  // `read` is a queue of responses for successive reads.
  const calls = { reads: 0, updates: [], filters: [] }
  const slow = (step, v) => (hang === step ? new Promise(() => {}) : Promise.resolve(v))
  const next = () => read[Math.min(calls.reads++, read.length - 1)]
  return {
    calls,
    from(table) {
      calls.table = table
      const q = {
        _mode: 'read',
        select(cols) { calls.select = cols; return this },
        eq(col, val) { calls.filters.push([this._mode, col, val]); return this },
        maybeSingle() { return this },
        retry() { return slow('read', next()) },
        update(patch) { this._mode = 'update'; calls.updates.push(JSON.parse(JSON.stringify(patch))); return this },
        then(res, rej) { return slow('update', typeof update === 'function' ? update(calls) : update).then(res, rej) },
      }
      return q
    },
  }
}

// ---------------------------------------------------------------------------- json

describe('json helpers', () => {
  test('setPath / deletePath never mutate and prune empty containers', () => {
    const base = { a: { b: 1 }, keep: true }
    const set = J.setPath(base, ['x', 'y', 'z'], 5)
    assert.deepEqual(base, { a: { b: 1 }, keep: true })
    assert.deepEqual(set, { a: { b: 1 }, keep: true, x: { y: { z: 5 } } })
    assert.deepEqual(J.deletePath(set, ['x', 'y', 'z']), base, 'set then reset gives back the original')
    assert.deepEqual(J.deletePath(base, ['nope', 'deeper']), base)
    assert.deepEqual(J.deletePath({ a: {} }, ['a', 'b']), { a: {} }, 'existing empty objects are not touched')
  })

  test('prototype keys are refused and never followed', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) {
      assert.throws(() => J.setPath({}, [k, 'polluted'], true))
      assert.throws(() => J.deletePath({ a: 1 }, [k]))
    }
    assert.equal(J.getPath({}, ['constructor']), undefined)
    assert.equal(({}).polluted, undefined)
  })

  test('diffLeaves + applyLeaves re-apply changes on another base', () => {
    const from = { a: 1, b: { c: 2, d: 3 } }
    const to = { a: 1, b: { c: 9 }, e: [1, 2] }
    const changes = J.diffLeaves(from, to)
    assert.deepEqual(J.applyLeaves(from, changes), to)
    const other = { a: 7, b: { c: 2, d: 3, z: 'new' }, q: 1 }
    assert.deepEqual(J.applyLeaves(other, changes), { a: 7, b: { c: 9, z: 'new' }, q: 1, e: [1, 2] })
  })

  test('jsonbTextBytes matches PostgreSQL jsonb::text output', () => {
    // Expected strings are what PostgreSQL prints for these values (spaces after , and :).
    const cases = [
      [{}, '{}'],
      [[], '[]'],
      [{ a: 1, b: [1, 2] }, '{"a": 1, "b": [1, 2]}'],
      [{ t: true, f: false, n: null }, '{"f": false, "n": null, "t": true}'],
      [{ s: 'é"\\\n' }, '{"s": "é\\"\\\\\\n"}'],
      [{ ctl: '\u0001' }, '{"ctl": "\\u0001"}'],
      [{ x: 0.18 }, '{"x": 0.18}'],
      [{ big: 1e21 }, '{"big": 1000000000000000000000}'],
      [{ tiny: 1.5e-7 }, '{"tiny": 0.00000015}'],
      [{ emoji: '🎨' }, '{"emoji": "🎨"}'],
    ]
    for (const [value, pg] of cases) assert.equal(J.jsonbTextBytes(value), Buffer.byteLength(pg, 'utf8'), pg)
    // JSON.stringify undercounts: the database limit must not be checked with it.
    const v = { a: [1, 2, 3], b: { c: 'd' } }
    assert.ok(J.jsonbTextBytes(v) > JSON.stringify(v).length)
  })
})

// ---------------------------------------------------------------------------- schema

describe('record and column rules', () => {
  test('parseRecord accepts the real shape and rejects malformed rows', () => {
    assert.ok(S.parseRecord(RECORD()))
    const bad = [null, [], 'x', { ...RECORD(), id: 2 }, { ...RECORD(), updated_at: null }, { ...RECORD(), site_title: null },
      { ...RECORD(), meta_description: 5 }, { ...RECORD(), animation: [] }, { ...RECORD(), ui_labels: null }, { ...RECORD(), backgrounds: 'x' }]
    for (const b of bad) assert.equal(S.parseRecord(b), null, JSON.stringify(b)?.slice(0, 60))
  })

  test('selects only the columns the admin needs', () => {
    assert.equal(S.SELECT_COLUMNS.split(',').includes('created_at'), false)
    for (const c of ['id', 'updated_at', 'animation', 'appearance', 'backgrounds', 'ui_labels', 'site_title']) assert.ok(S.SELECT_COLUMNS.split(',').includes(c), c)
  })

  test('text limits count characters like PostgreSQL (code points) and enforce NOT NULL', () => {
    assert.deepEqual(S.columnProblems({ site_title: 'x'.repeat(120) }), [])
    assert.equal(S.columnProblems({ site_title: 'x'.repeat(121) }).length, 1)
    assert.deepEqual(S.columnProblems({ footer_back_to_top: '🚀'.repeat(40) }), [], '40 emoji = 40 characters (80 UTF-16 units)')
    assert.equal(S.columnProblems({ footer_back_to_top: '🚀'.repeat(41) }).length, 1)
    assert.equal(S.columnProblems({ site_title: null }).length, 1)
    assert.equal(S.columnProblems({ owner_name: '   ' }).length, 1)
    assert.deepEqual(S.columnProblems({ meta_description: null, footer_signoff: '' }), [])
  })

  test('JSON limits use the jsonb text size and structural rules', () => {
    // A value whose JSON.stringify size is under 8192 but whose jsonb text is over it.
    const labels = {}
    for (let i = 0; labels && J.jsonbTextBytes(labels) <= 8192; i++) labels[`k${i}`] = 'v'
    assert.ok(JSON.stringify(labels).length <= 8192, 'stringify alone would have accepted it')
    assert.equal(S.columnProblems({ ui_labels: labels }).length, 1)
    assert.equal(S.columnProblems({ animation: { global: [] } }).length, 1)
    assert.equal(S.columnProblems({ appearance: { version: '1' } }).length, 1)
    assert.equal(S.columnProblems({ backgrounds: [] }).length, 1)
    assert.equal(S.columnProblems({ nonsense: 1 }).length, 1)
  })
})

// ---------------------------------------------------------------------------- draft

describe('saved vs draft', () => {
  const COLS = ['animation', 'ui_labels']

  test('a fresh draft is clean; edits mark only their column dirty', () => {
    const r = RECORD()
    let d = D.draftFrom(r, COLS)
    assert.equal(D.isDirty(r, d), false)
    d = D.editDraft(d, 'animation', ['animations', 'themeInkTransition', 'desktop', 'swirl'], 2)
    assert.deepEqual(D.changedColumns(r, d), ['animation'])
    assert.equal(D.pathChanged(r, d, 'animation', ['animations', 'themeInkTransition', 'desktop', 'swirl']), true)
    assert.equal(D.pathChanged(r, d, 'animation', ['global']), false)
    // Changing a value back makes it clean again.
    d = D.removeFromDraft(d, 'animation', ['animations', 'themeInkTransition', 'desktop', 'swirl'])
    assert.equal(D.isDirty(r, d), false)
  })

  test('the patch contains only changed columns and keeps every unknown key', () => {
    const r = RECORD()
    let d = D.draftFrom(r, COLS)
    d = D.editDraft(d, 'animation', ['animations', 'themeInkTransition', 'desktop', 'durationMs'], 2500)
    const patch = D.buildPatch(r, d)
    assert.deepEqual(Object.keys(patch), ['animation'])
    const expected = RECORD().animation
    expected.animations.themeInkTransition.desktop.durationMs = 2500
    assert.deepEqual(patch.animation, expected, 'global, other animations, futureFlag and futureTopLevel all kept')
    assert.equal(D.draftFrom(r, COLS).animation === r.animation, false, 'draft is a copy')
  })

  test('discard = a new draft from the saved record', () => {
    const r = RECORD()
    const d = D.editDraft(D.draftFrom(r, COLS), 'ui_labels', ['githubLink'], 'Code')
    assert.equal(D.isDirty(r, d), true)
    assert.equal(D.isDirty(r, D.draftFrom(r, COLS)), false)
  })

  test('text columns: whole-value edits', () => {
    const r = RECORD()
    let d = D.draftFrom(r, ['site_title', 'meta_description'])
    d = D.editDraft(d, 'meta_description', [], 'New')
    assert.deepEqual(D.buildPatch(r, d), { meta_description: 'New' })
    d = D.editDraft(d, 'meta_description', [], null)
    assert.equal(D.isDirty(r, d), false)
  })

  test('rebase after a conflict keeps my changes on top of the newer version', () => {
    const r = RECORD()
    let d = D.draftFrom(r, COLS)
    d = D.editDraft(d, 'animation', ['animations', 'themeInkTransition', 'desktop', 'swirl'], 2)
    d = D.removeFromDraft(d, 'animation', ['animations', 'contactDotField', 'enabled'])
    const latest = RECORD()
    latest.updated_at = '2026-11-22T11:00:00+00:00'
    latest.animation.global.intensity = 1.5 // someone else's change
    latest.ui_labels.githubLink = 'Source' // someone else's change
    const rebased = D.rebaseDraft(r, d, latest)
    assert.equal(rebased.animation.global.intensity, 1.5, 'their change kept')
    assert.equal(rebased.animation.animations.themeInkTransition.desktop.swirl, 2, 'my change re-applied')
    assert.equal(rebased.animation.animations.contactDotField, undefined, 'my removal re-applied (empty entry pruned)')
    assert.equal(rebased.ui_labels.githubLink, 'Source', 'untouched column follows the newer version')
    assert.deepEqual(D.changedColumns(latest, rebased), ['animation'])
  })
})

// ---------------------------------------------------------------------------- api

describe('loadSettings', () => {
  test('authorized read: one row, explicit columns, id = 1', async () => {
    const sb = fakeClient({ read: [{ data: RECORD(), error: null }] })
    const r = await A.loadSettings(sb)
    assert.equal(r.kind, 'ok')
    assert.equal(sb.calls.table, 'site_settings')
    assert.equal(sb.calls.select, S.SELECT_COLUMNS)
    assert.deepEqual(sb.calls.filters, [['read', 'id', 1]])
  })

  test('missing, malformed, expired, network, timeout and other errors', async () => {
    const cases = [
      [{ data: null, error: null }, 'missing'],
      [{ data: { ...RECORD(), animation: 'x' }, error: null }, 'malformed'],
      [{ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }, 'expired'],
      [{ data: null, error: { code: '', message: 'TypeError: Failed to fetch' } }, 'network'],
      [{ data: null, error: { code: '42P01', message: 'relation does not exist' } }, 'error'],
    ]
    for (const [res, kind] of cases) assert.equal((await quiet(() => A.loadSettings(fakeClient({ read: [res] })))).kind, kind, kind)
    assert.equal((await quiet(() => A.loadSettings(fakeClient({ hang: 'read' }), 20))).kind, 'network', 'timeout')
  })
})

describe('saveSettings', () => {
  const loaded = () => S.parseRecord(RECORD())
  const saved = (patch) => ({ ...RECORD(), ...patch, updated_at: '2026-11-22T10:05:00+00:00' })

  test('success: conditional on id AND updated_at, changed columns only, row returned', async () => {
    const patch = { animation: { ...RECORD().animation, global: { enabled: false } } }
    const sb = fakeClient({ update: { data: [saved(patch)], error: null } })
    const r = await A.saveSettings(sb, loaded(), patch)
    assert.equal(r.kind, 'saved')
    assert.deepEqual(r.mismatch, [])
    assert.deepEqual(sb.calls.updates, [patch])
    assert.deepEqual(sb.calls.filters, [['update', 'id', 1], ['update', 'updated_at', '2026-11-22T10:00:00.123456+00:00']])
    assert.equal(sb.calls.select, S.SELECT_COLUMNS, 'updated row requested back')
  })

  test('a returned value that differs from what was sent is reported', async () => {
    const patch = { site_title: 'New title' }
    const sb = fakeClient({ update: { data: [saved({ site_title: 'Other' })], error: null } })
    assert.deepEqual((await A.saveSettings(sb, loaded(), patch)).mismatch, ['site_title'])
  })

  test('zero rows + newer updated_at → conflict, with the newer record', async () => {
    const newer = { ...RECORD(), updated_at: '2026-11-22T10:01:00+00:00', site_title: 'Someone else' }
    const sb = fakeClient({ update: { data: [], error: null }, read: [{ data: newer, error: null }] })
    const r = await A.saveSettings(sb, loaded(), { site_title: 'Mine' })
    assert.equal(r.kind, 'conflict')
    assert.equal(r.latest.site_title, 'Someone else')
  })

  test('zero rows + same updated_at → denied (RLS refused the update)', async () => {
    const sb = fakeClient({ update: { data: [], error: null }, read: [{ data: RECORD(), error: null }] })
    assert.equal((await A.saveSettings(sb, loaded(), { site_title: 'Mine' })).kind, 'denied')
  })

  test('zero rows and the record is gone → conflict without a newer version', async () => {
    const sb = fakeClient({ update: { data: [], error: null }, read: [{ data: null, error: null }] })
    assert.deepEqual(await A.saveSettings(sb, loaded(), { site_title: 'Mine' }), { kind: 'conflict', latest: null })
  })

  test('database errors are classified, never shown raw', async () => {
    const cases = [
      [{ code: '42501', message: 'permission denied for table site_settings' }, { kind: 'denied' }],
      [{ code: 'PGRST301', message: 'JWT expired' }, { kind: 'expired' }],
      [{ code: '23514', message: 'new row for relation "site_settings" violates check constraint "site_settings_animation_check"' }, { kind: 'constraint', column: 'animation' }],
      [{ code: '23514', message: 'violates check constraint "site_settings_site_title_check"' }, { kind: 'constraint', column: 'site_title' }],
      [{ code: '23514', message: 'violates check constraint "something_else"' }, { kind: 'constraint', column: null }],
      [{ code: '', message: 'TypeError: Failed to fetch' }, { kind: 'unconfirmed' }],
      [{ code: 'XX000', message: 'internal' }, { kind: 'error' }],
    ]
    for (const [error, expected] of cases) {
      const r = await quiet(() => A.saveSettings(fakeClient({ update: { data: null, error } }), loaded(), { site_title: 'Mine' }))
      assert.deepEqual(r, expected, error.code)
    }
    for (const m of Object.values(A.SAVE_MESSAGES)) assert.ok(!/permission denied|JWT|constraint "/.test(m))
  })

  test('a timeout after sending is "unconfirmed", not success or failure', async () => {
    const r = await quiet(() => A.saveSettings(fakeClient({ hang: 'update' }), loaded(), { site_title: 'Mine' }, 20))
    assert.equal(r.kind, 'unconfirmed')
  })

  test('invalid values are rejected before any request', async () => {
    const sb = fakeClient({ update: { data: [], error: null } })
    const r = await A.saveSettings(sb, loaded(), { site_title: 'x'.repeat(200), animation: { global: 'no' } })
    assert.equal(r.kind, 'invalid')
    assert.equal(r.problems.length, 2)
    assert.equal(sb.calls.updates.length, 0)
    assert.equal((await A.saveSettings(sb, loaded(), {})).kind, 'invalid', 'empty patch')
  })

  test('more than one row is never treated as success', async () => {
    const sb = fakeClient({ update: { data: [RECORD(), RECORD()], error: null } })
    assert.equal((await A.saveSettings(sb, loaded(), { site_title: 'Mine' })).kind, 'error')
  })
})

// ---------------------------------------------------------------------------- preview

describe('preview', () => {
  test('one preview at a time; stop restores; restore runs once', () => {
    const log = []
    P.startPreview('a', () => log.push('apply a'), () => log.push('restore a'))
    assert.equal(P.activePreview(), 'a')
    P.startPreview('b', () => log.push('apply b'), () => log.push('restore b'))
    assert.deepEqual(log, ['apply a', 'restore a', 'apply b'])
    P.stopPreview('a') // not the active one: ignored
    assert.equal(P.activePreview(), 'b')
    P.stopPreview()
    P.stopPreview()
    assert.deepEqual(log, ['apply a', 'restore a', 'apply b', 'restore b'])
    assert.equal(P.activePreview(), null)
  })

  test('a preview that fails to apply is undone and not left active', () => {
    let restored = 0
    assert.throws(() => P.startPreview('x', () => { throw new Error('nope') }, () => restored++))
    assert.equal(restored, 1)
    assert.equal(P.activePreview(), null)
  })
})
