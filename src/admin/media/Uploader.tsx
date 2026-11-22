/**
 * Drag-and-drop or file-picker upload. Each file is checked (size, extension, declared type
 * and actual content) before anything is sent, stored under a new unique path, and shown
 * with real upload progress. Local previews use object URLs that are revoked when done.
 */
import { useEffect, useRef, useState } from 'react'
import { useAdminSession } from '../settings/AdminSession'
import { uploadFile } from './mediaApi'
import { ACCEPT, FOLDER_NAMES, FOLDERS, fileProblem, formatBytes, mimeOf, UPLOAD_MESSAGES, uploadPath, type MediaFolder } from './mediaModel'

interface Item {
  id: string
  name: string
  size: number
  preview: string | null
  state: 'checking' | 'invalid' | 'uploading' | 'done' | 'failed'
  progress: number | null
  message?: string
  path?: string
}

export default function Uploader({ folder: lockedFolder, defaultFolder = 'projects', onUploaded }: { folder?: MediaFolder; defaultFolder?: MediaFolder; onUploaded: (path: string) => void }) {
  const { sb, onSessionExpired, onAccessRefused } = useAdminSession()
  const [folder, setFolder] = useState<MediaFolder>(lockedFolder ?? defaultFolder)
  const [items, setItems] = useState<Item[]>([])
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef(new Set<string>())
  const aborts = useRef(new Set<AbortController>())
  const counter = useRef(0)

  // Revoke every preview URL and abort running uploads when the uploader goes away.
  useEffect(() => {
    const u = urls.current
    const a = aborts.current
    return () => {
      u.forEach((x) => URL.revokeObjectURL(x))
      a.forEach((c) => c.abort())
    }
  }, [])

  const patch = (id: string, p: Partial<Item>) => setItems((list) => list.map((it) => (it.id === id ? { ...it, ...p } : it)))
  const release = (url: string | null) => {
    if (url && urls.current.delete(url)) URL.revokeObjectURL(url)
  }

  async function handle(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const id = `${file.name}-${file.size}-${++counter.current}`
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
      if (preview) urls.current.add(preview)
      setItems((list) => [{ id, name: file.name, size: file.size, preview, state: 'checking', progress: null }, ...list])
      const head = new Uint8Array(await file.slice(0, 32).arrayBuffer())
      const problem = fileProblem({ name: file.name, size: file.size, type: file.type }, head, folder)
      const mime = mimeOf(head)
      if (problem || !mime) {
        // A rejected file can't be previewed reliably: drop its preview (and its object URL).
        release(preview)
        patch(id, { state: 'invalid', preview: null, message: problem ?? 'Unsupported file.' })
        continue
      }
      const path = uploadPath(folder, file.name, mime)
      const ctrl = new AbortController()
      aborts.current.add(ctrl)
      patch(id, { state: 'uploading', path })
      const r = await uploadFile(sb, { path, body: file, contentType: mime, signal: ctrl.signal, onProgress: (f) => patch(id, { progress: f }) })
      aborts.current.delete(ctrl)
      if (r.kind === 'ok') {
        patch(id, { state: 'done', progress: 1, message: 'Uploaded.' })
        release(preview)
        patch(id, { preview: null })
        onUploaded(r.path)
      } else {
        const message = r.kind === 'network' ? 'Connection problem: the upload didn’t finish. Nothing was stored (or reload the library to check).' : r.kind === 'cancelled' ? 'Cancelled.' : UPLOAD_MESSAGES[r.kind]
        patch(id, { state: 'failed', message })
        if (r.kind === 'expired') onSessionExpired()
        if (r.kind === 'denied') onAccessRefused()
      }
    }
  }

  const dismiss = (it: Item) => {
    release(it.preview)
    setItems((list) => list.filter((x) => x.id !== it.id))
  }

  return (
    <div className="adm-uploader">
      <div className="adm-uploader__row">
        {lockedFolder ? (
          <span className="adm-setting__hint">Uploads go to {FOLDER_NAMES[lockedFolder]}.</span>
        ) : (
          <label className="adm-uploader__folder">
            <span>Upload to</span>
            <select className="adm-input" value={folder} onChange={(e) => setFolder(e.target.value as MediaFolder)}>
              {FOLDERS.map((f) => (
                <option key={f} value={f}>
                  {FOLDER_NAMES[f]}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div
        className={`adm-drop${over ? ' adm-drop--over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setOver(false)
          if (e.dataTransfer.files.length) void handle(e.dataTransfer.files)
        }}
      >
        <p>Drop files here, or</p>
        <button type="button" className="adm-button adm-button--quiet" onClick={() => input.current?.click()}>
          Choose files…
        </button>
        <p className="adm-setting__hint">
          JPG, PNG, WebP or AVIF{folder === 'certificates' ? ', or PDF' : ''}; up to 10 MB each. Files get a new unique name; nothing is overwritten.
        </p>
        <input
          ref={input}
          type="file"
          multiple
          accept={folder === 'certificates' ? ACCEPT : ACCEPT.split(',').filter((t) => !/pdf/.test(t)).join(',')}
          hidden
          onChange={(e) => {
            if (e.target.files?.length) void handle(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
      {items.length > 0 && (
        <ul className="adm-uploads" aria-live="polite">
          {items.map((it) => (
            <li key={it.id} className={`adm-upload adm-upload--${it.state}`}>
              {it.preview ? <img src={it.preview} alt="" className="adm-upload__preview" /> : <span className="adm-upload__preview" aria-hidden="true" />}
              <div className="adm-upload__main">
                <span className="adm-upload__name">
                  {it.name} <span className="adm-setting__hint">({formatBytes(it.size)})</span>
                </span>
                {it.state === 'uploading' &&
                  (it.progress === null ? (
                    <span className="adm-setting__hint">Uploading… (progress not reported by this browser)</span>
                  ) : (
                    <progress max={1} value={it.progress} aria-label={`Uploading ${it.name}`}>
                      {Math.round(it.progress * 100)}%
                    </progress>
                  ))}
                {it.state === 'checking' && <span className="adm-setting__hint">Checking…</span>}
                {it.message && <span className={it.state === 'done' ? 'adm-upload__ok' : 'adm-setting__error'}>{it.message}</span>}
                {it.path && it.state === 'done' && <code className="adm-upload__path">{it.path}</code>}
              </div>
              {it.state !== 'uploading' && it.state !== 'checking' && (
                <button type="button" className="adm-reset" onClick={() => dismiss(it)} aria-label={`Dismiss ${it.name}`}>
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
