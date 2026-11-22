/**
 * Media helpers inside a content form: a preview of the chosen file, "Choose from library"
 * (opens the picker; choosing only fills the form's unsaved value), Clear, and crop-position
 * presets that write the same CSS values the site already uses (projects.image_position).
 */
import { useState } from 'react'
import type { TypedSupabaseClient } from '../../lib/supabase'
import MediaPicker from '../media/MediaPicker'
import MediaThumb from '../media/MediaThumb'
import type { MediaFolder, MediaKind } from '../media/mediaModel'

export function MediaFieldTools({
  sb,
  path,
  valid,
  folder,
  kind,
  onChange,
  cropPreview,
}: {
  sb: TypedSupabaseClient
  path: string
  valid: boolean
  folder: MediaFolder
  kind: MediaKind
  onChange: (path: string) => void
  /** The form's crop value, to preview the screenshot as the site frames it. */
  cropPreview?: string
}) {
  const [picking, setPicking] = useState(false)
  return (
    <div className="adm-mediafield">
      {path && valid && (
        <div className={`adm-mediafield__preview${cropPreview !== undefined ? ' adm-mediafield__preview--frame' : ''}`}>
          <MediaThumb sb={sb} path={path} kind={kind} size={640} fit={cropPreview !== undefined ? 'cover' : 'contain'} position={cropPreview?.trim() || (cropPreview !== undefined ? '50% 0%' : undefined)} />
          {cropPreview !== undefined && <span className="adm-setting__hint">Preview of the crop (the site’s project frame).</span>}
        </div>
      )}
      <div className="adm-actions">
        <button type="button" className="adm-button adm-button--quiet" onClick={() => setPicking(true)}>
          Choose from library
        </button>
        {path && (
          <button type="button" className="adm-reset" onClick={() => onChange('')}>
            Clear
          </button>
        )}
      </div>
      {picking && (
        <MediaPicker
          folder={folder}
          kind={kind}
          current={path}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            onChange(p)
            setPicking(false)
          }}
        />
      )}
    </div>
  )
}

const PRESETS = [
  { label: 'Top', value: '50% 0%' },
  { label: 'Centre', value: 'center' },
  { label: 'Bottom', value: '50% 100%' },
  { label: 'Left', value: 'left center' },
  { label: 'Right', value: 'right center' },
]

export function CropPresets({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="adm-actions adm-crop" role="group" aria-label="Crop presets">
      {PRESETS.map((p) => (
        <button key={p.value} type="button" className="adm-reset" aria-pressed={value.trim() === p.value} onClick={() => onChange(p.value)}>
          {p.label}
        </button>
      ))}
      <button type="button" className="adm-reset" aria-pressed={!value.trim()} onClick={() => onChange('')}>
        Site default
      </button>
    </div>
  )
}
