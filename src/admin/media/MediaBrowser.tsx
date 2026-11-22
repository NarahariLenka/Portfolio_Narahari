/**
 * Browses the media bucket: folder / type filters, filename search, thumbnails, file details
 * with usage, uploads. Two modes:
 *   library  — details include a guarded Delete (unused files only, re-checked first)
 *   pick     — details include "Use this file", which hands the path to the caller (a
 *              content form's unsaved draft); nothing is saved or published here
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Notice } from '../editor/controls'
import { useAdminSession } from '../settings/AdminSession'
import { loadContent } from '../content/api'
import type { ContentSnapshot } from '../content/model'
import { deleteMedia, listMedia, publicUrl } from './mediaApi'
import {
  deleteProblem,
  filterMedia,
  findReferences,
  FOLDER_NAMES,
  FOLDERS,
  formatBytes,
  usageOf,
  USAGE_TEXT,
  type MediaFile,
  type MediaFilter,
  type MediaFolder,
  type MediaKind,
} from './mediaModel'
import MediaThumb from './MediaThumb'
import Uploader from './Uploader'

type Load = 'loading' | 'ready' | 'network' | 'denied' | 'error'

interface Props {
  mode: 'library' | 'pick'
  folder?: MediaFolder
  kind?: MediaKind
  onPick?: (path: string) => void
  /** Currently selected path (pick mode), highlighted. */
  current?: string
}

export default function MediaBrowser({ mode, folder, kind, onPick, current }: Props) {
  const { sb, onSessionExpired, onAccessRefused } = useAdminSession()
  const [load, setLoad] = useState<Load>('loading')
  const [files, setFiles] = useState<MediaFile[]>([])
  const [truncated, setTruncated] = useState(false)
  const [snap, setSnap] = useState<ContentSnapshot | null>(null)
  const [filter, setFilter] = useState<MediaFilter>({ folder: folder ?? 'all', kind: kind ?? 'all', query: '' })
  const [selected, setSelected] = useState<string | null>(current || null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const id = ++seq.current
    setLoad('loading')
    const [list, content] = await Promise.all([listMedia(sb), loadContent(sb)])
    if (id !== seq.current) return
    if (list.kind === 'expired' || content.kind === 'expired') return onSessionExpired()
    if (list.kind !== 'ok') {
      if (list.kind === 'denied') onAccessRefused()
      return setLoad(list.kind)
    }
    setFiles(list.files)
    setTruncated(list.truncated)
    setSnap(content.kind === 'ok' ? content.snapshot : null)
    setLoad('ready')
  }, [sb, onSessionExpired, onAccessRefused])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loading the external list
    void reload()
    const counter = seq
    return () => {
      counter.current++
    }
  }, [reload])

  const shown = useMemo(() => filterMedia(files, filter), [files, filter])
  const sel = files.find((f) => f.path === selected) ?? null
  const refs = sel && snap ? findReferences(snap, sel.path) : null

  async function remove(file: MediaFile) {
    setBusy(true)
    setMsg(null)
    // Re-check references against fresh content right before deleting.
    const fresh = await loadContent(sb)
    if (fresh.kind !== 'ok') {
      setBusy(false)
      if (fresh.kind === 'expired') return onSessionExpired()
      return setMsg({ ok: false, text: 'Couldn’t confirm that the file is unused (content didn’t load), so nothing was deleted.' })
    }
    setSnap(fresh.snapshot)
    const problem = deleteProblem(file.path, findReferences(fresh.snapshot, file.path))
    if (problem) {
      setBusy(false)
      return setMsg({ ok: false, text: `Not deleted. ${problem}` })
    }
    if (!window.confirm(`Delete ${file.path} permanently?\n\nIt isn’t used by any content now. This can’t be undone, and any copy of its link stops working.`)) {
      setBusy(false)
      return
    }
    const r = await deleteMedia(sb, file.path)
    setBusy(false)
    if (r.kind === 'deleted') {
      setFiles((list) => list.filter((f) => f.path !== file.path))
      setSelected(null)
      setMsg({ ok: true, text: `Deleted ${file.path}.` })
    } else {
      if (r.kind === 'expired') onSessionExpired()
      if (r.kind === 'denied') onAccessRefused()
      setMsg({
        ok: false,
        text:
          r.kind === 'not-deleted'
            ? 'Storage didn’t delete the file (refused, or it was already gone). Reload to see the current list.'
            : r.kind === 'network'
              ? 'Connection problem: the delete couldn’t be confirmed. Reload to check.'
              : 'The file wasn’t deleted.',
      })
    }
  }

  return (
    <div className={`adm-media adm-media--${mode}`}>
      <Uploader
        folder={mode === 'pick' ? folder : undefined}
        onUploaded={(path) => {
          void reload().then(() => setSelected(path))
        }}
      />
      <div className="adm-media__filters" role="search">
        <input
          className="adm-input adm-media__search"
          type="search"
          placeholder="Search by file name"
          aria-label="Search by file name"
          value={filter.query}
          onChange={(e) => setFilter((f) => ({ ...f, query: e.target.value }))}
        />
        {!folder && (
          <select className="adm-input" aria-label="Folder" value={filter.folder} onChange={(e) => setFilter((f) => ({ ...f, folder: e.target.value as MediaFilter['folder'] }))}>
            <option value="all">All folders</option>
            {FOLDERS.map((x) => (
              <option key={x} value={x}>
                {FOLDER_NAMES[x]}
              </option>
            ))}
          </select>
        )}
        {!kind && (
          <select className="adm-input" aria-label="Type" value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value as MediaFilter['kind'] }))}>
            <option value="all">Images and PDFs</option>
            <option value="image">Images</option>
            <option value="pdf">PDFs</option>
          </select>
        )}
        <button type="button" className="adm-button adm-button--quiet" onClick={() => void reload()} disabled={load === 'loading'}>
          Refresh
        </button>
      </div>

      {msg && <Notice tone={msg.ok ? 'success' : 'error'}>{msg.text}</Notice>}
      {load === 'loading' && (
        <div className="adm-loading" role="status">
          <span className="adm-spinner" aria-hidden="true" /> Loading media…
        </div>
      )}
      {(load === 'network' || load === 'error' || load === 'denied') && (
        <Notice tone="error">
          <p>
            {load === 'network' ? 'Couldn’t reach Supabase Storage.' : load === 'denied' ? 'Storage refused to list the files for this account.' : 'The media list couldn’t be loaded.'}
          </p>
          <button type="button" className="adm-button adm-button--quiet" onClick={() => void reload()}>
            Try again
          </button>
        </Notice>
      )}
      {load === 'ready' && (
        <>
          {!snap && <Notice tone="warning">Content couldn’t be loaded, so usage is unknown and deleting is disabled.</Notice>}
          {truncated && <Notice tone="warning">Showing the first 5000 files.</Notice>}
          <p className="adm-setting__hint" aria-live="polite">
            {shown.length} of {files.length} file{files.length === 1 ? '' : 's'}
          </p>
          <div className="adm-media__layout">
            {shown.length ? (
              <ul className="adm-grid" aria-label="Media files">
                {shown.map((f) => {
                  const usage = snap ? usageOf(findReferences(snap, f.path)) : null
                  return (
                    <li key={f.path}>
                      <button type="button" className="adm-tile" aria-pressed={selected === f.path} onClick={() => setSelected(f.path)} title={f.path}>
                        <MediaThumb sb={sb} path={f.path} kind={f.kind} size={240} />
                        <span className="adm-tile__name">{f.name}</span>
                        <span className="adm-tile__meta">
                          {formatBytes(f.size)}
                          {usage && usage !== 'unused' && <Badge tone={usage === 'published' ? 'ok' : 'changed'}>In use</Badge>}
                          {current === f.path && <Badge tone="default">Selected</Badge>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="adm-media__empty">{files.length ? 'No files match these filters.' : 'No files in the media library yet. Upload one above.'}</p>
            )}

            {sel && (
              <aside className="adm-details" aria-label="File details">
                <MediaThumb sb={sb} path={sel.path} kind={sel.kind} size={640} alt={sel.name} />
                <dl className="adm-meta">
                  <div>
                    <dt>Name</dt>
                    <dd>{sel.name}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>
                      <code>{sel.path}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>Type</dt>
                    <dd>{sel.mime ?? sel.kind}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(sel.size)}</dd>
                  </div>
                  <div>
                    <dt>Usage</dt>
                    <dd>
                      {refs ? USAGE_TEXT[usageOf(refs)] : 'Unknown'}
                      {refs && refs.length > 0 && (
                        <ul className="adm-details__refs">
                          {refs.map((r) => (
                            <li key={`${r.id}-${r.field}`}>
                              {r.label} ({r.field}, {r.status})
                            </li>
                          ))}
                        </ul>
                      )}
                    </dd>
                  </div>
                </dl>
                <div className="adm-actions">
                  {mode === 'pick' && onPick && (
                    <button type="button" className="adm-button" onClick={() => onPick(sel.path)}>
                      Use this file
                    </button>
                  )}
                  <a className="adm-button adm-button--quiet" href={publicUrl(sb, sel.path)} target="_blank" rel="noopener noreferrer">
                    Open original
                  </a>
                  {mode === 'library' && (
                    <button type="button" className="adm-button adm-button--quiet adm-button--danger" disabled={busy || !snap || !!(refs && refs.length)} onClick={() => void remove(sel)}>
                      {busy ? 'Checking…' : 'Delete…'}
                    </button>
                  )}
                </div>
                {mode === 'library' && refs && refs.length > 0 && <p className="adm-setting__hint">Files used by content can’t be deleted. Remove the file from that content first.</p>}
              </aside>
            )}
          </div>
        </>
      )}
    </div>
  )
}
