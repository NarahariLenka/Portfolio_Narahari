/**
 * The public site's published-content queries (Supabase REST / PostgREST), in one place.
 * Used by remoteLoader.ts and by the build plugin (boot-preload.ts), which starts the same
 * requests from index.html before the app's JavaScript has downloaded. Pure data: no
 * browser or Node APIs, so both sides can import it.
 *
 * Every query is published-only (and visible-only for lists); RLS enforces the same.
 */
export const PUBLISHED_QUERIES = {
  site_settings: 'id=eq.1&limit=1',
  sections: 'status=eq.published',
  content_blocks: 'status=eq.published&is_visible=eq.true&order=sort_order.asc',
  skills: 'status=eq.published&is_visible=eq.true&order=sort_order.asc,created_at.asc',
  projects: 'status=eq.published&is_visible=eq.true&order=sort_order.asc,created_at.asc',
  certificates: 'status=eq.published&is_visible=eq.true&order=sort_order.asc,created_at.asc',
  social_links: 'status=eq.published&is_visible=eq.true&order=sort_order.asc',
} as const

export type PublishedTable = keyof typeof PUBLISHED_QUERIES

export const restUrl = (supabaseUrl: string, table: PublishedTable) => `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/${table}?select=*&${PUBLISHED_QUERIES[table]}`

/** Name of the global the inline script leaves its in-flight requests on. */
export const PREFETCH_GLOBAL = '__cmsPrefetch'
