/**
 * Phase G — public content loading: the published-content cache, the fetch-based loader
 * (published-only queries, budgets, cache/local fallbacks, late answers refreshing the cache
 * without swapping the page) and the build-time loading hints. Fake fetch/storage, no network.
 * Runs in its own process (window/localStorage stubs).
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

// ---------------------------------------------------------------------------- browser stubs
function memoryStorage() {
  const m = new Map()
  return { map: m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size } }
}
const ls = memoryStorage()
globalThis.window = globalThis
globalThis.localStorage = ls
globalThis.location = { search: '' }

let C, L, P
let calls = []
let respond = () => ({ status: 200, body: [] })
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), headers: init?.headers ?? {} })
  const r = await respond(String(url))
  if (r === 'network') throw new TypeError('Failed to fetch')
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body }
}

before(async () => {
  ;[C, L, P] = await loadModules(['/src/data/contentCache.ts', '/src/data/remoteLoader.ts', '/boot-preload.ts'])
})
after(closeModules)
beforeEach(() => {
  calls = []
  ls.clear()
  respond = () => ({ status: 200, body: [] })
})

const tableOf = (url) => new URL(url).pathname.split('/').pop()
const content = (extra = {}) => ({ settings: null, sections: {}, blocks: {}, skills: [], projects: [], certificates: [], social: [], mediaBase: 'https://x.test/m', ...extra })
const ORIGIN = () => {
  // The loader keys the cache by the configured Supabase URL; read it back from a fresh write.
  return calls.length ? new URL(calls[0].url).origin : null
}

// ---------------------------------------------------------------------------- cache
describe('published-content cache', () => {
  test('round trip; other project, too old, future-dated or malformed entries are ignored', () => {
    const c = content({ projects: [{ id: 'p' }] })
    assert.equal(C.writeCachedContent('https://a.supabase.co', c, 1000, ls), true)
    assert.deepEqual(C.readCachedContent('https://a.supabase.co', 2000, ls), c)
    assert.equal(C.readCachedContent('https://b.supabase.co', 2000, ls), null, 'another project')
    assert.equal(C.readCachedContent('https://a.supabase.co', 1000 + C.MAX_AGE_MS + 1, ls), null, 'too old')
    C.writeCachedContent('https://a.supabase.co', c, 10_000_000, ls)
    assert.equal(C.readCachedContent('https://a.supabase.co', 1000, ls), null, 'from the future')
    for (const raw of ['not json', '{"v":2}', JSON.stringify({ v: 1, savedAt: 1000, origin: 'https://a.supabase.co', content: { sections: [] } })]) {
      ls.setItem('portfolio:published-content:v1', raw)
      assert.equal(C.readCachedContent('https://a.supabase.co', 2000, ls), null, raw.slice(0, 20))
    }
  })

  test('blocked storage and incomplete content are never written', () => {
    const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }
    assert.equal(C.writeCachedContent('https://a.supabase.co', content(), 1, blocked), false)
    assert.equal(C.readCachedContent('https://a.supabase.co', 1, blocked), null)
    assert.equal(C.writeCachedContent('https://a.supabase.co', { sections: {} }, 1, ls), false)
  })

  test('default theme memory: light is remembered, dark clears it', () => {
    C.rememberDefaultTheme('light', ls)
    assert.equal(ls.getItem(C.THEME_KEY), 'light')
    C.rememberDefaultTheme('dark', ls)
    assert.equal(ls.getItem(C.THEME_KEY), null)
  })
})

// ---------------------------------------------------------------------------- loader
const section = (slug) => ({ id: `s-${slug}`, slug, number: '04', title: slug, nav_label: null, sort_order: 10, is_visible: true, status: 'published', created_at: '', updated_at: '' })

describe('loadRemoteContent', () => {
  test('sends 7 anonymous, published-only GET queries with the publishable key', async () => {
    respond = (url) => ({ status: 200, body: tableOf(url) === 'sections' ? [section('projects')] : [] })
    const r = await L.loadRemoteContent({ cached: 500, uncached: 500 })
    assert.equal(r.source, 'network')
    assert.equal(calls.length, 7)
    const q = Object.fromEntries(calls.map((c) => [tableOf(c.url), new URL(c.url).searchParams]))
    assert.deepEqual(Object.keys(q).sort(), ['certificates', 'content_blocks', 'projects', 'sections', 'site_settings', 'skills', 'social_links'])
    for (const t of ['sections', 'content_blocks', 'skills', 'projects', 'certificates', 'social_links']) assert.equal(q[t].get('status'), 'eq.published', `${t} published only`)
    for (const t of ['content_blocks', 'skills', 'projects', 'certificates', 'social_links']) assert.equal(q[t].get('is_visible'), 'eq.true', `${t} visible only`)
    assert.equal(q.projects.get('order'), 'sort_order.asc,created_at.asc', 'same order as before')
    assert.equal(q.site_settings.get('id'), 'eq.1')
    assert.ok(!('admins' in q))
    for (const c of calls) {
      assert.ok(!c.headers.apikey.startsWith('sb_secret_'), 'never a secret key')
      assert.equal(c.headers.Authorization, `Bearer ${c.headers.apikey}`, 'anonymous: no user session is sent')
    }
    assert.match(r.content.mediaBase, /\/storage\/v1\/object\/public\/portfolio-media$/)
    assert.deepEqual(Object.keys(r.content.sections), ['projects'])
  })

  test('a complete answer refreshes the cache; a partial one (one query failed) does not', async () => {
    respond = (url) => ({ status: 200, body: tableOf(url) === 'sections' ? [section('skills')] : [] })
    await L.loadRemoteContent({ cached: 500, uncached: 500 })
    const origin = ORIGIN()
    assert.ok(C.readCachedContent(origin), 'cached')
    ls.clear()
    respond = (url) => (tableOf(url) === 'skills' ? { status: 500, body: { message: 'x' } } : { status: 200, body: tableOf(url) === 'sections' ? [section('skills')] : [] })
    const quietWarn = console.warn
    console.warn = () => {}
    try {
      const r = await L.loadRemoteContent({ cached: 500, uncached: 500 })
      assert.equal(r.source, 'network')
      assert.equal(r.content.skills, null, 'that list falls back to local JSON')
    } finally {
      console.warn = quietWarn
    }
    assert.equal(C.readCachedContent(origin), null, 'degraded results are not cached')
  })

  test('no answer within the budget → cached published content; the late answer refreshes the cache only', async () => {
    // First visit fills the cache.
    respond = (url) => ({ status: 200, body: tableOf(url) === 'sections' ? [section('skills')] : [] })
    await L.loadRemoteContent({ cached: 500, uncached: 500 })
    const origin = ORIGIN()
    // Slow visit: answers after 80 ms, budget 20 ms.
    let release
    const gate = new Promise((r) => (release = r))
    respond = async (url) => {
      await gate
      return { status: 200, body: tableOf(url) === 'sections' ? [section('skills'), section('projects')] : [] }
    }
    const warn = console.warn
    console.warn = () => {}
    let r
    try {
      r = await L.loadRemoteContent({ cached: 20, uncached: 20 })
    } finally {
      console.warn = warn
    }
    assert.equal(r.source, 'cache')
    assert.deepEqual(Object.keys(r.content.sections), ['skills'], 'the previous published content, not the late answer')
    release()
    await new Promise((res) => setTimeout(res, 20))
    assert.deepEqual(Object.keys(C.readCachedContent(origin).sections).sort(), ['projects', 'skills'], 'late answer stored for the next visit')
  })

  test('no cache: budget miss or failure → local JSON (null)', async () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      respond = () => new Promise(() => {})
      assert.deepEqual(await L.loadRemoteContent({ cached: 10, uncached: 10 }), { content: null, source: 'local' })
      respond = () => 'network'
      assert.deepEqual(await L.loadRemoteContent({ cached: 500, uncached: 500 }), { content: null, source: 'local' })
      respond = (url) => (tableOf(url) === 'sections' ? { status: 401, body: {} } : { status: 200, body: [] })
      assert.deepEqual(await L.loadRemoteContent({ cached: 500, uncached: 500 }), { content: null, source: 'local' }, 'without sections nothing is used')
      respond = () => ({ status: 200, body: { not: 'a list' } })
      assert.deepEqual(await L.loadRemoteContent({ cached: 500, uncached: 500 }), { content: null, source: 'local' })
    } finally {
      console.warn = warn
    }
  })

  test('the shorter budget applies when a cache exists', () => {
    assert.ok(L.CONTENT_BUDGETS.cached < L.CONTENT_BUDGETS.uncached)
  })

  test('?content=local forces the built-in JSON without any request', async () => {
    globalThis.location.search = '?content=local'
    try {
      assert.deepEqual(await L.loadRemoteContent(), { content: null, source: 'local' })
      assert.equal(calls.length, 0)
    } finally {
      globalThis.location.search = ''
    }
  })
})

// ---------------------------------------------------------------------------- early requests
describe('requests started by index.html (prefetch)', () => {
  test('the loader reuses the in-flight answers once, with the same validation', async () => {
    const tables = ['site_settings', 'sections', 'content_blocks', 'skills', 'projects', 'certificates', 'social_links']
    globalThis.__cmsPrefetch = Object.fromEntries(tables.map((t) => [t, Promise.resolve(t === 'sections' ? [section('about')] : [])]))
    const r = await L.loadRemoteContent({ cached: 500, uncached: 500 })
    assert.equal(r.source, 'network')
    assert.deepEqual(Object.keys(r.content.sections), ['about'])
    assert.equal(calls.length, 0, 'no duplicate requests')
    assert.equal(globalThis.__cmsPrefetch, null, 'consumed')
    await L.loadRemoteContent({ cached: 500, uncached: 500 })
    assert.equal(calls.length, 7, 'a later round fetches normally')
  })

  test('failed or malformed early answers are treated like failed requests', async () => {
    const warn = console.warn
    console.warn = () => {}
    try {
      const fail = Promise.reject(new Error('HTTP 500'))
      fail.catch(() => {})
      globalThis.__cmsPrefetch = { sections: fail }
      assert.deepEqual(await L.loadRemoteContent({ cached: 500, uncached: 500 }), { content: null, source: 'local' })
      globalThis.__cmsPrefetch = { sections: Promise.resolve({ not: 'a list' }) }
      assert.deepEqual(await L.loadRemoteContent({ cached: 500, uncached: 500 }), { content: null, source: 'local' })
    } finally {
      console.warn = warn
    }
  })
})

// ---------------------------------------------------------------------------- build hints
describe('build-time loading hints', () => {
  const chunk = (fileName, facadeModuleId, imports = [], isEntry = false, css = []) => ({ type: 'chunk', fileName, facadeModuleId, imports, isEntry, viteMetadata: { importedCss: new Set(css) } })
  const asset = (fileName) => ({ type: 'asset', fileName })
  const HTML = '<head><meta charset="UTF-8" />\n<meta name="viewport" />\n<!-- cms-prefetch: marker -->\n</head>'
  const run = (url, key, bundle) => P.default(url, key).transformIndexHtml.handler(HTML, { bundle })
  const bundle = () => ({
    a: chunk('assets/index-1.js', '/x/src/main.tsx', [], true, ['assets/index-1.css']),
    b: chunk('assets/App-2.js', 'C:\\x\\src\\App.tsx', ['assets/index-1.js', 'assets/skills-3.js'], false, ['assets/App-2.css']),
    c: chunk('assets/skills-3.js', null, [], false, ['assets/theme-3.css']),
    d: chunk('assets/remoteLoader-4.js', '/x/src/data/remoteLoader.ts', ['assets/supabaseEnv-5.js']),
    e: chunk('assets/supabaseEnv-5.js', null),
    f: chunk('assets/AdminApp-6.js', '/x/src/admin/AdminApp.tsx', [], false, ['assets/AdminApp-6.css']),
    g: chunk('assets/BelowFold-7.js', '/x/src/BelowFold.tsx', [], false, ['assets/BelowFold-7.css']),
    h: asset('assets/inter-latin-AbC.woff2'),
    i: asset('assets/space-grotesk-latin-q1.woff2'),
    j: asset('assets/space-grotesk-latin-ext-z.woff2'),
  })

  test('modulepreload App + loader (with imports), their CSS, Space Grotesk only; nothing for admin or the sections below the hero', () => {
    const { tags } = run('https://abc.supabase.co', 'sb_publishable_test', bundle())
    const hrefs = (pred) => tags.filter(pred).map((t) => t.attrs.href).sort()
    assert.deepEqual(hrefs((t) => t.attrs?.rel === 'modulepreload'), ['/assets/App-2.js', '/assets/remoteLoader-4.js', '/assets/skills-3.js', '/assets/supabaseEnv-5.js'])
    assert.deepEqual(hrefs((t) => t.attrs?.as === 'style'), ['/assets/App-2.css', '/assets/theme-3.css'], 'entry CSS is already a stylesheet; admin/below-fold CSS not preloaded')
    assert.deepEqual(hrefs((t) => t.attrs?.as === 'font'), ['/assets/space-grotesk-latin-q1.woff2'])
    assert.equal(tags.find((t) => t.attrs?.rel === 'preconnect').attrs.href, 'https://abc.supabase.co')
  })

  test('the early-request script replaces the marker (after <meta charset>) and uses the shared published-only queries', () => {
    const { html } = run('https://abc.supabase.co', 'sb_publishable_test', bundle())
    assert.ok(!html.includes('cms-prefetch:'), 'marker replaced')
    assert.ok(html.indexOf('<meta charset') < html.indexOf('<script>'), 'charset stays first')
    for (const t of ['site_settings', 'sections', 'content_blocks', 'skills', 'projects', 'certificates', 'social_links']) assert.ok(html.includes(`/rest/v1/${t}?select=*&`), t)
    assert.ok(!/admins/.test(html))
    assert.match(html, /#admin/, 'skipped on the admin route')
    assert.match(html, /content=local/, 'skipped when local content is forced')
    assert.match(html, /status=eq\.published/)
  })

  test('never embeds a secret / service-role key; no or non-https URL → no script, no preconnect', () => {
    const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`
    assert.equal(P.isSecretKey('sb_secret_abc'), true)
    assert.equal(P.isSecretKey(jwt('service_role')), true)
    assert.equal(P.isSecretKey(jwt('anon')), false)
    assert.equal(P.isSecretKey('sb_publishable_abc'), false)
    for (const [url, key] of [['https://abc.supabase.co', 'sb_secret_abc'], ['https://abc.supabase.co', jwt('service_role')], [undefined, 'sb_publishable_x'], ['http://abc.supabase.co', 'sb_publishable_x'], ['nope', 'sb_publishable_x']]) {
      const { html, tags } = run(url, key, {})
      assert.ok(!html.includes('<script>'), `${url} ${key.slice(0, 12)}`)
      if (url !== 'https://abc.supabase.co') assert.equal(tags.filter((t) => t.attrs?.rel === 'preconnect').length, 0)
    }
  })
})
