/**
 * Confirmation dialog for permanently deleting one project. Shows the exact title, whether
 * visitors can see it, its screenshot (which stays in the Media Library), and requires
 * typing the title or DELETE — plus an extra acknowledgement for published projects.
 * Escape / Cancel close it; focus returns to the Delete button that opened it.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TypedSupabaseClient } from '../../lib/supabase'
import { Notice } from '../editor/controls'
import MediaThumb from '../media/MediaThumb'
import { deleteConfirmed, mediaPathProblem, type ProjectRow, type RowState } from './model'
import type { OpResult } from './useContent'

interface Props {
  sb: TypedSupabaseClient
  project: ProjectRow
  state: RowState
  onDelete: () => Promise<OpResult>
  onClose: (result?: OpResult) => void
}

export default function DeleteProjectDialog({ sb, project, state, onDelete, onClose }: Props) {
  const id = useId()
  const [typed, setTyped] = useState('')
  const [ack, setAck] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  const busyRef = useRef(false)
  // The project changed while the dialog was open (conflict): ask for a fresh confirmation.
  const [version, setVersion] = useState(project.updated_at)
  if (version !== project.updated_at) {
    setVersion(project.updated_at)
    setTyped('')
    setAck(false)
  }

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    input.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) close.current()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])

  const published = project.status === 'published'
  const ready = deleteConfirmed(typed, project.title) && (!published || ack) && !busy
  const screenshot = project.image_path && !mediaPathProblem(project.image_path) ? project.image_path : null

  async function confirm() {
    if (!ready) return
    setBusy(true)
    busyRef.current = true
    setError(null)
    const r = await onDelete()
    busyRef.current = false
    setBusy(false)
    if (r.ok) close.current(r)
    else setError(r.message)
  }

  return createPortal(
    <div className="adm-modal" role="presentation">
      <div className="adm-modal__panel adm-delete" role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-desc`}>
        <h2 id={`${id}-title`} className="adm-group__title">
          Delete project permanently?
        </h2>
        <p id={`${id}-desc`} className="adm-delete__name">
          “{project.title}”
        </p>
        <ul className="adm-delete__facts">
          <li>
            Status:{' '}
            {state === 'live'
              ? 'published and visible on the site'
              : state === 'hidden'
                ? 'published but hidden'
                : state === 'with-section'
                  ? 'published (shown once the Projects section is published)'
                  : 'draft (not public)'}
          </li>
          <li>Only this project’s database record is deleted. Other projects and all other content are not touched.</li>
          <li>
            <strong>This can’t be undone.</strong> The database has no way to restore a deleted project record.
          </li>
        </ul>

        {published && (
          <Notice tone="warning">
            {state === 'live' ? (
              <p>
                <strong>This project is live.</strong> Deleting it removes it from the public website immediately.
              </p>
            ) : (
              <p>
                <strong>This project is published.</strong> It isn’t on the site right now ({state === 'hidden' ? 'it is hidden' : 'the Projects section is a draft'}), but deleting it means it can never appear again.
              </p>
            )}
            <label className="adm-delete__ack">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} disabled={busy} /> I understand that this published project will be removed permanently and can’t be restored.
            </label>
          </Notice>
        )}

        {screenshot ? (
          <div className="adm-delete__media">
            <MediaThumb sb={sb} path={screenshot} kind="image" size={480} alt={`Screenshot of ${project.title}`} />
            <p className="adm-setting__hint">
              Screenshot <code>{screenshot}</code> stays in the Media Library (it is not deleted). Once no content uses it, you can delete it there.
            </p>
          </div>
        ) : (
          <p className="adm-setting__hint">This project has no screenshot.</p>
        )}

        <label className="adm-setting" htmlFor={`${id}-confirm`}>
          <span className="adm-setting__label">
            Type the project title or <code>DELETE</code> to confirm
          </span>
          <input
            id={`${id}-confirm`}
            ref={input}
            className="adm-input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            aria-invalid={!!typed && !deleteConfirmed(typed, project.title)}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void confirm()}
          />
          {typed && !deleteConfirmed(typed, project.title) && <span className="adm-setting__hint">Doesn’t match yet.</span>}
        </label>

        {error && <Notice tone="error">{error}</Notice>}

        <div className="adm-actions adm-delete__actions">
          <button type="button" className="adm-button adm-button--quiet" onClick={() => close.current()} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="adm-button adm-button--danger-solid" onClick={() => void confirm()} disabled={!ready}>
            {busy ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
