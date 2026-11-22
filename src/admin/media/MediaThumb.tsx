/**
 * Small preview of a stored file. Images ask Storage for a resized version first (image
 * transformations); if the project doesn't offer them, it falls back once to the original
 * file, loaded lazily. PDFs show an icon (nothing is downloaded).
 */
import { useState } from 'react'
import type { TypedSupabaseClient } from '../../lib/supabase'
import { publicUrl } from './mediaApi'
import type { MediaKind } from './mediaModel'

export default function MediaThumb({ sb, path, kind, size = 320, alt = '', fit = 'contain', position }: { sb: TypedSupabaseClient; path: string; kind: MediaKind; size?: number; alt?: string; fit?: 'contain' | 'cover'; position?: string }) {
  const [fallback, setFallback] = useState(false)
  const [failed, setFailed] = useState(false)
  if (kind === 'pdf')
    return (
      <span className="adm-thumb adm-thumb--pdf" aria-label={alt || 'PDF file'}>
        <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
        </svg>
        <span>PDF</span>
      </span>
    )
  if (failed) return <span className="adm-thumb adm-thumb--missing">Preview unavailable</span>
  return (
    <span className="adm-thumb">
      <img
        src={fallback ? publicUrl(sb, path) : publicUrl(sb, path, size)}
        alt={alt}
        loading="lazy"
        decoding="async"
        style={{ objectFit: fit, objectPosition: position }}
        onError={() => (fallback ? setFailed(true) : setFallback(true))}
      />
    </span>
  )
}
