/**
 * The only place the admin reads or writes the content tables.
 *
 *   • Reads: every row of the six tables, drafts included (RLS lets only admins see drafts).
 *   • Updates: one row at a time, only if it is still the version that was loaded
 *     (id AND updated_at); the updated row must come back. Zero rows is never success.
 *   • Inserts: one request (one statement, so a multi-row insert is all-or-nothing).
 *   • Bulk publish: one request per table, limited to the given ids that are still drafts.
 * RLS ("admin full access") decides whether a write is allowed at all.
 * Errors are classified for the UI; raw database messages are never shown or logged.
 */
import type { TypedSupabaseClient } from '../../lib/supabase'
import { isJwtError, isNetworkError, REQUEST_TIMEOUT_MS, withTimeout } from '../adminAuth'
import type { AnyRow, ContentSnapshot, ContentTable } from './model'

export type ContentLoad = { kind: 'ok'; snapshot: ContentSnapshot } | { kind: 'expired' } | { kind: 'network' } | { kind: 'malformed' } | { kind: 'error' }

export type WriteResult<R = AnyRow> =
  | { kind: 'saved'; rows: R[] }
  | { kind: 'conflict'; latest: R | null }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'constraint'; column: string | null }
  | { kind: 'duplicate'; what: string }
  | { kind: 'unconfirmed' }
  | { kind: 'error' }

interface PgError {
  code?: string
  message?: string
}

const TABLES: ContentTable[] = ['sections', 'content_blocks', 'skills', 'projects', 'certificates', 'social_links']
const SNAPSHOT_KEY: Record<ContentTable, keyof ContentSnapshot> = {
  sections: 'sections',
  content_blocks: 'blocks',
  skills: 'skills',
  projects: 'projects',
  certificates: 'certificates',
  social_links: 'social_links',
}

function logProblem(step: string, e: unknown) {
  const { code, name } = (e && typeof e === 'object' ? e : {}) as { code?: string; name?: string }
  console.warn(`[admin] ${step} failed`, { code, name })
}

const isRow = (r: unknown): r is AnyRow =>
  !!r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string' && typeof (r as { updated_at?: unknown }).updated_at === 'string' &&
  ((r as { status?: unknown }).status === 'draft' || (r as { status?: unknown }).status === 'published')

/** Reads everything the Content editor needs, fresh. Never throws. */
export async function loadContent(sb: TypedSupabaseClient, ms = REQUEST_TIMEOUT_MS): Promise<ContentLoad> {
  try {
    const results = await withTimeout(Promise.all(TABLES.map((t) => sb.from(t).select('*').retry(false))), ms)
    const snapshot = {} as ContentSnapshot
    for (let i = 0; i < TABLES.length; i++) {
      const { data, error } = results[i]
      if (error) {
        logProblem(`${TABLES[i]} read`, error)
        if (isNetworkError(error)) return { kind: 'network' }
        return isJwtError(error) ? { kind: 'expired' } : { kind: 'error' }
      }
      if (!Array.isArray(data) || !data.every(isRow)) return { kind: 'malformed' }
      ;(snapshot as unknown as Record<string, unknown>)[SNAPSHOT_KEY[TABLES[i]]] = data
    }
    return { kind: 'ok', snapshot }
  } catch (e) {
    logProblem('content read', e)
    return isNetworkError(e) ? { kind: 'network' } : { kind: 'error' }
  }
}

/** Constraint name → column (PostgreSQL's default "<table>_<column>_check" naming). */
function constraintColumn(table: ContentTable, e: PgError): string | null {
  const name = /constraint "([a-z0-9_]+)"/.exec(e.message ?? '')?.[1]
  if (!name || !name.startsWith(`${table}_`)) return null
  return name.slice(table.length + 1).replace(/_(check|key|idx)$/, '') || null
}

function classify(table: ContentTable, error: unknown): WriteResult<never> {
  const e = error as PgError
  if (isNetworkError(error)) return { kind: 'unconfirmed' }
  if (isJwtError(error)) return { kind: 'expired' }
  if (e.code === '42501') return { kind: 'denied' }
  if (e.code === '23505') {
    const c = constraintColumn(table, e) ?? ''
    return { kind: 'duplicate', what: c.includes('featured') ? 'featured' : c || 'value' }
  }
  if (e.code === '23514' || e.code === '23502' || e.code === '22001' || e.code === '22P02' || e.code === '22007' || e.code === '22008')
    return { kind: 'constraint', column: constraintColumn(table, e) }
  return { kind: 'error' }
}

/** Updates one row if it is unchanged since `loaded`. Never throws. */
export async function updateRow<R extends AnyRow>(
  sb: TypedSupabaseClient,
  table: ContentTable,
  loaded: Pick<R, 'id' | 'updated_at'>,
  patch: Record<string, unknown>,
  ms = REQUEST_TIMEOUT_MS,
): Promise<WriteResult<R>> {
  if (!Object.keys(patch).length) return { kind: 'error' }
  if ('id' in patch || 'updated_at' in patch || 'created_at' in patch) return { kind: 'error' } // never written by the editor
  let sent = false
  try {
    const request = sb.from(table).update(patch as never).eq('id', loaded.id).eq('updated_at', loaded.updated_at).select('*')
    sent = true
    const { data, error } = await withTimeout(request, ms)
    if (error) {
      logProblem(`${table} update`, error)
      return classify(table, error)
    }
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 1 && isRow(rows[0]) && rows[0].id === loaded.id) return { kind: 'saved', rows: rows as R[] }
    if (rows.length > 1) return { kind: 'error' }
    // Zero rows: changed by someone else, deleted, or refused by RLS.
    const latest = await withTimeout(sb.from(table).select('*').eq('id', loaded.id).maybeSingle().retry(false), ms)
    if (latest.error) return isJwtError(latest.error) ? { kind: 'expired' } : { kind: 'unconfirmed' }
    if (!latest.data) return { kind: 'conflict', latest: null }
    const row = latest.data as unknown as R
    return row.updated_at !== loaded.updated_at ? { kind: 'conflict', latest: row } : { kind: 'denied' }
  } catch (e) {
    logProblem(`${table} update`, e)
    return sent && isNetworkError(e) ? { kind: 'unconfirmed' } : { kind: 'error' }
  }
}

/** Inserts rows in one request (all or nothing). Never throws. */
export async function insertRows<R extends AnyRow>(sb: TypedSupabaseClient, table: ContentTable, rows: Record<string, unknown>[], ms = REQUEST_TIMEOUT_MS): Promise<WriteResult<R>> {
  if (!rows.length) return { kind: 'error' }
  if (rows.some((r) => 'id' in r || 'updated_at' in r || 'created_at' in r)) return { kind: 'error' }
  let sent = false
  try {
    const request = sb.from(table).insert(rows as never).select('*')
    sent = true
    const { data, error } = await withTimeout(request, ms)
    if (error) {
      logProblem(`${table} insert`, error)
      return classify(table, error)
    }
    const out = Array.isArray(data) ? data : []
    // RLS refusing an insert is an error (42501); anything but all rows back isn't success.
    if (out.length !== rows.length || !out.every(isRow)) return { kind: 'unconfirmed' }
    return { kind: 'saved', rows: out as R[] }
  } catch (e) {
    logProblem(`${table} insert`, e)
    return sent && isNetworkError(e) ? { kind: 'unconfirmed' } : { kind: 'error' }
  }
}

/** Publishes the given rows that are still drafts, in one request. Never throws. */
export async function publishDrafts<R extends AnyRow>(sb: TypedSupabaseClient, table: ContentTable, ids: string[], ms = REQUEST_TIMEOUT_MS): Promise<WriteResult<R>> {
  if (!ids.length) return { kind: 'saved', rows: [] }
  let sent = false
  try {
    const request = sb.from(table).update({ status: 'published' } as never).in('id', ids).eq('status', 'draft').select('*')
    sent = true
    const { data, error } = await withTimeout(request, ms)
    if (error) {
      logProblem(`${table} publish`, error)
      return classify(table, error)
    }
    const out = Array.isArray(data) ? (data as unknown[]).filter(isRow) : []
    // Fewer rows than asked: some were changed elsewhere or refused. Reported, not hidden.
    return out.length === ids.length ? { kind: 'saved', rows: out as R[] } : { kind: 'conflict', latest: null }
  } catch (e) {
    logProblem(`${table} publish`, e)
    return sent && isNetworkError(e) ? { kind: 'unconfirmed' } : { kind: 'error' }
  }
}

export type DeleteResult<R = AnyRow> =
  | { kind: 'deleted'; id: string }
  | { kind: 'conflict'; latest: R }
  | { kind: 'gone' }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'unconfirmed' }
  | { kind: 'error' }

/**
 * Permanently deletes ONE project row, only if it is still the version that was loaded
 * (id AND updated_at). The deleted row must come back; zero rows is never success.
 * Limited to the projects table on purpose: nothing else can be deleted from the CMS.
 * Never touches Storage (the screenshot stays in the Media Library). Never throws.
 */
export async function deleteProjectRow<R extends AnyRow>(sb: TypedSupabaseClient, loaded: Pick<R, 'id' | 'updated_at'>, ms = REQUEST_TIMEOUT_MS): Promise<DeleteResult<R>> {
  if (!loaded.id || !loaded.updated_at) return { kind: 'error' }
  let sent = false
  try {
    const request = sb.from('projects').delete().eq('id', loaded.id).eq('updated_at', loaded.updated_at).select('id')
    sent = true
    const { data, error } = await withTimeout(request, ms)
    if (error) {
      logProblem('projects delete', error)
      const r = classify('projects', error)
      return r.kind === 'denied' || r.kind === 'expired' || r.kind === 'unconfirmed' ? r : { kind: 'error' }
    }
    const rows = Array.isArray(data) ? (data as { id?: unknown }[]) : []
    if (rows.length === 1 && rows[0].id === loaded.id) return { kind: 'deleted', id: loaded.id }
    if (rows.length > 0) return { kind: 'error' } // more than one, or another row: never success
    // Zero rows: changed since loaded, already deleted, or refused by RLS.
    const latest = await withTimeout(sb.from('projects').select('*').eq('id', loaded.id).maybeSingle().retry(false), ms)
    if (latest.error) return isJwtError(latest.error) ? { kind: 'expired' } : { kind: 'unconfirmed' }
    if (!latest.data) return { kind: 'gone' }
    const row = latest.data as unknown as R
    return row.updated_at !== loaded.updated_at ? { kind: 'conflict', latest: row } : { kind: 'denied' }
  } catch (e) {
    logProblem('projects delete', e)
    return sent && isNetworkError(e) ? { kind: 'unconfirmed' } : { kind: 'error' }
  }
}

export const DELETE_MESSAGES: Record<Exclude<DeleteResult['kind'], 'deleted'>, string> = {
  conflict: 'This project was changed somewhere else after you opened it, so it was NOT deleted. The newer version is now shown: review it and delete again if you still want to.',
  gone: 'This project no longer exists (it was already deleted somewhere else). The list was refreshed.',
  denied: 'The database refused the deletion. Your account may no longer be an administrator. Nothing was deleted.',
  expired: 'Your session has expired. Nothing was deleted.',
  unconfirmed: 'The deletion couldn’t be confirmed (connection problem). Reload to check whether the project still exists.',
  error: 'Deleting failed. Nothing was deleted.',
}

export function writeMessage(r: Exclude<WriteResult, { kind: 'saved' }>): string {
  switch (r.kind) {
    case 'conflict':
      return r.latest === null
        ? 'This item was changed or removed somewhere else. Nothing was overwritten. Reload to see the current version.'
        : 'This item was changed somewhere else after you opened it. Nothing was overwritten.'
    case 'denied':
      return 'The database refused the change. Your account may no longer be an administrator.'
    case 'expired':
      return 'Your session has expired. Nothing was saved.'
    case 'constraint':
      return `The database rejected ${r.column ? `the "${r.column.replace(/_/g, ' ')}" value` : 'a value'} (it breaks a database rule). Nothing was saved.`
    case 'duplicate':
      return r.what === 'featured'
        ? 'Another project is already featured. Nothing was saved.'
        : `That ${r.what.replace(/_/g, ' ')} is already used by another item. Nothing was saved.`
    case 'unconfirmed':
      return 'The change couldn’t be confirmed (connection problem). Reload to check whether it was saved.'
    default:
      return 'Saving failed. Nothing was changed. Please try again.'
  }
}
