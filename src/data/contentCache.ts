/**
 * Last-known published content, kept in this visitor's browser (localStorage).
 *
 * Used only when Supabase doesn't answer within the loading budget: the visit then shows
 * the published content from the previous visit instead of the older built-in JSON, so
 * repeat visitors see consistent CMS content. It only ever holds what the public,
 * published-only queries returned (never drafts), and only complete results.
 * Every access is guarded: blocked or full storage simply means "no cache".
 */
import type { RemoteContent } from './remote'

const KEY = 'portfolio:published-content:v1'
/** Older cached content is ignored (the built-in JSON is used instead). */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
/** Larger values are not cached (the content tables are small; this is a safety cap). */
const MAX_BYTES = 512 * 1024

interface Entry {
  v: 1
  savedAt: number
  /** The Supabase project it came from: content from another project is never used. */
  origin: string
  content: RemoteContent
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const listOrNull = (v: unknown) => v === null || Array.isArray(v)

/** Only a structurally complete RemoteContent is accepted. */
export function isRemoteContent(v: unknown): v is RemoteContent {
  if (!isObj(v)) return false
  return (
    (v.settings === null || isObj(v.settings)) &&
    isObj(v.sections) &&
    isObj(v.blocks) &&
    listOrNull(v.skills) &&
    listOrNull(v.projects) &&
    listOrNull(v.certificates) &&
    listOrNull(v.social) &&
    typeof v.mediaBase === 'string'
  )
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null
  } catch {
    return null
  }
}

export function readCachedContent(origin: string, now = Date.now(), store = storage()): RemoteContent | null {
  try {
    const raw = store?.getItem(KEY)
    if (!raw) return null
    const e = JSON.parse(raw) as Partial<Entry>
    if (e.v !== 1 || e.origin !== origin || typeof e.savedAt !== 'number') return null
    if (now - e.savedAt > MAX_AGE_MS || e.savedAt > now + 60_000) return null
    return isRemoteContent(e.content) ? e.content : null
  } catch {
    return null
  }
}

export function writeCachedContent(origin: string, content: RemoteContent, now = Date.now(), store = storage()): boolean {
  try {
    if (!store || !isRemoteContent(content)) return false
    const raw = JSON.stringify({ v: 1, savedAt: now, origin, content } satisfies Entry)
    if (raw.length > MAX_BYTES) return false
    store.setItem(KEY, raw)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------- default theme

/** The published default theme, read by the inline script in index.html before first paint. */
export const THEME_KEY = 'portfolio:default-theme'

export function rememberDefaultTheme(theme: 'dark' | 'light', store = storage()) {
  try {
    if (theme === 'light') store?.setItem(THEME_KEY, 'light')
    else store?.removeItem(THEME_KEY) // dark is the built-in default: nothing to remember
  } catch {
    // storage blocked: the page simply starts dark, as before
  }
}
