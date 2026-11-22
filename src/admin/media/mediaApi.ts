/**
 * The only place the admin talks to Storage.
 *   • list: walks portrait/, projects/ and certificates/ (admins may list; visitors can't).
 *   • upload: XMLHttpRequest to the Storage API so real upload progress is available
 *     (supabase-js uploads with fetch, which has no upload progress). Authorised with the
 *     signed-in admin's own access token and the publishable key — never a secret key.
 *     Sent with x-upsert: false, so an existing file is never overwritten.
 *   • remove: one path at a time; success only if Storage reports that path as deleted
 *     (a refused delete returns an empty list, not an error).
 * Storage policies (schema.sql) decide what is allowed; nothing here widens them.
 */
import { validateSupabaseEnv, type TypedSupabaseClient } from '../../lib/supabase'
import { isNetworkError, REQUEST_TIMEOUT_MS, withTimeout } from '../adminAuth'
import { BUCKET, classifyUpload, folderOf, FOLDERS, kindOf, type MediaFile, type UploadOutcome } from './mediaModel'

export type ListResult = { kind: 'ok'; files: MediaFile[]; truncated: boolean } | { kind: 'expired' } | { kind: 'denied' } | { kind: 'network' } | { kind: 'error' }

interface StorageErr {
  name?: string
  status?: number
  statusCode?: string
  message?: string
}

function classifyStorage(e: unknown): 'expired' | 'denied' | 'network' | 'error' {
  const err = (e ?? {}) as StorageErr
  const text = (err.message ?? '').toLowerCase()
  if (err.name === 'StorageUnknownError' || isNetworkError(e)) return 'network'
  if (/jwt|expired/.test(text)) return 'expired'
  if (err.status === 401 || err.status === 403 || /row-level security|unauthori|not allowed/.test(text)) return 'denied'
  return 'error'
}

const MAX_FILES = 5000
const PAGE = 1000

/** Lists every file under the three folders (depth ≤ 4). Never throws. */
export async function listMedia(sb: TypedSupabaseClient, ms = REQUEST_TIMEOUT_MS * 2): Promise<ListResult> {
  const files: MediaFile[] = []
  let truncated = false
  const walk = async (prefix: string, depth: number): Promise<void> => {
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await sb.storage.from(BUCKET).list(prefix, { limit: PAGE, offset, sortBy: { column: 'name', order: 'asc' } })
      if (error) throw error
      const items = Array.isArray(data) ? data : []
      for (const it of items) {
        if (!it || typeof it.name !== 'string' || it.name.startsWith('.')) continue
        const path = `${prefix}/${it.name}`
        if (it.id === null || it.id === undefined) {
          if (depth < 4) await walk(path, depth + 1)
          continue
        }
        const folder = folderOf(path)
        if (!folder) continue
        if (files.length >= MAX_FILES) {
          truncated = true
          return
        }
        const meta = (it.metadata ?? {}) as { size?: unknown; mimetype?: unknown }
        const mime = typeof meta.mimetype === 'string' ? meta.mimetype : null
        files.push({
          path,
          name: it.name,
          folder,
          size: typeof meta.size === 'number' ? meta.size : null,
          mime,
          kind: kindOf(mime, path),
          updatedAt: it.updated_at ?? it.created_at ?? null,
        })
      }
      if (items.length < PAGE) return
    }
  }
  try {
    await withTimeout(Promise.all(FOLDERS.map((f) => walk(f, 1))), ms)
    return { kind: 'ok', files, truncated }
  } catch (e) {
    const { name, status } = (e ?? {}) as StorageErr
    console.warn('[admin] media list failed', { name, status })
    return { kind: classifyStorage(e) }
  }
}

/** The public URL the site uses for a path (and, optionally, a resized preview URL). */
export function publicUrl(sb: TypedSupabaseClient, path: string, thumb?: number): string {
  const opts = thumb ? { transform: { width: thumb, height: thumb, resize: 'contain' as const, quality: 70 } } : undefined
  return sb.storage.from(BUCKET).getPublicUrl(path, opts).data.publicUrl
}

// ---------------------------------------------------------------------------- upload

export interface UploadRequest {
  path: string
  body: Blob
  contentType: string
  onProgress?: (fraction: number) => void
  /** Aborts the upload (e.g. the admin cancelled it). */
  signal?: AbortSignal
}

export type UploadResult = { kind: 'ok'; path: string } | { kind: Exclude<UploadOutcome, 'ok'> } | { kind: 'network' } | { kind: 'cancelled' }

/** Minimal XHR surface, injectable for tests. */
export interface XhrLike {
  open(method: string, url: string): void
  setRequestHeader(name: string, value: string): void
  send(body: Blob): void
  abort(): void
  status: number
  responseText: string
  timeout: number
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  onload: (() => void) | null
  onerror: (() => void) | null
  ontimeout: (() => void) | null
  onabort: (() => void) | null
}

export async function uploadFile(sb: TypedSupabaseClient, req: UploadRequest, makeXhr: () => XhrLike = () => new XMLHttpRequest() as unknown as XhrLike): Promise<UploadResult> {
  if (!folderOf(req.path)) return { kind: 'denied' }
  const { ok, url, key } = validateSupabaseEnv()
  if (!ok) return { kind: 'error' }
  const { data } = await sb.auth.getSession()
  const token = data.session?.access_token
  if (!token) return { kind: 'expired' }
  // Cancelled while the session was being read: send nothing.
  if (req.signal?.aborted) return { kind: 'cancelled' }
  const encoded = req.path.split('/').map(encodeURIComponent).join('/')
  return new Promise<UploadResult>((resolve) => {
    const xhr = makeXhr()
    xhr.open('POST', `${url.replace(/\/+$/, '')}/storage/v1/object/${BUCKET}/${encoded}`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('apikey', key)
    xhr.setRequestHeader('x-upsert', 'false') // never overwrite
    xhr.setRequestHeader('cache-control', 'max-age=3600')
    xhr.setRequestHeader('Content-Type', req.contentType)
    xhr.timeout = 120_000
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) req.onProgress?.(Math.min(1, e.loaded / e.total))
    }
    xhr.onload = () => {
      let body: unknown = null
      try {
        body = JSON.parse(xhr.responseText || 'null')
      } catch {
        body = null
      }
      const outcome = classifyUpload(xhr.status, body)
      if (outcome !== 'ok') console.warn('[admin] upload refused', { status: xhr.status, outcome })
      resolve(outcome === 'ok' ? { kind: 'ok', path: req.path } : { kind: outcome })
    }
    xhr.onerror = () => resolve({ kind: 'network' })
    xhr.ontimeout = () => resolve({ kind: 'network' })
    xhr.onabort = () => resolve({ kind: 'cancelled' })
    req.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(req.body)
  })
}

// ---------------------------------------------------------------------------- delete

export type DeleteResult = { kind: 'deleted' } | { kind: 'not-deleted' } | { kind: 'expired' } | { kind: 'denied' } | { kind: 'network' } | { kind: 'error' }

export async function deleteMedia(sb: TypedSupabaseClient, path: string, ms = REQUEST_TIMEOUT_MS): Promise<DeleteResult> {
  if (!folderOf(path)) return { kind: 'denied' }
  try {
    const { data, error } = await withTimeout(sb.storage.from(BUCKET).remove([path]), ms)
    if (error) {
      console.warn('[admin] media delete failed', { name: (error as StorageErr).name })
      return { kind: classifyStorage(error) }
    }
    const removed = Array.isArray(data) && data.some((o) => o && (o.name === path || `${(o as { bucket_id?: string }).bucket_id}/${o.name}` === `${BUCKET}/${path}`))
    // Nothing reported as removed: refused by policy or already gone. Never shown as success.
    return removed ? { kind: 'deleted' } : { kind: 'not-deleted' }
  } catch (e) {
    return { kind: classifyStorage(e) }
  }
}
