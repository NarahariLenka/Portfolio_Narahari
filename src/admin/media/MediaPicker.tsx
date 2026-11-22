/**
 * Dialog for choosing a file for a content field. Choosing only fills the form's unsaved
 * draft (via onPick); saving stays a separate, explicit step in the form.
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import MediaBrowser from './MediaBrowser'
import { FOLDER_NAMES, type MediaFolder, type MediaKind } from './mediaModel'

export default function MediaPicker({ folder, kind, current, onPick, onClose }: { folder: MediaFolder; kind: MediaKind; current?: string; onPick: (path: string) => void; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null)
  // Latest onClose without re-running the focus effect on every parent render.
  const close = useRef(onClose)
  useEffect(() => {
    close.current = onClose
  })
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    closeBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current()
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      opener?.focus?.()
    }
  }, [])
  return createPortal(
    <div className="adm-modal" role="dialog" aria-modal="true" aria-label={`Choose ${kind === 'pdf' ? 'a PDF' : 'an image'} from ${FOLDER_NAMES[folder]}`}>
      <div className="adm-modal__panel">
        <div className="adm-modal__head">
          <h2 className="adm-group__title">
            Choose {kind === 'pdf' ? 'a PDF' : 'an image'} · {FOLDER_NAMES[folder]}
          </h2>
          <button ref={closeBtn} type="button" className="adm-button adm-button--quiet" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="adm-setting__hint">Choosing a file only changes the form. Nothing is saved or published until you save the item.</p>
        <MediaBrowser mode="pick" folder={folder} kind={kind} current={current} onPick={onPick} />
      </div>
    </div>,
    document.body,
  )
}
