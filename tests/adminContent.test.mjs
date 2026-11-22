/**
 * Phase E — Content CMS: field validation (matching the database constraints and the
 * public site's own checks), live/draft states, publish checks, ordering, slugs, import of
 * the built-in content, and the data layer against a fake Supabase client (no network).
 * Run: npm test
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let M, A, R
before(async () => {
  ;[M, A, R] = await loadModules(['/src/admin/content/model.ts', '/src/admin/content/api.ts', '/src/data/remote.ts'])
})
after(closeModules)

const json = (f) => JSON.parse(readFileSync(new URL(`../content/${f}.json`, import.meta.url), 'utf8'))
const quiet = async (fn) => {
  const w = console.warn
  console.warn = () => {}
  try { return await fn() } finally { console.warn = w }
}

let n = 0
const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`
const base = (extra) => ({ id: id(), sort_order: 10, is_visible: true, status: 'published', created_at: '2026-11-01T00:00:00+00:00', updated_at: '2026-11-01T00:00:00+00:00', ...extra })
const section = (slug, status = 'draft', extra = {}) => base({ slug, title: slug, number: null, nav_label: null, status, ...extra })
const snap = (over = {}) => ({
  sections: ['home', 'about', 'skills', 'projects', 'certificates', 'contact'].map((s) => section(s)),
  blocks: [], skills: [], projects: [], certificates: [], social_links: [], ...over,
})
const spec = (table, key) => M.LIST_FIELDS[table].find((f) => f.key === key)

// ---------------------------------------------------------------------------- validation

describe('field validation (database constraints + public checks)', () => {
  test('https links: only valid https:// addresses', () => {
    const f = spec('projects', 'github_url')
    for (const ok of ['', 'https://github.com/x/y', 'https://example.org']) assert.equal(M.fieldProblem(f, ok), null, ok)
    for (const bad of ['http://github.com', 'github.com/x', 'javascript:alert(1)', 'https://', 'https://localhost', 'https://a b.com', 'ftp://x.org']) assert.ok(M.fieldProblem(f, bad), bad)
  })

  test('contact links: email must be mailto:, others https://', () => {
    const f = spec('social_links', 'url')
    assert.equal(M.fieldProblem(f, 'mailto:me@example.com', { platform: 'email' }), null)
    assert.ok(M.fieldProblem(f, 'https://example.com', { platform: 'email' }))
    assert.ok(M.fieldProblem(f, 'mailto:not-an-address', { platform: 'email' }))
    assert.equal(M.fieldProblem(f, 'https://linkedin.com/in/x', { platform: 'linkedin' }), null)
    assert.ok(M.fieldProblem(f, 'mailto:me@example.com', { platform: 'github' }))
    assert.ok(M.fieldProblem(f, '', { platform: 'github' }), 'required')
  })

  test('media paths use the site’s own rule; PDFs must end in .pdf', () => {
    const img = spec('projects', 'image_path')
    const pdf = spec('certificates', 'pdf_path')
    for (const ok of ['projects/retinax.webp', 'certificates/images/a b.png']) assert.equal(M.fieldProblem(img, ok), null, ok)
    for (const bad of ['/projects/x.webp', 'https://evil.com/x.png', '../x.png', 'a//b.png', 'a\\b.png', 'data:image/png;base64,x', 'projects/./x.png'])
      assert.ok(M.fieldProblem(img, bad), bad)
    assert.equal(M.fieldProblem(pdf, 'certificates/pdfs/a.pdf'), null)
    assert.ok(M.fieldProblem(pdf, 'certificates/pdfs/a.png'))
    // Same rule as the public mediaUrl(): what the admin accepts, the site can show.
    for (const p of ['projects/a.webp', '/x', 'a/../b', 'https://x.y/z']) assert.equal(R.safeMediaPath(p) === p, M.mediaPathProblem(p) === null, p)
  })

  test('screenshot crop: exactly the values the database accepts', () => {
    const f = spec('projects', 'image_position')
    for (const ok of ['50% 0%', 'center top', 'top left', '100%', 'left', '20% center']) assert.equal(M.fieldProblem(f, ok), null, ok)
    for (const bad of ['120%', '05%', 'top 50%', 'left left', ' 50%', '50% 0% 0%', 'calc(1px)']) assert.ok(M.fieldProblem(f, bad), bad)
  })

  test('dates, section numbers, lengths, required fields and lists', () => {
    const date = spec('certificates', 'issued_on')
    assert.equal(M.fieldProblem(date, '2026-03-01'), null)
    for (const bad of ['2026-02-30', '2026-3-1', 'March 2026']) assert.ok(M.fieldProblem(date, bad), bad)
    const num = M.SECTION_FIELDS.find((f) => f.key === 'number')
    assert.equal(M.fieldProblem(num, '02'), null)
    assert.ok(M.fieldProblem(num, '1234'))
    assert.ok(M.fieldProblem(num, '2a'))
    const name = spec('skills', 'name')
    assert.ok(M.fieldProblem(name, ''), 'required')
    assert.ok(M.fieldProblem(name, '   '), 'required (spaces)')
    assert.equal(M.fieldProblem(name, '🐍'.repeat(60)), null, '60 characters as PostgreSQL counts them')
    assert.ok(M.fieldProblem(name, 'x'.repeat(61)))
    const tools = spec('skills', 'tools')
    assert.equal(M.fieldProblem(tools, Array(30).fill('x')), null)
    assert.ok(M.fieldProblem(tools, Array(31).fill('x')), 'cardinality limit')
    assert.ok(M.fieldProblem(tools, ['x'.repeat(61)]))
    assert.ok(M.fieldProblem(tools, 'not a list'))
  })

  test('form ↔ database values', () => {
    assert.equal(M.toDb(spec('projects', 'github_url'), '  '), null, 'empty optional → null')
    assert.equal(M.toDb(spec('skills', 'name'), 'Python'), 'Python')
    assert.deepEqual(M.toDb(spec('skills', 'tools'), [' a ', '', 'b']), ['a', 'b'])
    assert.deepEqual(M.toForm(spec('skills', 'tools'), ['a', 5, 'b']), ['a', 'b'])
    assert.equal(M.toForm(spec('projects', 'description'), null), '')
  })
})

// ---------------------------------------------------------------------------- states

describe('what visitors see', () => {
  test('row state depends on item status, visibility and the section', () => {
    const live = section('skills', 'published')
    const draft = section('skills', 'draft')
    assert.equal(M.rowState({ status: 'published', is_visible: true }, live), 'live')
    assert.equal(M.rowState({ status: 'published', is_visible: false }, live), 'hidden')
    assert.equal(M.rowState({ status: 'draft', is_visible: true }, live), 'draft')
    assert.equal(M.rowState({ status: 'published', is_visible: true }, draft), 'with-section')
  })

  test('display order = sort_order then created_at (as the public loader); reorder plan only moves what changed', () => {
    const a = base({ sort_order: 20, created_at: '2026-01-02' })
    const b = base({ sort_order: 10, created_at: '2026-01-03' })
    const c = base({ sort_order: 10, created_at: '2026-01-01' })
    assert.deepEqual(M.ordered([a, b, c]).map((r) => r.id), [c.id, b.id, a.id])
    const rows = [base({ sort_order: 10 }), base({ sort_order: 20 }), base({ sort_order: 30 })]
    assert.deepEqual(M.reorderPlan(rows), [], 'unchanged order → no writes')
    const swapped = [rows[1], rows[0], rows[2]]
    assert.deepEqual(M.reorderPlan(swapped), [{ id: rows[1].id, sort_order: 10 }, { id: rows[0].id, sort_order: 20 }])
    assert.equal(M.nextSortOrder([]), 10)
    assert.equal(M.nextSortOrder(rows), 40)
  })

  test('unique slugs in the table format', () => {
    assert.equal(M.uniqueSlug('Machine Learning', [], 61), 'machine-learning')
    assert.equal(M.uniqueSlug('Machine Learning', ['machine-learning', 'machine-learning-2'], 61), 'machine-learning-3')
    assert.equal(M.uniqueSlug('C++ / C#', [], 61), 'c-c')
    assert.equal(M.uniqueSlug('Résumé', [], 61), 'resume')
    assert.equal(M.uniqueSlug('!!!', [], 61), 'item')
    assert.match(M.uniqueSlug('x'.repeat(200), [], 61), /^[a-z0-9][a-z0-9-]{0,60}$/)
  })
})

// ---------------------------------------------------------------------------- publish checks

describe('publish checks', () => {
  test('Skills can’t be published without a visible skill (the section would disappear)', () => {
    const s = snap()
    assert.equal(M.publishCheck(s, 'skills').blocking.length, 1)
    const hidden = snap({ skills: [base({ slug: 'py', name: 'Python', description: null, tools: [], is_visible: false })] })
    assert.equal(M.publishCheck(hidden, 'skills').blocking.length, 1)
    const ok = snap({ skills: [base({ slug: 'py', name: 'Python', description: null, tools: [], status: 'draft' })] })
    const c = M.publishCheck(ok, 'skills')
    assert.deepEqual(c.blocking, [])
    assert.deepEqual(c.drafts.map((d) => d.label), ['Python'], 'drafts can be published with the section')
  })

  test('empty lists, missing blocks, missing contact platforms and hidden sections are warned about', () => {
    assert.ok(M.publishCheck(snap(), 'projects').warnings.some((w) => /empty/.test(w)))
    const about = M.publishCheck(snap(), 'about')
    assert.equal(about.warnings.filter((w) => /built-in text/.test(w)).length, 2)
    const contact = snap({ social_links: [base({ platform: 'email', label: 'Email', url: 'mailto:a@b.co' })] })
    const cw = M.publishCheck(contact, 'contact').warnings
    assert.ok(cw.some((w) => /github/.test(w)) && cw.some((w) => /linkedin/.test(w)) && !cw.some((w) => /email link/.test(w)))
    const hiddenSec = snap({ sections: [section('certificates', 'draft', { is_visible: false })] })
    assert.ok(M.publishCheck(hiddenSec, 'certificates').warnings.some((w) => /hidden/.test(w)))
    assert.equal(M.publishCheck(snap({ sections: [] }), 'about').blocking.length, 1, 'missing section record')
  })
})

// ---------------------------------------------------------------------------- import

describe('import of the built-in content', () => {
  test('copies exactly what the site shows today, nothing invented', () => {
    const s = snap()
    const skills = M.importPlan('skills', s).rows
    assert.deepEqual(skills.map((r) => r.name), json('skills').skills.map((k) => k.name.trim()))
    assert.deepEqual(skills[0].tools, json('skills').skills[0].tools.map((t) => t.trim()).filter(Boolean))
    const projects = M.importPlan('projects', s).rows
    assert.deepEqual(projects.map((p) => p.title), json('projects').projects.map((p) => p.title))
    assert.ok(!projects.some((p) => /crop/i.test(p.title)), 'the removed Crop Recommendation System is not reintroduced')
    for (const p of projects) {
      assert.equal(p.is_featured, false, 'none featured → the first is shown large, as today')
      for (const u of [p.github_url, p.live_url]) assert.ok(u === null || /^https:\/\//.test(u))
      assert.ok(!('image_path' in p), 'no media paths invented')
    }
    const certs = M.importPlan('certificates', s).rows
    assert.equal(certs.length, json('certificates').certificates.length)
    const about = M.importPlan('about', s).blocks
    assert.deepEqual(about.map((b) => b.key), ['main_sentence', 'paragraph'])
    assert.equal(about[0].body, json('about').mainSentence.trim())
    const contact = M.importPlan('contact', s)
    assert.deepEqual(contact.blocks[0].data, json('contact').bigHeadline.map((w) => w.trim()).filter(Boolean))
    for (const r of contact.rows) assert.equal(M.socialUrlProblem(r.platform, r.url), null)
    for (const r of [...skills, ...projects, ...certs]) assert.match(r.slug, /^[a-z0-9][a-z0-9-]*$/)
  })

  test('offered only for a draft section with no database content (never overwrites)', () => {
    assert.equal(M.canImport(snap(), 'skills'), true)
    assert.equal(M.canImport(snap({ sections: [section('skills', 'published')] }), 'skills'), false, 'live section')
    assert.equal(M.canImport(snap({ skills: [base({ slug: 'x', name: 'X', tools: [] })] }), 'skills'), false, 'already has rows')
    const s = snap()
    s.blocks.push(base({ section_id: s.sections[1].id, key: 'paragraph', body: 'x', data: null, image_path: null, image_alt: null }))
    assert.equal(M.canImport(s, 'about'), false, 'already has blocks')
    assert.equal(M.canImport(snap({ sections: [] }), 'about'), false, 'no section record')
  })
})

// ---------------------------------------------------------------------------- data layer

function fakeClient(script = {}) {
  const calls = []
  const reply = (key, fallback) => {
    const v = script[key]
    if (v === 'hang') return new Promise(() => {})
    return Promise.resolve(typeof v === 'function' ? v(calls) : (v ?? fallback))
  }
  return {
    calls,
    from(table) {
      const q = { table, op: 'select', filters: [], payload: null }
      calls.push(q)
      const b = {
        select() { return b },
        eq(c, v) { q.filters.push(['eq', c, v]); return b },
        in(c, v) { q.filters.push(['in', c, v]); return b },
        maybeSingle() { q.single = true; return b },
        update(p) { q.op = 'update'; q.payload = p; return b },
        insert(p) { q.op = 'insert'; q.payload = p; return b },
        retry() { return reply(q.single ? `get:${table}` : `read:${table}`, { data: [], error: null }) },
        then(res, rej) { return reply(`${q.op}:${table}`, { data: [], error: null }).then(res, rej) },
      }
      return b
    },
  }
}

describe('loadContent', () => {
  test('reads all six tables, drafts included', async () => {
    const sb = fakeClient({ 'read:sections': { data: [section('home')], error: null } })
    const r = await A.loadContent(sb)
    assert.equal(r.kind, 'ok')
    assert.deepEqual(sb.calls.map((c) => c.table).sort(), ['certificates', 'content_blocks', 'projects', 'sections', 'skills', 'social_links'])
    assert.equal(r.snapshot.sections[0].status, 'draft')
  })

  test('expired, network, timeout and malformed responses', async () => {
    assert.equal((await quiet(() => A.loadContent(fakeClient({ 'read:skills': { data: null, error: { code: 'PGRST301', message: 'JWT expired' } } })))).kind, 'expired')
    assert.equal((await quiet(() => A.loadContent(fakeClient({ 'read:projects': { data: null, error: { code: '', message: 'TypeError: Failed to fetch' } } })))).kind, 'network')
    assert.equal((await quiet(() => A.loadContent(fakeClient({ 'read:projects': 'hang' }), 20))).kind, 'network')
    assert.equal((await A.loadContent(fakeClient({ 'read:skills': { data: [{ id: 'x' }], error: null } }))).kind, 'malformed')
    assert.equal((await A.loadContent(fakeClient({ 'read:skills': { data: { not: 'a list' }, error: null } }))).kind, 'malformed')
  })
})

describe('updateRow', () => {
  const row = base({ slug: 'py', name: 'Python', tools: [] })

  test('conditional on id AND updated_at; returns the confirmed row; unknown columns untouched', async () => {
    const saved = { ...row, name: 'Python 3', updated_at: '2026-11-02T00:00:00+00:00', future_column: 'kept' }
    const sb = fakeClient({ 'update:skills': { data: [saved], error: null } })
    const r = await A.updateRow(sb, 'skills', row, { name: 'Python 3' })
    assert.equal(r.kind, 'saved')
    assert.equal(r.rows[0].future_column, 'kept')
    const q = sb.calls[0]
    assert.deepEqual(q.payload, { name: 'Python 3' }, 'only the changed field is sent')
    assert.deepEqual(q.filters, [['eq', 'id', row.id], ['eq', 'updated_at', row.updated_at]])
  })

  test('zero rows → conflict (newer version), conflict without version (deleted), or denied (RLS)', async () => {
    const newer = { ...row, updated_at: '2026-11-03T00:00:00+00:00' }
    assert.deepEqual(await A.updateRow(fakeClient({ 'get:skills': { data: newer, error: null } }), 'skills', row, { name: 'x' }), { kind: 'conflict', latest: newer })
    assert.deepEqual(await A.updateRow(fakeClient({ 'get:skills': { data: null, error: null } }), 'skills', row, { name: 'x' }), { kind: 'conflict', latest: null })
    assert.deepEqual(await A.updateRow(fakeClient({ 'get:skills': { data: row, error: null } }), 'skills', row, { name: 'x' }), { kind: 'denied' })
  })

  test('errors are classified, never shown raw', async () => {
    const cases = [
      [{ code: '42501', message: 'permission denied for table skills' }, { kind: 'denied' }],
      [{ code: 'PGRST301', message: 'JWT expired' }, { kind: 'expired' }],
      [{ code: '23514', message: 'new row violates check constraint "projects_github_url_check"' }, { kind: 'constraint', column: 'github_url' }, 'projects'],
      [{ code: '23505', message: 'duplicate key value violates unique constraint "projects_one_featured_idx"' }, { kind: 'duplicate', what: 'featured' }, 'projects'],
      [{ code: '23505', message: 'duplicate key value violates unique constraint "skills_slug_key"' }, { kind: 'duplicate', what: 'slug' }],
      [{ code: '', message: 'TypeError: Failed to fetch' }, { kind: 'unconfirmed' }],
      [{ code: 'XX000', message: 'boom' }, { kind: 'error' }],
    ]
    for (const [error, expected, table = 'skills'] of cases) {
      const r = await quiet(() => A.updateRow(fakeClient({ [`update:${table}`]: { data: null, error } }), table, row, { name: 'x' }))
      assert.deepEqual(r, expected, error.message)
      assert.ok(!/permission denied|JWT|constraint "/.test(A.writeMessage(r)))
    }
    assert.equal((await quiet(() => A.updateRow(fakeClient({ 'update:skills': 'hang' }), 'skills', row, { name: 'x' }, 20))).kind, 'unconfirmed', 'timeout after sending')
  })

  test('never writes id / updated_at / created_at, and never sends an empty patch', async () => {
    const sb = fakeClient()
    for (const p of [{}, { id: 'x' }, { updated_at: 'x' }, { created_at: 'x' }]) assert.equal((await A.updateRow(sb, 'skills', row, p)).kind, 'error')
    assert.equal(sb.calls.length, 0)
  })
})

describe('insertRows and publishDrafts', () => {
  test('insert: one request; all rows must come back', async () => {
    const rows = [{ slug: 'a', name: 'A', status: 'draft' }, { slug: 'b', name: 'B', status: 'draft' }]
    const ok = fakeClient({ 'insert:skills': { data: rows.map((r) => base(r)), error: null } })
    assert.equal((await A.insertRows(ok, 'skills', rows)).kind, 'saved')
    assert.equal(ok.calls.length, 1)
    assert.equal((await A.insertRows(fakeClient({ 'insert:skills': { data: [base(rows[0])], error: null } }), 'skills', rows)).kind, 'unconfirmed')
    assert.equal((await quiet(() => A.insertRows(fakeClient({ 'insert:skills': { data: null, error: { code: '42501' } } }), 'skills', rows))).kind, 'denied', 'non-admin insert')
    assert.equal((await A.insertRows(fakeClient(), 'skills', [{ id: 'x' }])).kind, 'error', 'ids are generated by the database')
  })

  test('publishDrafts: only the given ids that are still drafts; fewer rows back is reported', async () => {
    const a = base({ status: 'published' })
    const b = base({ status: 'published' })
    const sb = fakeClient({ 'update:skills': { data: [a, b], error: null } })
    assert.equal((await A.publishDrafts(sb, 'skills', [a.id, b.id])).kind, 'saved')
    assert.deepEqual(sb.calls[0].payload, { status: 'published' })
    assert.deepEqual(sb.calls[0].filters, [['in', 'id', [a.id, b.id]], ['eq', 'status', 'draft']])
    assert.equal((await A.publishDrafts(fakeClient({ 'update:skills': { data: [a], error: null } }), 'skills', [a.id, b.id])).kind, 'conflict')
    assert.equal((await A.publishDrafts(fakeClient(), 'skills', [])).kind, 'saved', 'nothing to publish')
  })
})
