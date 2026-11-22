/**
 * Saved state vs draft (pure, no React).
 *
 *   saved  the record as last read from (or confirmed by) the database
 *   draft  the editor's working copy of the columns it owns, starting as a copy of saved
 *
 * Edits change single paths in the draft, so unknown JSON keys are kept. The patch sent
 * on save contains only the owned columns whose value actually differs from saved.
 */
import { applyLeaves, clone, deepEqual, deletePath, diffLeaves, getPath, setPath, type Json, type Path } from './json'
import type { SettingsColumn, SettingsRecord } from './schema'

export type Draft = Partial<Record<SettingsColumn, Json>>

export function draftFrom(record: SettingsRecord, columns: readonly SettingsColumn[]): Draft {
  const d: Draft = {}
  for (const c of columns) d[c] = clone(record[c] as Json)
  return d
}

/** Value in the draft: the whole column (path []) or a path inside a JSON column. */
export const readDraft = (draft: Draft, column: SettingsColumn, path: Path = []): unknown =>
  path.length ? getPath(draft[column], path) : draft[column]

export function editDraft(draft: Draft, column: SettingsColumn, path: Path, value: Json): Draft {
  return { ...draft, [column]: path.length ? setPath(draft[column] ?? {}, path, value) : clone(value) }
}

/** Removes a key from a JSON column (absent = the site's coded default). */
export function removeFromDraft(draft: Draft, column: SettingsColumn, path: Path): Draft {
  if (!path.length) return draft
  return { ...draft, [column]: deletePath(draft[column] ?? {}, path) }
}

export function changedColumns(record: SettingsRecord, draft: Draft): SettingsColumn[] {
  return (Object.keys(draft) as SettingsColumn[]).filter((c) => !deepEqual(record[c], draft[c]))
}

export const isDirty = (record: SettingsRecord, draft: Draft) => changedColumns(record, draft).length > 0

/** The update payload: changed owned columns only. */
export function buildPatch(record: SettingsRecord, draft: Draft): Partial<Record<SettingsColumn, Json>> {
  const patch: Partial<Record<SettingsColumn, Json>> = {}
  for (const c of changedColumns(record, draft)) patch[c] = clone(draft[c] as Json)
  return patch
}

/** True if this path was changed in the draft (compared with saved). */
export const pathChanged = (record: SettingsRecord, draft: Draft, column: SettingsColumn, path: Path = []) =>
  !deepEqual(path.length ? getPath(record[column], path) : record[column], readDraft(draft, column, path))

/**
 * After a conflict: re-applies this editor's changes on top of the newer record, so the
 * admin can review them against the latest version before saving again. Nothing is saved.
 */
export function rebaseDraft(oldRecord: SettingsRecord, draft: Draft, latest: SettingsRecord): Draft {
  const out: Draft = {}
  for (const c of Object.keys(draft) as SettingsColumn[]) {
    const changes = diffLeaves(oldRecord[c], draft[c])
    out[c] = applyLeaves(clone(latest[c] as Json), changes)
  }
  return out
}
