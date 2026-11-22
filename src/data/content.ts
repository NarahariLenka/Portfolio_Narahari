/**
 * Reads the editable files in /content and turns them into safe, complete values.
 * Anything missing, empty or mistyped falls back to a sensible default, so editing one
 * entry can never break another part of the site.
 */
import site from '../../content/site.json'
import { publishedSection, remoteContent, type SectionSlug } from './remote'
import { resolveLabel, UI_LABEL_KEYS, type UiLabelKey } from './uiLabels'

export const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() || fallback : typeof value === 'number' ? String(value) : fallback

export const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((v) => text(v)).filter(Boolean) : []

export const items = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object') : []

/** Link address, or null when left empty (which hides the link). */
export const link = (value: unknown): string | null => {
  const v = text(value)
  if (!v) return null
  if (/^(https?:|mailto:)/i.test(v)) return v
  return `https://${v.replace(/^\/+/, '')}`
}

/** An image file name inside public/images/<folder>/ (or a full web address); null when empty. */
export const image = (value: unknown, folder: 'portrait' | 'projects' | 'certificates'): string | null => {
  const v = text(value)
  if (!v) return null
  if (/^(https?:)?\/\//i.test(v) || v.startsWith('/')) return v
  return `${import.meta.env.BASE_URL}images/${folder}/${encodeURIComponent(v)}`
}

export const pad = (n: number) => String(n).padStart(2, '0')

/** Stable id from text, unique by position. */
export const slug = (value: string, i: number) =>
  `${value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'item'}-${i + 1}`

const menu = (site.menu ?? {}) as Record<string, unknown>
const settings = remoteContent()?.settings ?? null
const remoteLabels: Record<string, unknown> =
  settings?.ui_labels && typeof settings.ui_labels === 'object' && !Array.isArray(settings.ui_labels) ? settings.ui_labels : {}
// A label set in site_settings.ui_labels wins; otherwise the local JSON value (see uiLabels.ts).
/** Menu label: a published section's nav_label, else the local JSON label. */
const navLabel = (slug: SectionSlug, fallback: string) => text(publishedSection(slug)?.nav_label, text(menu[slug], fallback))

export const siteText = {
  browserTabTitle: text(settings?.site_title, text(site.browserTabTitle, 'Portfolio')),
  searchDescription: text(settings?.meta_description, text(site.searchDescription)),
  menu: {
    home: navLabel('home', 'Home'),
    about: navLabel('about', 'About'),
    skills: navLabel('skills', 'Skills'),
    projects: navLabel('projects', 'Projects'),
    certificates: navLabel('certificates', 'Certificates'),
    contact: navLabel('contact', 'Contact'),
  },
  labels: Object.fromEntries(UI_LABEL_KEYS.map((k) => [k, resolveLabel(k, remoteLabels)])) as Record<UiLabelKey, string>,
}

// Browser tab title and search description come from content/site.json too.
document.title = siteText.browserTabTitle
if (siteText.searchDescription) {
  document.querySelector('meta[name="description"]')?.setAttribute('content', siteText.searchDescription)
}

/** A published block's text; '' is kept (intentionally empty), a missing block or null body falls back. */
export const blockText = (body: string | null | undefined, fallback: string): string =>
  body === null || body === undefined ? fallback : text(body)

/** Strict link for CMS values: only a well-formed https:// URL is accepted, else null (hidden). */
export const secureLink = (value: unknown): string | null => {
  const v = text(value)
  if (!/^https:\/\//i.test(v)) return null
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null
  }
}
