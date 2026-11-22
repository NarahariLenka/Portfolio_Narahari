/**
 * Shared editor workflow: fresh read on open → draft edits → validation → conditional save.
 * Presentation-free; each editor decides which columns it owns and how fields look.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAdminSession } from './AdminSession'
import { constraintMessage, loadSettings, SAVE_MESSAGES, saveSettings } from './api'
import { buildPatch, changedColumns, draftFrom, editDraft, rebaseDraft, removeFromDraft, type Draft } from './draft'
import type { Json, Path } from './json'
import { stopPreview } from './preview'
import { columnProblems, type SettingsColumn, type SettingsRecord } from './schema'

export type LoadState = 'loading' | 'ready' | 'missing' | 'malformed' | 'network' | 'error'

export type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; warning: string | null }
  | { kind: 'failed'; message: string; problems?: string[] }
  | { kind: 'conflict'; latest: SettingsRecord | null }

export interface EditorOptions {
  /** Extra checks on the draft (e.g. registry rules). Return messages; empty = valid. Keep it stable (module-level or useCallback). */
  validate?: (draft: Draft, record: SettingsRecord) => string[]
}

export function useSettingsEditor(columns: readonly SettingsColumn[], options: EditorOptions = {}) {
  const session = useAdminSession()
  const { sb, onSessionExpired, onAccessRefused, setDirty } = session
  const [load, setLoad] = useState<LoadState>('loading')
  const [record, setRecord] = useState<SettingsRecord | null>(null)
  const [draft, setDraft] = useState<Draft>({})
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  // Bumped whenever the draft is replaced wholesale (load, discard, save), so input
  // components drop any half-typed text.
  const [version, setVersion] = useState(0)
  const seq = useRef(0)
  const cols = useRef(columns)
  const validate = options.validate

  const reload = useCallback(async () => {
    const id = ++seq.current
    stopPreview()
    setLoad('loading')
    setSave({ kind: 'idle' })
    setFieldErrors({})
    const r = await loadSettings(sb)
    if (id !== seq.current) return
    if (r.kind === 'ok') {
      setRecord(r.record)
      setDraft(draftFrom(r.record, cols.current))
      setVersion((v) => v + 1)
      setLoad('ready')
    } else if (r.kind === 'expired') onSessionExpired()
    else setLoad(r.kind)
  }, [sb, onSessionExpired])

  // Fresh read every time the editor is opened.
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loading the external record
    void reload()
    const counter = seq
    return () => {
      counter.current++ // drops any result still on its way
      stopPreview()
    }
  }, [reload])

  const changed = useMemo(() => (record ? changedColumns(record, draft) : []), [record, draft])
  const dirty = changed.length > 0

  useEffect(() => {
    setDirty(dirty)
  }, [dirty, setDirty])
  useEffect(() => () => setDirty(false), [setDirty])

  // Leaving the page (reload, closing the tab, leaving #admin) with unsaved changes.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const touch = () => setSave((s) => (s.kind === 'saved' || s.kind === 'failed' ? { kind: 'idle' } : s))

  const edit = useCallback((column: SettingsColumn, path: Path, value: Json) => {
    setDraft((d) => editDraft(d, column, path, value))
    touch()
  }, [])

  const remove = useCallback((column: SettingsColumn, path: Path) => {
    setDraft((d) => removeFromDraft(d, column, path))
    touch()
  }, [])

  /** Field-level input errors (e.g. text in a number box) block saving until fixed. */
  const setFieldError = useCallback((key: string, message: string | null) => {
    setFieldErrors((e) => {
      if ((e[key] ?? null) === message) return e
      const next = { ...e }
      if (message) next[key] = message
      else delete next[key]
      return next
    })
  }, [])

  const discard = useCallback(() => {
    if (!record) return
    stopPreview()
    setDraft(draftFrom(record, cols.current))
    setFieldErrors({})
    setVersion((v) => v + 1)
    setSave({ kind: 'idle' })
  }, [record])

  const problems = useMemo(() => {
    if (!record) return []
    const p = [...Object.values(fieldErrors)]
    // The database's own rules (lengths, required, JSON size) for every changed column.
    if (dirty) p.push(...columnProblems(buildPatch(record, draft)))
    if (dirty && validate) p.push(...validate(draft, record))
    return p
  }, [record, draft, dirty, fieldErrors, validate])

  const saveNow = useCallback(async () => {
    if (!record || !dirty || problems.length || save.kind === 'saving') return
    const id = ++seq.current
    setSave({ kind: 'saving' })
    const result = await saveSettings(sb, record, buildPatch(record, draft))
    if (id !== seq.current) return
    switch (result.kind) {
      case 'saved':
        stopPreview()
        setRecord(result.record)
        setDraft(draftFrom(result.record, cols.current))
        setVersion((v) => v + 1)
        setSave({
          kind: 'saved',
          warning: result.mismatch.length ? 'Saved, but the database stored some values differently. Reload to see what was stored.' : null,
        })
        return
      case 'invalid':
        setSave({ kind: 'failed', message: 'Fix these problems before saving:', problems: result.problems })
        return
      case 'constraint':
        setSave({ kind: 'failed', message: constraintMessage(result.column) })
        return
      case 'conflict':
        setSave({ kind: 'conflict', latest: result.latest })
        return
      case 'expired':
        setSave({ kind: 'failed', message: SAVE_MESSAGES.expired })
        onSessionExpired()
        return
      case 'denied':
        setSave({ kind: 'failed', message: SAVE_MESSAGES.denied })
        onAccessRefused()
        return
      default:
        setSave({ kind: 'failed', message: SAVE_MESSAGES[result.kind] })
    }
  }, [record, dirty, problems.length, save.kind, sb, draft, onSessionExpired, onAccessRefused])

  /** After a conflict: keep my changes, re-applied on top of the newer version, unsaved. */
  const reviewOnLatest = useCallback(() => {
    if (save.kind !== 'conflict' || !record || !save.latest) return
    setDraft(rebaseDraft(record, draft, save.latest))
    setRecord(save.latest)
    setVersion((v) => v + 1)
    setSave({ kind: 'idle' })
  }, [save, record, draft])

  return {
    load,
    record,
    draft,
    save,
    version,
    dirty,
    changed,
    problems,
    canSave: load === 'ready' && dirty && !problems.length && save.kind !== 'saving',
    edit,
    remove,
    discard,
    reload,
    saveNow,
    reviewOnLatest,
    setFieldError,
  }
}

export type SettingsEditor = ReturnType<typeof useSettingsEditor>
