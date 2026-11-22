/**
 * The small interface labels the site shows, with their fallbacks. One list, used by the
 * public site (data/content.ts) and by the admin's General editor, so both agree on which
 * site_settings.ui_labels keys exist and what is shown when a label isn't set.
 *
 * Order of precedence on the site: a non-empty ui_labels value → content/site.json
 * smallLabels → the fallback below.
 */
import site from '../../content/site.json'

export const UI_LABEL_FALLBACKS = {
  projectPreviewPlaceholder: 'Project preview',
  certificatePlaceholder: 'Certificate',
  untitledCertificate: 'Certificate',
  githubLink: 'GitHub',
  liveSiteLink: 'Live site',
  viewCredentialLink: 'View credential',
  viewPdfLink: 'View PDF',
  emailIconTooltip: 'Email',
  linkedinIconTooltip: 'LinkedIn',
  githubIconTooltip: 'GitHub',
} as const

export type UiLabelKey = keyof typeof UI_LABEL_FALLBACKS
export const UI_LABEL_KEYS = Object.keys(UI_LABEL_FALLBACKS) as UiLabelKey[]

/** What a value means as text (same rule as data/content.ts `text`). */
const asText = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')

/** The label shown when site_settings.ui_labels doesn't set it (content/site.json, then the fallback). */
export function localLabel(key: UiLabelKey): string {
  const small = (site.smallLabels ?? {}) as Record<string, unknown>
  return asText(small[key]) || UI_LABEL_FALLBACKS[key]
}

/** The label the site shows for these stored ui_labels. */
export function resolveLabel(key: UiLabelKey, remote: Record<string, unknown>): string {
  return (Object.hasOwn(remote, key) && asText(remote[key])) || localLabel(key)
}
