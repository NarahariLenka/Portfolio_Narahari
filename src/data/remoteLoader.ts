/**
 * Fetches all published CMS content in one parallel round of requests. Loaded lazily from
 * main.tsx so the Supabase client stays out of the code path when Supabase isn't
 * configured. Never throws.
 *
 * Loading budget: the site waits for the content for CONTENT_BUDGETS (shorter when a
 * previous visit cached published content). If Supabase hasn't answered by then the
 * visit uses the last published content cached in this browser (contentCache.ts), or the
 * built-in JSON if there is none. The late answer is NOT thrown away: it still completes
 * in the background and refreshes the cache for the next visit — it never swaps content on
 * the page that is already showing (no flicker, no layout jump).
 *
 * Every query filters explicitly on status = 'published' (and is_visible for lists) in
 * addition to RLS, and is sent anonymously with the publishable key, so drafts are never
 * returned. Only public portfolio tables are queried; `admins` is never touched.
 *
 * The queries are plain GET requests to Supabase's REST API (PostgREST) — the same filters
 * the Supabase client would send — so public pages don't download the client library
 * (~216 kB). The admin panel keeps using the client.
 */
import { isSupabaseConfigured, validateSupabaseEnv } from '../lib/supabaseEnv'
import { readCachedContent, writeCachedContent } from './contentCache'
import { PREFETCH_GLOBAL, restUrl, type PublishedTable } from './publishedQueries'
import { SECTION_SLUGS, type BlockRow, type RemoteContent, type SectionRow, type SectionSlug } from './remote'

/**
 * How long a visit waits for published content, measured from when the request starts
 * (not from navigation: on slow networks the code download comes first, and the page
 * can't render before the app code has arrived anyway, so that time costs nothing).
 * Measured (Phase G, cold connections, 12 runs): all 7 queries took p50 ~0.45 s,
 * p75 ~0.63 s, p90 ~1.14 s, max ~2.16 s.
 *   cached   a previous visit left published content in this browser: wait less, then
 *            show that (consistent CMS content, hero stays fast)
 *   uncached first visit: the only fallback is the older built-in JSON, so wait longer to
 *            avoid it (covers the measured tail except the slowest outliers)
 */
export const CONTENT_BUDGETS = { cached: 1100, uncached: 1900 } as const
/** A background request still running after this is abandoned. */
const HARD_LIMIT_MS = 15_000
const MEDIA_BUCKET = 'portfolio-media'

export type ContentSource = 'network' | 'cache' | 'local'

const isSlug = (s: string): s is SectionSlug => (SECTION_SLUGS as readonly string[]).includes(s)

export async function loadRemoteContent(budgets: { cached: number; uncached: number } = CONTENT_BUDGETS): Promise<{ content: RemoteContent | null; source: ContentSource }> {
  if (!isSupabaseConfigured) return { content: null, source: 'local' }
  // ?content=local forces the bundled JSON (handy for comparing or debugging).
  if (new URLSearchParams(window.location.search).get('content') === 'local') return { content: null, source: 'local' }

  const origin = validateSupabaseEnv().url
  const fetching = fetchPublished()
  const deadline = performance.now() + (readCachedContent(origin) ? budgets.cached : budgets.uncached)
  const wait = Math.max(0, deadline - performance.now())
  let timer = 0
  const timeout = new Promise<'timeout'>((resolve) => (timer = window.setTimeout(() => resolve('timeout'), wait)))
  const raced = await Promise.race([fetching, timeout])
  window.clearTimeout(timer)

  if (raced === 'timeout') {
    warn('request', new Error(`no answer within ${Math.round(wait)} ms; the answer will refresh the cache for the next visit`))
    // Late answer → cache only (never swaps the page already showing).
    void fetching.then((r) => r.complete && r.content && writeCachedContent(origin, r.content))
    const cached = readCachedContent(origin)
    return cached ? { content: cached, source: 'cache' } : { content: null, source: 'local' }
  }
  if (raced.content) {
    if (raced.complete) writeCachedContent(origin, raced.content)
    return { content: raced.content, source: 'network' }
  }
  const cached = readCachedContent(origin)
  return cached ? { content: cached, source: 'cache' } : { content: null, source: 'local' }
}

/** A PostgREST response: the rows, or an error (never thrown). */
type Res<T> = { data: T[] | null; error: Error | null }

/**
 * Requests started by the inline script in index.html (boot-preload.ts) before the app's
 * code arrived: same URLs and headers. Each is used once; later rounds fetch normally.
 */
function takePrefetched(): Partial<Record<PublishedTable, Promise<unknown>>> | null {
  const w = window as unknown as Record<string, unknown>
  const p = w[PREFETCH_GLOBAL]
  w[PREFETCH_GLOBAL] = null
  return p && typeof p === 'object' ? (p as Partial<Record<PublishedTable, Promise<unknown>>>) : null
}

/** One round of the 7 published-content queries. `complete` = every query succeeded. */
async function fetchPublished(): Promise<{ content: RemoteContent | null; complete: boolean }> {
  const { url, key } = validateSupabaseEnv()
  const controller = new AbortController()
  const hard = window.setTimeout(() => controller.abort(), HARD_LIMIT_MS)
  const prefetched = takePrefetched()
  const get = async <T>(table: PublishedTable): Promise<Res<T>> => {
    try {
      let data: unknown
      const early = prefetched?.[table]
      if (early) data = await early // JSON body, or rejects (network error / non-2xx)
      else {
        const res = await fetch(restUrl(url, table), {
          headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!res.ok) return { data: null, error: new Error(`${table}: HTTP ${res.status}`) }
        data = await res.json()
      }
      return Array.isArray(data) ? { data: data as T[], error: null } : { data: null, error: new Error(`${table}: unexpected response`) }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error : new Error(String(error)) }
    }
  }
  try {
    const [settingsRes, sections, blocks, skills, projects, certificates, social] = await Promise.all([
      get<NonNullable<RemoteContent['settings']>>('site_settings'),
      get<SectionRow>('sections'),
      get<BlockRow>('content_blocks'),
      get<NonNullable<RemoteContent['skills']>[number]>('skills'),
      get<NonNullable<RemoteContent['projects']>[number]>('projects'),
      get<NonNullable<RemoteContent['certificates']>[number]>('certificates'),
      get<NonNullable<RemoteContent['social']>[number]>('social_links'),
    ])
    const settings = { data: settingsRes.data?.[0] ?? null, error: settingsRes.error }

    // Without sections nothing can be gated safely: use the cache / local JSON for everything.
    if (sections.error || !sections.data) {
      warn('sections', sections.error)
      return { content: null, complete: false }
    }

    const bySlug: Partial<Record<SectionSlug, SectionRow>> = {}
    const slugById = new Map<string, SectionSlug>()
    for (const s of sections.data) {
      if (isSlug(s.slug)) {
        bySlug[s.slug] = s
        slugById.set(s.id, s.slug)
      }
    }

    const blockMap: Partial<Record<SectionSlug, Record<string, BlockRow>>> = {}
    if (blocks.error) warn('content_blocks', blocks.error)
    for (const b of blocks.data ?? []) {
      const slug = slugById.get(b.section_id)
      if (slug) (blockMap[slug] ??= {})[b.key] = b
    }

    for (const [name, r] of [['site_settings', settings], ['skills', skills], ['projects', projects], ['certificates', certificates], ['social_links', social]] as const) {
      if (r.error) warn(name, r.error)
    }

    const complete = ![settings, blocks, skills, projects, certificates, social].some((r) => r.error)
    return {
      complete,
      content: {
        settings: settings.error ? null : (settings.data ?? null),
        sections: bySlug,
        blocks: blockMap,
        skills: skills.error ? null : skills.data,
        projects: projects.error ? null : projects.data,
        certificates: certificates.error ? null : certificates.data,
        social: social.error ? null : social.data,
        mediaBase: `${url.replace(/\/+$/, '')}/storage/v1/object/public/${MEDIA_BUCKET}`,
      },
    }
  } catch (error) {
    warn('request', error)
    return { content: null, complete: false }
  } finally {
    window.clearTimeout(hard)
  }
}

function warn(what: string, error: unknown) {
  const message = error instanceof Error ? error.message : (error as { message?: string } | null)?.message
  console.warn(`[cms] ${what} unavailable${message ? `: ${message}` : ''}`)
}
