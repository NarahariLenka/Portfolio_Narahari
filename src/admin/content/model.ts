/**
 * Content CMS model (pure, no React, no network).
 *
 * How the public site uses the content tables (src/data/*.ts, remoteLoader.ts):
 *   • A section's database content is used only while that SECTION is published.
 *     While it is a draft, the site shows the local JSON (content/*.json) for it.
 *   • List items (skills, projects, certificates, social links) appear only if the
 *     item itself is published AND visible. A published section's list is
 *     authoritative, even when empty.
 *   • Text blocks appear only if the block is published AND visible and its section is
 *     published AND visible; a missing block falls back to the local JSON text.
 *   • Sections keep a fixed order (App.tsx); Home is always shown.
 * Only fields with such a path to the page are editable here.
 */
import aboutJson from '../../../content/about.json'
import certificatesJson from '../../../content/certificates.json'
import contactJson from '../../../content/contact.json'
import homeJson from '../../../content/home.json'
import projectsJson from '../../../content/projects.json'
import skillsJson from '../../../content/skills.json'
import type { Database } from '../../lib/database.types'
import { safeMediaPath, SECTION_SLUGS, type SectionSlug } from '../../data/remote'
import { localLabel } from '../../data/uiLabels'

type Tables = Database['public']['Tables']
export type SectionRow = Tables['sections']['Row']
export type BlockRow = Tables['content_blocks']['Row']
export type SkillRow = Tables['skills']['Row']
export type ProjectRow = Tables['projects']['Row']
export type CertificateRow = Tables['certificates']['Row']
export type SocialRow = Tables['social_links']['Row']
export type ListTable = 'skills' | 'projects' | 'certificates' | 'social_links'
export type ContentTable = 'sections' | 'content_blocks' | ListTable
export type ListRow = SkillRow | ProjectRow | CertificateRow | SocialRow
export type AnyRow = SectionRow | BlockRow | ListRow
export type Status = 'draft' | 'published'

export interface ContentSnapshot {
  sections: SectionRow[]
  blocks: BlockRow[]
  skills: SkillRow[]
  projects: ProjectRow[]
  certificates: CertificateRow[]
  social_links: SocialRow[]
}

export const SECTION_NAMES: Record<SectionSlug, string> = {
  home: 'Home / Hero',
  about: 'About',
  skills: 'Skills',
  projects: 'Projects',
  certificates: 'Certificates',
  contact: 'Contact',
}

/** Which list table a section owns. */
export const SECTION_LIST: Partial<Record<SectionSlug, ListTable>> = {
  skills: 'skills',
  projects: 'projects',
  certificates: 'certificates',
  contact: 'social_links',
}

export const LIST_NAMES: Record<ListTable, { one: string; many: string }> = {
  skills: { one: 'skill', many: 'Skills' },
  projects: { one: 'project', many: 'Projects' },
  certificates: { one: 'certificate', many: 'Certificates' },
  social_links: { one: 'contact link', many: 'Contact links' },
}

/** The only social platforms the Contact dock reads (src/data/profile.ts). */
export const SOCIAL_PLATFORMS = ['email', 'github', 'linkedin'] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

// ---------------------------------------------------------------------------- fields

export type FieldKind = 'text' | 'textarea' | 'list' | 'https' | 'social-url' | 'media' | 'pdf' | 'position' | 'date' | 'number'

export interface FieldSpec {
  key: string
  label: string
  kind: FieldKind
  /** Characters (as PostgreSQL counts them) for text, or per item for lists. */
  max?: number
  required?: boolean
  /** Lists: maximum number of items (database cardinality limit). */
  maxItems?: number
  /** Media fields: the library folder the picker opens in. */
  folder?: 'portrait' | 'projects' | 'certificates'
  help?: string
}

const IMAGE_HELP = 'A file in the portfolio-media bucket. Choose or upload one with the library button, or type an existing path.'

export const LIST_FIELDS: Record<ListTable, FieldSpec[]> = {
  skills: [
    { key: 'name', label: 'Name', kind: 'text', max: 60, required: true },
    { key: 'description', label: 'Description', kind: 'textarea', max: 400, help: 'One short line shown when the skill is active in the spiral.' },
    { key: 'tools', label: 'Tools', kind: 'list', max: 60, maxItems: 30, help: 'One per line.' },
  ],
  projects: [
    { key: 'title', label: 'Title', kind: 'text', max: 120, required: true },
    { key: 'description', label: 'Description', kind: 'textarea', max: 1500 },
    { key: 'technologies', label: 'Technologies', kind: 'list', max: 60, maxItems: 20, help: 'One per line.' },
    { key: 'github_url', label: 'GitHub link', kind: 'https', max: 500, help: 'https:// only. Empty hides the link.' },
    { key: 'live_url', label: 'Live demo link', kind: 'https', max: 500, help: 'https:// only. Empty hides the link.' },
    { key: 'image_path', label: 'Screenshot (storage path)', kind: 'media', max: 300, help: IMAGE_HELP, folder: 'projects' },
    { key: 'image_alt', label: 'Screenshot description', kind: 'text', max: 300 },
    { key: 'image_position', label: 'Screenshot crop', kind: 'position', max: 20, help: 'CSS position such as "50% 0%" or "center top". Empty = top of the image.' },
  ],
  certificates: [
    { key: 'title', label: 'Title', kind: 'text', max: 160, required: true },
    { key: 'issuer', label: 'Issuer', kind: 'text', max: 120 },
    { key: 'issued_label', label: 'Date as shown', kind: 'text', max: 40, help: 'Free text, e.g. "March 2026". Shown instead of the date below if set.' },
    { key: 'issued_on', label: 'Date', kind: 'date', help: 'YYYY-MM-DD. Shown as e.g. "Mar 2026" when "Date as shown" is empty.' },
    { key: 'credential_url', label: 'Credential link', kind: 'https', max: 500, help: 'https:// only. Empty hides the link.' },
    { key: 'image_path', label: 'Picture (storage path)', kind: 'media', max: 300, help: IMAGE_HELP, folder: 'certificates' },
    { key: 'image_alt', label: 'Picture description', kind: 'text', max: 300 },
    { key: 'pdf_path', label: 'PDF (storage path)', kind: 'pdf', max: 300, help: 'A .pdf file in the portfolio-media bucket. Choose or upload one with the library button.', folder: 'certificates' },
  ],
  social_links: [
    { key: 'label', label: 'Tooltip', kind: 'text', max: 40, required: true },
    { key: 'url', label: 'Link', kind: 'social-url', max: 500, required: true, help: 'Email: mailto:name@domain.com. GitHub / LinkedIn: https:// only.' },
  ],
}

export const SECTION_FIELDS: FieldSpec[] = [
  { key: 'title', label: 'Section heading', kind: 'text', max: 80, required: true, help: 'The small label next to the number, e.g. "About".' },
  { key: 'number', label: 'Section number', kind: 'number', max: 3, help: 'Digits only, e.g. 02. Empty hides the number.' },
  { key: 'nav_label', label: 'Menu label', kind: 'text', max: 40, help: 'Empty = the default menu label.' },
]

export interface BlockSpec {
  key: string
  label: string
  /** Which block columns the site reads for this key. */
  field: 'body' | 'image' | 'words'
  max?: number
  multiline?: boolean
  help?: string
}

/** Blocks the public site reads, per section (src/data/hero.ts, profile.ts). */
export const SECTION_BLOCKS: Partial<Record<SectionSlug, BlockSpec[]>> = {
  home: [
    { key: 'greeting', label: 'Greeting above the name', field: 'body', max: 200, help: 'The name itself is the Owner name in General.' },
    { key: 'portrait', label: 'Portrait', field: 'image' },
  ],
  about: [
    { key: 'main_sentence', label: 'Main sentence', field: 'body', max: 5000, multiline: true, help: 'The large statement revealed word by word.' },
    { key: 'paragraph', label: 'Paragraph', field: 'body', max: 5000, multiline: true },
  ],
  contact: [{ key: 'headline', label: 'Closing headline', field: 'words', max: 30, help: 'One word per line, shown one word per line on the split-flap board.' }],
}

// ---------------------------------------------------------------------------- validation

export const charLength = (s: string) => [...s].length
const POSITION = [
  /^((100|[1-9]?[0-9])%|left|center|right|top|bottom)$/,
  /^((100|[1-9]?[0-9])%|left|center|right) ((100|[1-9]?[0-9])%|top|center|bottom)$/,
  /^(top|center|bottom) (left|center|right)$/,
]
const MAILTO = /^mailto:[^\s@/?]+@[^\s@/?]+\.[^\s@/?]+$/i

export function httpsProblem(v: string): string | null {
  if (!/^https:\/\//i.test(v)) return 'Must start with https://.'
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' || !u.hostname.includes('.')) return 'Not a valid web address.'
  } catch {
    return 'Not a valid web address.'
  }
  return /\s/.test(v) ? 'Remove the spaces.' : null
}

export function socialUrlProblem(platform: string, v: string): string | null {
  if (platform === 'email') return MAILTO.test(v) ? null : 'Must be mailto:name@domain.com.'
  return httpsProblem(v)
}

export function dateProblem(v: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return 'Use YYYY-MM-DD.'
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? null : 'Not a real date.'
}

export function mediaPathProblem(v: string, pdf = false): string | null {
  if (safeMediaPath(v) !== v) return 'Use a plain path inside the bucket, e.g. projects/name.webp (no leading /, no web address).'
  if (pdf && !/\.pdf$/i.test(v)) return 'Must end with .pdf.'
  return null
}

/**
 * Why a value can't be saved for this field, or null. `value` is what the form holds:
 * a string (empty = not set), or a string[] for lists.
 */
export function fieldProblem(spec: FieldSpec, value: unknown, ctx: { platform?: string } = {}): string | null {
  if (spec.kind === 'list') {
    if (!Array.isArray(value) || value.some((x) => typeof x !== 'string')) return `${spec.label}: invalid list.`
    if (spec.maxItems !== undefined && value.length > spec.maxItems) return `${spec.label}: at most ${spec.maxItems} items.`
    const long = value.find((x) => charLength(x) > (spec.max ?? Infinity))
    if (long) return `${spec.label}: "${long.slice(0, 20)}…" is longer than ${spec.max} characters.`
    return null
  }
  if (value !== null && typeof value !== 'string') return `${spec.label}: invalid value.`
  const v = (value ?? '') as string
  if (!v.trim()) return spec.required ? `${spec.label} is required.` : null
  if (spec.max !== undefined && charLength(v) > spec.max) return `${spec.label} is too long (${charLength(v)} of ${spec.max}).`
  const label = (p: string | null) => (p ? `${spec.label}: ${p}` : null)
  switch (spec.kind) {
    case 'https':
      return label(httpsProblem(v))
    case 'social-url':
      return label(socialUrlProblem(ctx.platform ?? '', v))
    case 'media':
      return label(mediaPathProblem(v))
    case 'pdf':
      return label(mediaPathProblem(v, true))
    case 'position':
      return POSITION.some((r) => r.test(v)) ? null : `${spec.label}: not a supported position (e.g. "50% 0%", "center top").`
    case 'date':
      return label(dateProblem(v))
    case 'number':
      return /^[0-9]{1,3}$/.test(v) ? null : `${spec.label}: digits only (up to 3).`
    default:
      return null
  }
}

/** Form value → database value: empty optional text becomes null; lists are trimmed. */
export function toDb(spec: FieldSpec, value: unknown): unknown {
  if (spec.kind === 'list') return (value as string[]).map((x) => x.trim()).filter(Boolean)
  const v = typeof value === 'string' ? value : ''
  if (spec.required) return v
  return v.trim() ? v : null
}

/** Database value → form value. */
export function toForm(spec: FieldSpec, value: unknown): string | string[] {
  if (spec.kind === 'list') return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : []
  return typeof value === 'string' ? value : value == null ? '' : String(value)
}

// ---------------------------------------------------------------------------- state

export const sectionOf = (snap: ContentSnapshot, slug: SectionSlug) => snap.sections.find((s) => s.slug === slug) ?? null
export const isLive = (section: SectionRow | null) => section?.status === 'published'

export type RowState = 'live' | 'hidden' | 'draft' | 'with-section'

/** What visitors see of one list item. */
export function rowState(row: { status: Status; is_visible: boolean }, section: SectionRow | null): RowState {
  if (row.status === 'draft') return 'draft'
  if (!row.is_visible) return 'hidden'
  return isLive(section) ? 'live' : 'with-section'
}

export const ROW_STATE_TEXT: Record<RowState, string> = {
  live: 'Live',
  hidden: 'Hidden',
  draft: 'Draft',
  'with-section': 'Published (goes live with the section)',
}

/** Rows in display order: sort_order, then created_at (as the public loader orders them). */
export function ordered<T extends { sort_order: number; created_at: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
}

/** New sort_order values for a reordered list: only rows whose value changes are returned. */
export function reorderPlan<T extends { id: string; sort_order: number }>(rowsInNewOrder: readonly T[]): { id: string; sort_order: number }[] {
  return rowsInNewOrder.map((r, i) => ({ id: r.id, sort_order: (i + 1) * 10 })).filter((p, i) => rowsInNewOrder[i].sort_order !== p.sort_order)
}

export const nextSortOrder = (rows: readonly { sort_order: number }[]) => (rows.length ? Math.max(...rows.map((r) => r.sort_order)) + 10 : 10)

/** A unique slug from a name (format per table constraint). */
export function uniqueSlug(name: string, taken: readonly string[], maxLen: number): string {
  const base =
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, maxLen - 4) || 'item'
  const set = new Set(taken)
  if (!set.has(base)) return base
  for (let i = 2; ; i++) if (!set.has(`${base}-${i}`)) return `${base}-${i}`
}

export const SLUG_MAX: Record<ListTable, number> = { skills: 61, projects: 81, certificates: 81, social_links: 31 }

// ---------------------------------------------------------------------------- publish checks

export interface PublishCheck {
  /** Problems that would break or empty the section: publishing is blocked. */
  blocking: string[]
  /** Visible differences worth knowing before going live. */
  warnings: string[]
  /** Draft items/blocks that can be published together with the section. */
  drafts: { table: 'content_blocks' | ListTable; id: string; label: string }[]
}

const label = (r: ListRow) => ('name' in r ? r.name : 'title' in r ? r.title : `${r.platform} (${r.label})`)

/** What publishing this section would change for visitors. */
export function publishCheck(snap: ContentSnapshot, slug: SectionSlug): PublishCheck {
  const section = sectionOf(snap, slug)
  const out: PublishCheck = { blocking: [], warnings: [], drafts: [] }
  if (!section) {
    out.blocking.push('This section has no database record, so it can’t be published.')
    return out
  }
  const blocks = snap.blocks.filter((b) => b.section_id === section.id)
  for (const spec of SECTION_BLOCKS[slug] ?? []) {
    const b = blocks.find((x) => x.key === spec.key)
    if (!b) out.warnings.push(`${spec.label}: not in the database; the site keeps showing the built-in text.`)
    else if (b.status === 'draft') out.drafts.push({ table: 'content_blocks', id: b.id, label: spec.label })
    else if (!b.is_visible) out.warnings.push(`${spec.label}: hidden; the site shows the built-in text instead.`)
  }
  const table = SECTION_LIST[slug]
  if (table) {
    const rows = snap[table] as ListRow[]
    for (const r of rows) if (r.status === 'draft') out.drafts.push({ table, id: r.id, label: label(r) })
    const shown = (includeDrafts: boolean) => rows.filter((r) => (r.status === 'published' || includeDrafts) && r.is_visible)
    const all = shown(true).length
    if (table === 'skills' && all === 0) out.blocking.push('No visible skills: publishing would hide the whole Skills section (the spiral needs at least one).')
    else if (all === 0) out.warnings.push(`No visible ${LIST_NAMES[table].many.toLowerCase()}: the published list will be empty.`)
    if (table === 'social_links') {
      for (const p of SOCIAL_PLATFORMS) {
        const r = (shown(true) as SocialRow[]).find((x) => x.platform === p)
        if (!r) out.warnings.push(`No visible ${p} link: its icon disappears from the Contact dock.`)
      }
    }
  }
  if (!section.is_visible && slug !== 'home') out.warnings.push('The section is set to hidden: publishing hides it (and its menu item) for visitors.')
  return out
}

// ---------------------------------------------------------------------------- import

const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
const words = (v: unknown) => (Array.isArray(v) ? v.map(s).filter(Boolean) : [])
/** Local links may omit the scheme (the site adds https://); only https:// can be stored. */
function httpsFrom(v: unknown): string | null {
  const t = s(v)
  if (!t) return null
  const full = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t.replace(/^\/+/, '')}`
  return httpsProblem(full) ? null : full
}

export interface ImportPlan {
  blocks: { key: string; body?: string | null; data?: string[] | null; image_alt?: string | null }[]
  rows: Record<string, unknown>[]
  /** Values that couldn't be copied as they are (reported, never guessed). */
  notes: string[]
}

/**
 * The section's current built-in content (content/*.json) as database rows, so it can be
 * edited here instead of re-typed. Copies only what the site shows today; nothing is
 * invented. Images: the local files are not in the media bucket, so paths are not copied
 * (the site keeps its local portrait while no portrait path is set).
 */
export function importPlan(slug: SectionSlug, snap: ContentSnapshot): ImportPlan {
  const plan: ImportPlan = { blocks: [], rows: [], notes: [] }
  const add = (key: string, b: Omit<ImportPlan['blocks'][number], 'key'>) => plan.blocks.push({ key, ...b })
  if (slug === 'home') {
    if (s(homeJson.greeting)) add('greeting', { body: s(homeJson.greeting) })
    if (s(homeJson.portraitDescription)) add('portrait', { image_alt: s(homeJson.portraitDescription) })
  } else if (slug === 'about') {
    if (s(aboutJson.mainSentence)) add('main_sentence', { body: s(aboutJson.mainSentence) })
    if (s(aboutJson.paragraph)) add('paragraph', { body: s(aboutJson.paragraph) })
  } else if (slug === 'contact') {
    const w = words(contactJson.bigHeadline)
    if (w.length) add('headline', { data: w })
  }
  const taken = (t: ListTable) => (snap[t] as { slug?: string; platform?: string }[]).map((r) => r.slug ?? r.platform ?? '')
  if (slug === 'skills') {
    const used = taken('skills')
    skillsJson.skills.forEach((k, i) => {
      const name = s(k.name)
      if (!name) return
      const slugv = uniqueSlug(name, used, SLUG_MAX.skills)
      used.push(slugv)
      plan.rows.push({ slug: slugv, name, description: s(k.description) || null, tools: words(k.tools), sort_order: (i + 1) * 10 })
    })
  } else if (slug === 'projects') {
    const used = taken('projects')
    projectsJson.projects.forEach((p, i) => {
      const title = s(p.title)
      if (!title) return
      const slugv = uniqueSlug(title, used, SLUG_MAX.projects)
      used.push(slugv)
      const github = httpsFrom(p.githubLink)
      const live = httpsFrom(p.liveLink)
      if (s(p.githubLink) && !github) plan.notes.push(`${title}: GitHub link isn’t https:// and was left empty.`)
      if (s(p.liveLink) && !live) plan.notes.push(`${title}: live link isn’t https:// and was left empty.`)
      if (s(p.image)) plan.notes.push(`${title}: the local screenshot isn’t in the media bucket and was not copied.`)
      plan.rows.push({ slug: slugv, title, description: s(p.description) || null, technologies: words(p.technologies), github_url: github, live_url: live, is_featured: false, sort_order: (i + 1) * 10 })
    })
  } else if (slug === 'certificates') {
    const used = taken('certificates')
    certificatesJson.certificates.forEach((c, i) => {
      const title = s(c.title) || `Certificate ${String(i + 1).padStart(2, '0')}`
      const slugv = uniqueSlug(title, used, SLUG_MAX.certificates)
      used.push(slugv)
      const cred = httpsFrom(c.credentialLink)
      if (s(c.credentialLink) && !cred) plan.notes.push(`${title}: credential link isn’t https:// and was left empty.`)
      if (s(c.image)) plan.notes.push(`${title}: the local picture isn’t in the media bucket and was not copied.`)
      if (!s(c.title)) plan.notes.push(`Certificate ${i + 1} has no title locally; it was named "${title}".`)
      plan.rows.push({ slug: slugv, title, issuer: s(c.issuer) || null, issued_label: s(c.date).slice(0, 40) || null, credential_url: cred, sort_order: (i + 1) * 10 })
    })
  } else if (slug === 'contact') {
    const email = s(contactJson.email).replace(/^mailto:/i, '')
    const rows: [SocialPlatform, string | null][] = [
      ['email', email ? `mailto:${email}` : null],
      ['github', httpsFrom(contactJson.githubLink)],
      ['linkedin', httpsFrom(contactJson.linkedinLink)],
    ]
    const tips = { email: localLabel('emailIconTooltip'), github: localLabel('githubIconTooltip'), linkedin: localLabel('linkedinIconTooltip') }
    rows.forEach(([platform, url], i) => {
      if (!url || socialUrlProblem(platform, url)) {
        if (url) plan.notes.push(`${platform}: the local link isn’t valid for the database and was skipped.`)
        return
      }
      plan.rows.push({ platform, label: tips[platform], url, sort_order: (i + 1) * 10 })
    })
  }
  return plan
}

/** Import is offered only for a draft section whose database content is still empty. */
export function canImport(snap: ContentSnapshot, slug: SectionSlug): boolean {
  const section = sectionOf(snap, slug)
  if (!section || isLive(section)) return false
  const table = SECTION_LIST[slug]
  const hasBlocks = snap.blocks.some((b) => b.section_id === section.id)
  const hasRows = table ? (snap[table] as unknown[]).length > 0 : false
  return !hasBlocks && !hasRows && (!!SECTION_BLOCKS[slug]?.length || !!table)
}

export const ALL_SECTIONS: readonly SectionSlug[] = SECTION_SLUGS

/**
 * Deliberate confirmation for permanently deleting a project: the exact title (case and
 * surrounding spaces ignored) or the word DELETE (in capitals).
 */
export function deleteConfirmed(typed: string, title: string): boolean {
  const t = typed.trim()
  return t === 'DELETE' || (!!title.trim() && t.toLowerCase() === title.trim().toLowerCase())
}
