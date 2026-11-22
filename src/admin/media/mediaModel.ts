/**
 * Media Library model (pure: no React, no network).
 *
 * Bucket rules (supabase/schema.sql, section 13 — enforced by Storage itself):
 *   bucket "portfolio-media", public; 10 MB per file;
 *   types: image/jpeg, image/png, image/webp, image/avif, application/pdf;
 *   admins may upload / update / delete only under portrait/, projects/, certificates/.
 * The checks here mirror those rules so problems are caught before uploading; the
 * server's answer stays authoritative.
 */
import { safeMediaPath } from '../../data/remote'
import type { ContentSnapshot } from '../content/model'

export const BUCKET = 'portfolio-media'
export const FOLDERS = ['portrait', 'projects', 'certificates'] as const
export type MediaFolder = (typeof FOLDERS)[number]
export type MediaKind = 'image' | 'pdf'

export const FOLDER_NAMES: Record<MediaFolder, string> = { portrait: 'Portrait', projects: 'Projects', certificates: 'Certificates' }

/** Allowed types and their extensions (the bucket's allowed_mime_types). */
export const TYPES = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'image/avif': ['avif'],
  'application/pdf': ['pdf'],
} as const
export type MediaMime = keyof typeof TYPES

/** The bucket's file_size_limit. */
export const MAX_BYTES = 10 * 1024 * 1024

export const ACCEPT = Object.entries(TYPES)
  .flatMap(([mime, exts]) => [mime, ...exts.map((e) => `.${e}`)])
  .join(',')

export interface MediaFile {
  path: string
  name: string
  folder: MediaFolder
  size: number | null
  mime: string | null
  kind: MediaKind
  updatedAt: string | null
}

export const kindOf = (mime: string | null, path: string): MediaKind => (mime === 'application/pdf' || /\.pdf$/i.test(path) ? 'pdf' : 'image')
export const folderOf = (path: string): MediaFolder | null => {
  const top = path.split('/')[0]
  return (FOLDERS as readonly string[]).includes(top) ? (top as MediaFolder) : null
}

export function formatBytes(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return 'unknown size'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ---------------------------------------------------------------------------- validation

/** The real type from the file's first bytes (never trusts the name or the browser's guess). */
export function sniff(b: Uint8Array): MediaMime | null {
  const at = (i: number, ...v: number[]) => v.every((x, k) => b[i + k] === x)
  const ascii = (i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0))
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg'
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png'
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp'
  if (ascii(4, 'ftyp') && (ascii(8, 'avif') || ascii(8, 'avis'))) return 'image/avif'
  if (ascii(0, '%PDF-')) return 'application/pdf'
  return null
}

const extOf = (name: string) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? '').toLowerCase()

export interface FileInfo {
  name: string
  size: number
  /** The browser's guess (may be empty). */
  type: string
}

/**
 * Why this file can't be uploaded to this folder, or null. `head` = its first bytes
 * (at least 16). Checks size, extension, declared type and the actual content.
 */
export function fileProblem(file: FileInfo, head: Uint8Array, folder: MediaFolder, maxBytes = MAX_BYTES): string | null {
  if (!file.size) return 'The file is empty.'
  if (file.size > maxBytes) return `Too large: ${formatBytes(file.size)} (the limit is ${formatBytes(maxBytes)}).`
  const ext = extOf(file.name)
  const byExt = (Object.keys(TYPES) as MediaMime[]).find((m) => (TYPES[m] as readonly string[]).includes(ext))
  if (!byExt) return `Unsupported file type ".${ext || '?'}". Use JPG, PNG, WebP, AVIF or PDF.`
  if (file.type && file.type !== byExt && !(file.type === 'image/jpg' && byExt === 'image/jpeg')) return `The file says it is ${file.type} but is named .${ext}.`
  const actual = sniff(head)
  if (actual !== byExt) return actual ? `The content is ${actual}, not .${ext}. Rename or convert the file.` : 'The content isn’t a valid JPG, PNG, WebP, AVIF or PDF file.'
  if (actual === 'application/pdf' && folder !== 'certificates') return 'PDFs belong in Certificates (the site shows PDFs only for certificates).'
  return null
}

/** The type to upload with (from the verified content). */
export const mimeOf = (head: Uint8Array): MediaMime | null => sniff(head)

/** Lowercase, ASCII letters/digits/hyphens, no path parts. */
export function safeBaseName(name: string): string {
  const base = name.replace(/\.[^.]*$/, '')
  return (
    base
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50)
      .replace(/-+$/, '') || 'file'
  )
}

/** 6 random base-36 characters (crypto), so two uploads of the same name never collide. */
export function randomSuffix(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return [...bytes].map((x) => (x % 36).toString(36)).join('')
}

/**
 * Where a file is stored: <folder>/<safe-name>-<random>.<ext>, with certificates split
 * into images/ and pdfs/ (the convention in schema.sql). Never overwrites: the random
 * part makes the path new, and uploads are sent with "no overwrite" as well.
 */
export function uploadPath(folder: MediaFolder, fileName: string, mime: MediaMime, suffix = randomSuffix()): string {
  const ext = mime === 'image/jpeg' ? 'jpg' : TYPES[mime][0]
  const dir = folder === 'certificates' ? (mime === 'application/pdf' ? 'certificates/pdfs' : 'certificates/images') : folder
  const path = `${dir}/${safeBaseName(fileName)}-${suffix}.${ext}`
  if (safeMediaPath(path) !== path || !folderOf(path)) throw new Error('unsafe path')
  return path
}

// ---------------------------------------------------------------------------- upload responses

export type UploadOutcome = 'ok' | 'duplicate' | 'too-large' | 'type' | 'denied' | 'expired' | 'error'

/** Classifies a Storage upload response (status + JSON body). */
export function classifyUpload(status: number, body: unknown): UploadOutcome {
  const b = (body && typeof body === 'object' ? body : {}) as { statusCode?: string | number; error?: string; message?: string }
  const code = Number(b.statusCode ?? status)
  const text = `${b.error ?? ''} ${b.message ?? ''}`.toLowerCase()
  if (status >= 200 && status < 300) return 'ok'
  if (code === 409 || /duplicate|already exists/.test(text)) return 'duplicate'
  if (code === 413 || /too large|payload/.test(text)) return 'too-large'
  if (code === 415 || /mime|content type/.test(text)) return 'type'
  if (/jwt|token.*expired|expired/.test(text)) return 'expired'
  if (code === 401 || code === 403 || /row-level security|unauthori|not allowed|policy/.test(text)) return 'denied'
  return 'error'
}

export const UPLOAD_MESSAGES: Record<Exclude<UploadOutcome, 'ok'>, string> = {
  duplicate: 'A file already exists at that path; nothing was overwritten.',
  'too-large': 'Storage rejected the file as too large.',
  type: 'Storage rejected this file type.',
  denied: 'Storage refused the upload. Your account may no longer be an administrator.',
  expired: 'Your session has expired. Sign in again and retry.',
  error: 'The upload failed. Nothing was stored.',
}

// ---------------------------------------------------------------------------- browse

export interface MediaFilter {
  folder: MediaFolder | 'all'
  kind: MediaKind | 'all'
  query: string
}

export function filterMedia(files: readonly MediaFile[], f: MediaFilter): MediaFile[] {
  const q = f.query.trim().toLowerCase()
  return files
    .filter((m) => (f.folder === 'all' || m.folder === f.folder) && (f.kind === 'all' || m.kind === f.kind) && (!q || m.path.toLowerCase().includes(q)))
    .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.path.localeCompare(b.path))
}

// ---------------------------------------------------------------------------- references

export interface MediaRef {
  table: 'content_blocks' | 'projects' | 'certificates'
  id: string
  label: string
  field: string
  status: 'draft' | 'published'
}

/** Every content row that points at this path (drafts included). */
export function findReferences(snap: ContentSnapshot, path: string): MediaRef[] {
  const refs: MediaRef[] = []
  const sectionSlug = (id: string) => snap.sections.find((s) => s.id === id)?.slug ?? 'section'
  for (const b of snap.blocks) if (b.image_path === path) refs.push({ table: 'content_blocks', id: b.id, label: `${sectionSlug(b.section_id)} · ${b.key}`, field: 'image', status: b.status })
  for (const p of snap.projects) if (p.image_path === path) refs.push({ table: 'projects', id: p.id, label: `Project: ${p.title}`, field: 'screenshot', status: p.status })
  for (const c of snap.certificates) {
    if (c.image_path === path) refs.push({ table: 'certificates', id: c.id, label: `Certificate: ${c.title}`, field: 'picture', status: c.status })
    if (c.pdf_path === path) refs.push({ table: 'certificates', id: c.id, label: `Certificate: ${c.title}`, field: 'PDF', status: c.status })
  }
  return refs
}

export type UsageState = 'published' | 'draft' | 'unused'
export const usageOf = (refs: readonly MediaRef[]): UsageState => (refs.some((r) => r.status === 'published') ? 'published' : refs.length ? 'draft' : 'unused')
export const USAGE_TEXT: Record<UsageState, string> = { published: 'Used by published content', draft: 'Used by draft content', unused: 'Not used' }

/** Why this file can't be deleted, or null. */
export function deleteProblem(path: string, refs: readonly MediaRef[]): string | null {
  if (!folderOf(path) || safeMediaPath(path) !== path) return 'Only files inside portrait/, projects/ or certificates/ can be deleted here.'
  if (refs.length) return `In use by ${refs.length} content item${refs.length === 1 ? '' : 's'} (${refs.map((r) => r.label).join('; ')}). Remove it from that content first.`
  return null
}
