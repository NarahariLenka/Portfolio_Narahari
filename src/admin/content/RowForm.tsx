/**
 * Generic form for one database row. Keeps only the admin's unsaved edits; the values
 * shown are the edits on top of the latest loaded row, so after a reload (e.g. a conflict)
 * the edits stay in place on top of the newer version for review.
 * Changed media paths are checked against the public media bucket before saving.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import type { TypedSupabaseClient } from '../../lib/supabase'
import { Badge, Notice, TextField } from '../editor/controls'
import { fieldProblem, toDb, toForm, type FieldSpec } from './model'
import { checkMedia, type MediaStatus } from './mediaCheck'
import { CropPresets, MediaFieldTools } from './MediaFieldTools'
import type { OpResult } from './useContent'

const isMedia = (f: FieldSpec) => f.kind === 'media' || f.kind === 'pdf'
const listText = (v: unknown) => (Array.isArray(v) ? v.join('\n') : '')
const listFrom = (raw: string) => raw.split('\n').map((x) => x.trim()).filter(Boolean)

interface Props {
  sb: TypedSupabaseClient
  formId: string
  fields: FieldSpec[]
  /** The loaded row (null for a new one). */
  row: Record<string, unknown> | null
  ctx?: { platform?: string }
  saveLabel: string
  /** Saving changes the live site immediately. */
  live?: boolean
  onSave: (patch: Record<string, unknown>) => Promise<OpResult>
  onCancel?: () => void
  markDirty: (formId: string, dirty: boolean) => void
  /** Optional transform of the patch before saving (e.g. empty word list → null). */
  finalize?: (patch: Record<string, unknown>) => Record<string, unknown>
  children?: ReactNode
}

export default function RowForm({ sb, formId, fields, row, ctx, saveLabel, live, onSave, onCancel, markDirty, finalize, children }: Props) {
  const id = useId()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [result, setResult] = useState<OpResult | null>(null)
  const [saving, setSaving] = useState(false)
  const [media, setMedia] = useState<Record<string, MediaStatus>>({})

  const base = (f: FieldSpec) => (f.kind === 'list' ? listText(toForm(f, row?.[f.key])) : (toForm(f, row?.[f.key]) as string))
  const raw = (f: FieldSpec) => (Object.hasOwn(edits, f.key) ? edits[f.key] : base(f))
  const value = (f: FieldSpec) => (f.kind === 'list' ? listFrom(raw(f)) : raw(f))
  const changed = (f: FieldSpec) =>
    Object.hasOwn(edits, f.key) && (f.kind === 'list' ? listFrom(edits[f.key]).join('\n') !== listFrom(base(f)).join('\n') : edits[f.key] !== base(f))
  const changedFields = fields.filter(changed)
  const dirty = changedFields.length > 0 || (!row && fields.some((f) => raw(f).trim()))

  useEffect(() => {
    markDirty(formId, dirty)
  }, [formId, dirty, markDirty])
  useEffect(() => () => markDirty(formId, false), [formId, markDirty])

  // Check changed media paths (debounced).
  const mediaKey = fields
    .filter((f) => isMedia(f) && changed(f) && raw(f).trim() && !fieldProblem(f, raw(f)))
    .map((f) => `${f.key}=${raw(f).trim()}`)
    .join('|')
  useEffect(() => {
    if (!mediaKey) return
    let cancelled = false
    const timer = window.setTimeout(async () => {
      for (const pair of mediaKey.split('|')) {
        const [key, path] = [pair.slice(0, pair.indexOf('=')), pair.slice(pair.indexOf('=') + 1)]
        setMedia((m) => ({ ...m, [key]: 'checking' }))
        const status = await checkMedia(sb, path)
        if (!cancelled) setMedia((m) => ({ ...m, [key]: status }))
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [mediaKey, sb])

  const problems = useMemo(() => {
    const p: string[] = []
    for (const f of fields) {
      const prob = fieldProblem(f, value(f), ctx)
      // Unchanged stored values aren't re-judged (a save never touches them).
      if (prob && (changed(f) || !row)) p.push(prob)
      if (isMedia(f) && changed(f) && raw(f).trim() && !prob) {
        const st = media[f.key]
        if (st !== 'found') p.push(st === 'missing' ? `${f.label}: no such file in the media bucket.` : st === 'unknown' ? `${f.label}: the file couldn’t be checked (connection problem).` : `${f.label}: checking the file…`)
      }
    }
    return p
    // value/changed derive from edits/row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, row, media, fields, ctx])

  async function save() {
    if (!dirty || problems.length || saving) return
    if (live && !window.confirm('This changes the live site immediately. Save and publish now?')) return
    const patch: Record<string, unknown> = {}
    for (const f of row ? changedFields : fields) patch[f.key] = toDb(f, value(f))
    setSaving(true)
    setResult(null)
    const r = await onSave(finalize ? finalize(patch) : patch)
    setSaving(false)
    setResult(r)
    if (r.ok) setEdits({})
  }

  return (
    <div className="adm-rowform" id={id}>
      {fields.map((f) => {
        const v = raw(f)
        const common = {
          label: f.label,
          hint: f.help,
          changed: changed(f),
          warning: isMedia(f) && changed(f) && media[f.key] === 'missing' ? 'No file at this path in the media bucket.' : null,
          onReset: changed(f)
            ? () =>
                setEdits((e) => {
                  const n = { ...e }
                  delete n[f.key]
                  return n
                })
            : undefined,
          resetLabel: 'Undo',
        }
        const setValue = (next: string) => setEdits((e) => ({ ...e, [f.key]: next }))
        return (
          <div key={f.key} className="adm-rowform__field">
          <TextField
            {...common}
            value={v}
            max={f.kind === 'list' ? 100000 : (f.max ?? 100000)}
            multiline={f.kind === 'textarea' || f.kind === 'list'}
            required={f.required}
            placeholder={f.kind === 'date' ? 'YYYY-MM-DD' : f.kind === 'social-url' && ctx?.platform === 'email' ? 'mailto:name@domain.com' : undefined}
            error={changed(f) || !row ? fieldProblem(f, value(f), ctx) : null}
            onChange={setValue}
          />
          {isMedia(f) && f.folder && (
            <MediaFieldTools
              sb={sb}
              path={raw(f).trim()}
              valid={!fieldProblem(f, raw(f))}
              folder={f.folder}
              kind={f.kind === 'pdf' ? 'pdf' : 'image'}
              onChange={setValue}
              cropPreview={fields.find((x) => x.kind === 'position') ? raw(fields.find((x) => x.kind === 'position')!) : undefined}
            />
          )}
          {f.kind === 'position' && <CropPresets value={raw(f)} onChange={setValue} />}
          </div>
        )
      })}
      {children}
      {result && <Notice tone={result.ok ? 'success' : 'error'}>{result.ok ? (result.message ?? 'Saved. The database confirmed the change.') : result.message}</Notice>}
      {dirty && problems.length > 0 && (
        <Notice tone="error">
          <ul>
            {[...new Set(problems)].map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      <div className="adm-actions adm-rowform__actions">
        {dirty && <Badge tone="changed">Unsaved</Badge>}
        {onCancel && (
          <button type="button" className="adm-button adm-button--quiet" onClick={onCancel} disabled={saving}>
            {dirty ? 'Cancel' : 'Close'}
          </button>
        )}
        <button type="button" className="adm-button" onClick={() => void save()} disabled={!dirty || problems.length > 0 || saving}>
          {saving ? 'Saving…' : saveLabel}
        </button>
      </div>
    </div>
  )
}
