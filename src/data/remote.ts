/**
 * Published CMS content fetched from Supabase before the app renders (see remoteLoader.ts
 * and main.tsx). Data modules read it synchronously through the helpers below, so every
 * existing export keeps its shape and is final before any component calculates layout.
 *
 * Fallback rules (implemented here, applied by each data module):
 *   • Supabase unavailable / timed out / not configured  → content() is null → local JSON.
 *   • A section that is not published (draft)            → publishedSection() is null → local JSON.
 *   • A published section                                → its database content is authoritative,
 *     including intentionally empty lists. A list whose own query failed falls back to JSON.
 *   • A single missing optional value                    → that field falls back to JSON.
 */
import type { Database } from '../lib/database.types'

type Row<N extends keyof Database['public']['Tables']> = Database['public']['Tables'][N]['Row']
export type SettingsRow = Row<'site_settings'>
export type SectionRow = Row<'sections'>
export type BlockRow = Row<'content_blocks'>
export type SkillRow = Row<'skills'>
export type ProjectRow = Row<'projects'>
export type CertificateRow = Row<'certificates'>
export type SocialRow = Row<'social_links'>

export const SECTION_SLUGS = ['home', 'about', 'skills', 'projects', 'certificates', 'contact'] as const
export type SectionSlug = (typeof SECTION_SLUGS)[number]

export interface RemoteContent {
  /** null when the query failed. */
  settings: SettingsRow | null
  /** Published sections only (drafts are never fetched). */
  sections: Partial<Record<SectionSlug, SectionRow>>
  /** Published, visible blocks of published sections, by section slug and key. */
  blocks: Partial<Record<SectionSlug, Record<string, BlockRow>>>
  /** Published, visible rows in display order; null when that query failed. */
  skills: SkillRow[] | null
  projects: ProjectRow[] | null
  certificates: CertificateRow[] | null
  social: SocialRow[] | null
  /** Public URL prefix of the media bucket, e.g. https://<ref>.supabase.co/storage/v1/object/public/portfolio-media */
  mediaBase: string
}

let current: RemoteContent | null = null

export function setRemoteContent(content: RemoteContent | null) {
  current = content
}

export function remoteContent(): RemoteContent | null {
  return current
}

/** The published section row, or null (draft, unavailable, or not readable). */
export function publishedSection(slug: SectionSlug): SectionRow | null {
  return current?.sections[slug] ?? null
}

/** A published section's block, or null when the section isn't published or the block is missing. */
export function sectionBlock(slug: SectionSlug, key: string): BlockRow | null {
  if (!publishedSection(slug)) return null
  return current?.blocks[slug]?.[key] ?? null
}

/** A published section's list (authoritative even when empty), or null → use local JSON. */
export function sectionList<T>(slug: SectionSlug, rows: T[] | null | undefined): T[] | null {
  return publishedSection(slug) && rows ? rows : null
}

/**
 * Turns a Storage path ("projects/retinax.webp") into its public URL. Rejects anything
 * that isn't a plain relative path inside the bucket, so a bad value can never point
 * the site somewhere else.
 */
export function mediaUrl(path: string | null | undefined): string | null {
  const p = safeMediaPath(path)
  if (!current || !p) return null
  return `${current.mediaBase}/${p.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * The trimmed path if it is a plain relative path inside the media bucket, else null.
 * Shared by mediaUrl() and the admin's media-path validation, so both apply one rule.
 */
export function safeMediaPath(path: string | null | undefined): string | null {
  const p = path?.trim()
  if (!p) return null
  if (p.startsWith('/') || p.includes('\\') || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null
  if (p.split('/').some((s) => !s || s === '.' || s === '..')) return null
  return p
}
