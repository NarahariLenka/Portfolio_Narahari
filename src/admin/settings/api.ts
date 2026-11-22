/**
 * The only place the admin reads or writes site_settings.
 *
 * Reads: the single row (id = 1), fresh from the database each time an editor opens.
 * Writes: only the columns that changed, and only if the row is still the version that
 *   was loaded (id = 1 AND updated_at = loaded value). The updated row must come back;
 *   zero rows is never reported as success. RLS ("site_settings: admin update") decides
 *   whether the write is allowed at all; a non-admin's update matches no rows.
 *
 * Errors are classified for the UI; raw database messages are never shown or logged.
 */
import type { TypedSupabaseClient } from '../../lib/supabase'
import { isJwtError, isNetworkError, REQUEST_TIMEOUT_MS, withTimeout } from '../adminAuth'
import { deepEqual } from './json'
import { columnProblems, COLUMN_LABELS, parseRecord, SELECT_COLUMNS, type SettingsColumn, type SettingsRecord } from './schema'

export type LoadResult =
  | { kind: 'ok'; record: SettingsRecord }
  | { kind: 'missing' }
  | { kind: 'malformed' }
  | { kind: 'expired' }
  | { kind: 'network' }
  | { kind: 'error' }

export type SettingsPatch = Partial<Record<SettingsColumn, unknown>>

export type SaveResult =
  | { kind: 'saved'; record: SettingsRecord; mismatch: SettingsColumn[] }
  | { kind: 'invalid'; problems: string[] }
  | { kind: 'conflict'; latest: SettingsRecord | null }
  | { kind: 'denied' }
  | { kind: 'expired' }
  | { kind: 'constraint'; column: SettingsColumn | null }
  | { kind: 'unconfirmed' }
  | { kind: 'error' }

interface PgError {
  code?: string
  message?: string
}

function logProblem(step: string, e: unknown) {
  const { code, name } = (e && typeof e === 'object' ? e : {}) as { code?: string; name?: string }
  console.warn(`[admin] ${step} failed`, { code, name })
}

/** Reads the settings row. Never throws. */
export async function loadSettings(sb: TypedSupabaseClient, ms = REQUEST_TIMEOUT_MS): Promise<LoadResult> {
  try {
    const { data, error } = await withTimeout(
      sb.from('site_settings').select(SELECT_COLUMNS).eq('id', 1).maybeSingle().retry(false),
      ms,
    )
    if (error) {
      logProblem('settings read', error)
      if (isNetworkError(error)) return { kind: 'network' }
      return isJwtError(error) ? { kind: 'expired' } : { kind: 'error' }
    }
    if (data === null || data === undefined) return { kind: 'missing' }
    const record = parseRecord(data)
    return record ? { kind: 'ok', record } : { kind: 'malformed' }
  } catch (e) {
    logProblem('settings read', e)
    return isNetworkError(e) ? { kind: 'network' } : { kind: 'error' }
  }
}

const CONSTRAINT_COLUMN: Record<string, SettingsColumn> = {
  site_settings_appearance_check: 'appearance',
  site_settings_animation_check: 'animation',
  site_settings_backgrounds_check: 'backgrounds',
  site_settings_ui_labels_size_check: 'ui_labels',
  site_settings_ui_labels_check: 'ui_labels',
  site_settings_site_title_check: 'site_title',
  site_settings_meta_description_check: 'meta_description',
  site_settings_owner_name_check: 'owner_name',
  site_settings_location_check: 'location',
  site_settings_footer_copyright_check: 'footer_copyright',
  site_settings_footer_signoff_check: 'footer_signoff',
  site_settings_footer_back_to_top_check: 'footer_back_to_top',
}

/** Which column a check-constraint error is about (the constraint name only; no other details used). */
function constraintColumn(e: PgError): SettingsColumn | null {
  const name = /constraint "([a-z_]+)"/.exec(e.message ?? '')?.[1]
  return (name && CONSTRAINT_COLUMN[name]) || null
}

/**
 * Saves `patch` (changed columns only) if the row is still at `loaded.updated_at`.
 * Never throws.
 */
export async function saveSettings(
  sb: TypedSupabaseClient,
  loaded: SettingsRecord,
  patch: SettingsPatch,
  ms = REQUEST_TIMEOUT_MS,
): Promise<SaveResult> {
  const columns = Object.keys(patch) as SettingsColumn[]
  if (!columns.length) return { kind: 'invalid', problems: ['There are no changes to save.'] }
  const problems = columnProblems(patch)
  if (problems.length) return { kind: 'invalid', problems }

  let sent = false
  try {
    const request = sb
      .from('site_settings')
      .update(patch as never)
      .eq('id', 1)
      .eq('updated_at', loaded.updated_at)
      .select(SELECT_COLUMNS)
    sent = true
    const { data, error } = await withTimeout(request, ms)
    if (error) {
      logProblem('settings save', error)
      const e = error as PgError
      if (isNetworkError(error)) return { kind: 'unconfirmed' }
      if (isJwtError(error)) return { kind: 'expired' }
      if (e.code === '42501') return { kind: 'denied' }
      if (e.code === '23514' || e.code === '23502' || e.code === '22001') return { kind: 'constraint', column: constraintColumn(e) }
      return { kind: 'error' }
    }
    const rows = Array.isArray(data) ? data : []
    if (rows.length === 1) {
      const record = parseRecord(rows[0])
      if (!record) return { kind: 'unconfirmed' }
      // JSONB may reorder keys; compare by value. Any difference is reported, not hidden.
      const mismatch = columns.filter((c) => !deepEqual(record[c], patch[c]))
      return { kind: 'saved', record, mismatch }
    }
    if (rows.length > 1) return { kind: 'error' } // impossible for id = 1; never treated as success

    // Zero rows: either someone else saved first (updated_at moved on) or RLS refused it.
    const latest = await loadSettings(sb, ms)
    if (latest.kind === 'ok') {
      return latest.record.updated_at !== loaded.updated_at ? { kind: 'conflict', latest: latest.record } : { kind: 'denied' }
    }
    if (latest.kind === 'expired') return { kind: 'expired' }
    if (latest.kind === 'missing') return { kind: 'conflict', latest: null }
    return { kind: 'unconfirmed' }
  } catch (e) {
    logProblem('settings save', e)
    // A request that timed out may still have reached the database: say so instead of guessing.
    return sent && isNetworkError(e) ? { kind: 'unconfirmed' } : { kind: 'error' }
  }
}

export const SAVE_MESSAGES: Record<Exclude<SaveResult['kind'], 'saved' | 'invalid' | 'constraint'>, string> = {
  conflict: 'These settings were changed somewhere else after you opened them, so nothing was saved.',
  denied: 'The database refused the change. Your account may no longer be an administrator.',
  expired: 'Your session has expired. Nothing was saved.',
  unconfirmed: 'The save couldn’t be confirmed (connection problem). Reload to check whether it was saved.',
  error: 'Saving failed. Nothing was changed. Please try again.',
}

export const constraintMessage = (column: SettingsColumn | null) =>
  column
    ? `The database rejected the ${COLUMN_LABELS[column]} value (it breaks a database rule, e.g. too long). Nothing was saved.`
    : 'The database rejected one of the values (it breaks a database rule). Nothing was saved.'
