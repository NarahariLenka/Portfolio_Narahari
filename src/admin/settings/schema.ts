/**
 * The site_settings columns the admin reads and writes, and the database's own rules for
 * them (supabase/schema.sql, migration 003). These checks run before a save so mistakes
 * are caught early, but the database stays authoritative: its constraint errors are
 * reported as they come.
 */
import { isObject, jsonbTextBytes } from './json'

export const TEXT_COLUMNS = [
  'site_title',
  'meta_description',
  'owner_name',
  'location',
  'footer_copyright',
  'footer_signoff',
  'footer_back_to_top',
] as const
export const JSON_COLUMNS = ['ui_labels', 'appearance', 'animation', 'backgrounds'] as const

export type TextColumn = (typeof TEXT_COLUMNS)[number]
export type JsonColumn = (typeof JSON_COLUMNS)[number]
export type SettingsColumn = TextColumn | JsonColumn

/** Exactly what the admin selects: no created_at or anything else it doesn't need. */
export const SELECT_COLUMNS = ['id', ...TEXT_COLUMNS, ...JSON_COLUMNS, 'updated_at'].join(',')

export interface SettingsRecord {
  id: 1
  site_title: string
  meta_description: string | null
  owner_name: string
  location: string | null
  footer_copyright: string | null
  footer_signoff: string | null
  footer_back_to_top: string | null
  ui_labels: Record<string, unknown>
  appearance: Record<string, unknown>
  animation: Record<string, unknown>
  backgrounds: Record<string, unknown>
  updated_at: string
}

/** char_length limits (characters, as PostgreSQL counts them) and NOT NULL columns. */
export const TEXT_RULES: Record<TextColumn, { max: number; required: boolean; label: string }> = {
  site_title: { max: 120, required: true, label: 'Site title' },
  meta_description: { max: 300, required: false, label: 'Search description' },
  owner_name: { max: 80, required: true, label: 'Owner name' },
  location: { max: 80, required: false, label: 'Location' },
  footer_copyright: { max: 160, required: false, label: 'Footer copyright' },
  footer_signoff: { max: 160, required: false, label: 'Footer sign-off' },
  footer_back_to_top: { max: 40, required: false, label: 'Back-to-top label' },
}

/** octet_length(column::text) limits from migration 003. */
export const JSON_LIMITS: Record<JsonColumn, number> = {
  ui_labels: 8192,
  appearance: 8192,
  animation: 16384,
  backgrounds: 8192,
}

export const COLUMN_LABELS: Record<SettingsColumn, string> = {
  ...Object.fromEntries(TEXT_COLUMNS.map((c) => [c, TEXT_RULES[c].label])),
  ui_labels: 'Interface labels',
  appearance: 'Appearance',
  animation: 'Animations',
  backgrounds: 'Backgrounds',
} as Record<SettingsColumn, string>

/** Characters as PostgreSQL's char_length counts them (code points, not UTF-16 units). */
export const charLength = (s: string) => [...s].length

/**
 * Checks a row returned by Supabase. Anything unexpected → null (shown as "unexpected
 * data", never edited), so a malformed response can't be turned into a save.
 */
export function parseRecord(raw: unknown): SettingsRecord | null {
  if (!isObject(raw) || raw.id !== 1 || typeof raw.updated_at !== 'string' || !raw.updated_at) return null
  for (const c of TEXT_COLUMNS) {
    const v = raw[c]
    if (TEXT_RULES[c].required ? typeof v !== 'string' : v !== null && typeof v !== 'string') return null
  }
  for (const c of JSON_COLUMNS) if (!isObject(raw[c])) return null
  return raw as unknown as SettingsRecord
}

/** Problems with the values about to be saved (empty = fine). */
export function columnProblems(patch: Partial<Record<SettingsColumn, unknown>>): string[] {
  const problems: string[] = []
  for (const [col, value] of Object.entries(patch) as [SettingsColumn, unknown][]) {
    if ((TEXT_COLUMNS as readonly string[]).includes(col)) {
      const rule = TEXT_RULES[col as TextColumn]
      if (value === null) {
        if (rule.required) problems.push(`${rule.label} is required.`)
      } else if (typeof value !== 'string') problems.push(`${rule.label} must be text.`)
      else if (rule.required && !value.trim()) problems.push(`${rule.label} can’t be empty.`)
      else if (charLength(value) > rule.max) problems.push(`${rule.label} is too long (${charLength(value)} of ${rule.max} characters).`)
    } else if ((JSON_COLUMNS as readonly string[]).includes(col)) {
      const label = COLUMN_LABELS[col]
      if (!isObject(value)) {
        problems.push(`${label} settings must be a JSON object.`)
        continue
      }
      const bytes = jsonbTextBytes(value)
      if (bytes > JSON_LIMITS[col as JsonColumn]) problems.push(`${label} settings are too large (${bytes} of ${JSON_LIMITS[col as JsonColumn]} bytes).`)
      if (col !== 'ui_labels' && Object.hasOwn(value, 'version') && typeof value.version !== 'number') problems.push(`${label}: "version" must be a number.`)
      if (col === 'animation') {
        for (const k of ['global', 'animations'])
          if (Object.hasOwn(value, k) && !isObject(value[k])) problems.push(`${label}: "${k}" must be an object.`)
      }
    } else problems.push(`Unknown setting "${col}".`)
  }
  return problems
}
