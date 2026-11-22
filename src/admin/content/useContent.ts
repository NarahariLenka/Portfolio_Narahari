/**
 * Content editor state: the loaded snapshot and every write operation. Forms keep their
 * own unsaved edits; this hook only applies what the database confirmed.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SectionSlug } from '../../data/remote'
import { useAdminSession } from '../settings/AdminSession'
import { DELETE_MESSAGES, deleteProjectRow, insertRows, loadContent, publishDrafts, updateRow, writeMessage, type WriteResult } from './api'
import { importPlan, publishCheck, reorderPlan, sectionOf, SECTION_LIST, type AnyRow, type ContentSnapshot, type ContentTable, type ListRow, type ListTable, type ProjectRow } from './model'

export type ContentLoadState = 'loading' | 'ready' | 'network' | 'malformed' | 'error'

/** Outcome of an operation, for the UI: null = success. */
export type OpResult = { ok: true; message?: string } | { ok: false; message: string; conflict?: boolean }

const KEY: Record<ContentTable, keyof ContentSnapshot> = {
  sections: 'sections',
  content_blocks: 'blocks',
  skills: 'skills',
  projects: 'projects',
  certificates: 'certificates',
  social_links: 'social_links',
}

export function useContent() {
  const { sb, onSessionExpired, onAccessRefused, setDirty } = useAdminSession()
  const [load, setLoad] = useState<ContentLoadState>('loading')
  const [snap, setSnap] = useState<ContentSnapshot | null>(null)
  const [busy, setBusy] = useState(false)
  const dirtyForms = useRef(new Set<string>())
  const seq = useRef(0)

  const reload = useCallback(async () => {
    const id = ++seq.current
    setLoad('loading')
    const r = await loadContent(sb)
    if (id !== seq.current) return
    if (r.kind === 'ok') {
      setSnap(r.snapshot)
      setLoad('ready')
    } else if (r.kind === 'expired') onSessionExpired()
    else setLoad(r.kind)
  }, [sb, onSessionExpired])

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loading the external content
    void reload()
    const counter = seq
    return () => {
      counter.current++
    }
  }, [reload])

  useEffect(() => () => setDirty(false), [setDirty])

  /** Forms report unsaved edits; the layout warns before leaving while any form has some. */
  const markDirty = useCallback(
    (formId: string, dirty: boolean) => {
      const set = dirtyForms.current
      if (dirty) set.add(formId)
      else set.delete(formId)
      setDirty(set.size > 0)
    },
    [setDirty],
  )

  // Leaving the page with unsaved edits.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!dirtyForms.current.size) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  const apply = useCallback((table: ContentTable, rows: AnyRow[]) => {
    setSnap((s) => {
      if (!s) return s
      const list = s[KEY[table]] as AnyRow[]
      const byId = new Map(rows.map((r) => [r.id, r]))
      const merged = list.map((r) => byId.get(r.id) ?? r)
      for (const r of rows) if (!list.some((x) => x.id === r.id)) merged.push(r)
      return { ...s, [KEY[table]]: merged }
    })
  }, [])

  /** Turns a failed write into a message, handling session and permission side effects. */
  const fail = useCallback(
    (r: Exclude<WriteResult, { kind: 'saved' }>): OpResult => {
      if (r.kind === 'expired') onSessionExpired()
      if (r.kind === 'denied') onAccessRefused()
      return { ok: false, message: writeMessage(r), conflict: r.kind === 'conflict' }
    },
    [onSessionExpired, onAccessRefused],
  )

  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    setBusy(true)
    try {
      return await fn()
    } finally {
      setBusy(false)
    }
  }, [])

  /** Saves changed fields of one row (conditional on its loaded updated_at). */
  const saveRow = useCallback(
    (table: ContentTable, row: AnyRow, patch: Record<string, unknown>): Promise<OpResult> =>
      run(async () => {
        const r = await updateRow(sb, table, row, patch)
        if (r.kind === 'conflict') {
          // Show the newer version; open forms keep the admin's edits on top of it.
          if (r.latest) apply(table, [r.latest])
          else await reload()
          return {
            ok: false,
            conflict: true,
            message: r.latest
              ? 'This item was changed somewhere else after you opened it. Nothing was overwritten. The newer version is now shown with your edits on top: review them and save again.'
              : writeMessage(r),
          }
        }
        if (r.kind !== 'saved') return fail(r)
        apply(table, r.rows)
        return { ok: true }
      }),
    [sb, run, fail, apply, reload],
  )

  /** Inserts new rows (always as drafts from the editor). */
  const insert = useCallback(
    (table: ContentTable, rows: Record<string, unknown>[]): Promise<OpResult & { rows?: AnyRow[] }> =>
      run(async () => {
        const r = await insertRows(sb, table, rows)
        if (r.kind !== 'saved') {
          const out = fail(r)
          if (r.kind === 'unconfirmed') await reload()
          return out
        }
        apply(table, r.rows)
        return { ok: true, rows: r.rows }
      }),
    [sb, run, fail, apply, reload],
  )

  /** Saves a new order (one conditional update per moved row; stops and reloads on failure). */
  const saveOrder = useCallback(
    (table: ListTable, rowsInNewOrder: ListRow[]): Promise<OpResult> =>
      run(async () => {
        const plan = reorderPlan(rowsInNewOrder)
        let done = 0
        for (const p of plan) {
          const row = rowsInNewOrder.find((r) => r.id === p.id)!
          const r = await updateRow(sb, table, row, { sort_order: p.sort_order })
          if (r.kind !== 'saved') {
            const out = fail(r)
            await reload()
            return { ok: false, message: `${done ? `The order was saved for ${done} of ${plan.length} items, then stopped. ` : ''}${out.message} The list was reloaded.` }
          }
          apply(table, r.rows)
          done++
        }
        return { ok: true, message: plan.length ? 'Order saved.' : 'The order didn’t change.' }
      }),
    [sb, run, fail, apply, reload],
  )

  /** Makes one project the featured (large first) card; at most one can be featured. */
  const setFeatured = useCallback(
    (project: ProjectRow): Promise<OpResult> =>
      run(async () => {
        const current = snap?.projects.find((p) => p.is_featured && p.id !== project.id)
        if (current) {
          const r = await updateRow(sb, 'projects', current, { is_featured: false })
          if (r.kind !== 'saved') return fail(r)
          apply('projects', r.rows)
        }
        const r = await updateRow(sb, 'projects', project, { is_featured: !project.is_featured })
        if (r.kind !== 'saved') {
          const out = fail(r)
          await reload()
          return { ok: false, message: `${out.message}${current ? ' (The previous featured project was already unmarked; none is featured now, so the first project is shown large.)' : ''}` }
        }
        apply('projects', r.rows)
        return { ok: true }
      }),
    [sb, snap, run, fail, apply, reload],
  )

  /**
   * Publishes a section: first the chosen draft blocks/items (still invisible while the
   * section is a draft), then the section itself. Stops at the first failure; whatever
   * was published before that has no public effect until the section is published.
   */
  const publishSection = useCallback(
    (slug: SectionSlug, includeDrafts: boolean): Promise<OpResult> =>
      run(async () => {
        if (!snap) return { ok: false, message: 'Content isn’t loaded.' }
        const section = sectionOf(snap, slug)
        const check = publishCheck(snap, slug)
        if (!section || check.blocking.length) return { ok: false, message: check.blocking.join(' ') || 'This section can’t be published.' }
        if (includeDrafts) {
          for (const table of ['content_blocks', SECTION_LIST[slug]].filter(Boolean) as ContentTable[]) {
            const ids = check.drafts.filter((d) => d.table === table).map((d) => d.id)
            if (!ids.length) continue
            const r = await publishDrafts(sb, table, ids)
            if (r.kind !== 'saved') {
              const out = fail(r)
              await reload()
              return { ok: false, message: `${out.message} The section was NOT published (visitors still see the built-in content). The list was reloaded.` }
            }
            apply(table, r.rows)
          }
        }
        const r = await updateRow(sb, 'sections', section, { status: 'published' })
        if (r.kind !== 'saved') {
          const out = fail(r)
          await reload()
          return { ok: false, message: `${out.message} The section was NOT published.` }
        }
        apply('sections', r.rows)
        return { ok: true, message: 'Published. Visitors see this section’s database content on their next visit.' }
      }),
    [sb, snap, run, fail, apply, reload],
  )

  const unpublishSection = useCallback(
    (slug: SectionSlug): Promise<OpResult> =>
      run(async () => {
        const section = snap && sectionOf(snap, slug)
        if (!section) return { ok: false, message: 'Section not found.' }
        const r = await updateRow(sb, 'sections', section, { status: 'draft' })
        if (r.kind !== 'saved') return fail(r)
        apply('sections', r.rows)
        return { ok: true, message: 'Back to draft. Visitors see the built-in content for this section again; the database content is kept.' }
      }),
    [sb, snap, run, fail, apply],
  )

  /** Copies the section's built-in content into the database as drafts (never overwrites). */
  const importSection = useCallback(
    (slug: SectionSlug): Promise<OpResult> =>
      run(async () => {
        if (!snap) return { ok: false, message: 'Content isn’t loaded.' }
        const section = sectionOf(snap, slug)
        if (!section) return { ok: false, message: 'Section not found.' }
        const plan = importPlan(slug, snap)
        if (plan.blocks.length) {
          const blocks = plan.blocks.map((b, i) => ({ section_id: section.id, key: b.key, body: b.body ?? null, data: b.data ?? null, image_alt: b.image_alt ?? null, sort_order: (i + 1) * 10, is_visible: true, status: 'draft' }))
          const r = await insertRows(sb, 'content_blocks', blocks)
          if (r.kind !== 'saved') {
            const out = fail(r)
            await reload()
            return out
          }
          apply('content_blocks', r.rows)
        }
        const table = SECTION_LIST[slug]
        if (table && plan.rows.length) {
          const r = await insertRows(sb, table, plan.rows.map((row) => ({ ...row, is_visible: true, status: 'draft' })))
          if (r.kind !== 'saved') {
            const out = fail(r)
            await reload()
            return { ok: false, message: `${plan.blocks.length ? 'The text blocks were copied, but the list wasn’t. ' : ''}${out.message}` }
          }
          apply(table, r.rows)
        }
        return { ok: true, message: `Copied as drafts.${plan.notes.length ? ` Notes: ${plan.notes.join(' ')}` : ''} Nothing is public until you publish the section.` }
      }),
    [sb, snap, run, fail, apply, reload],
  )

  /** Re-reads the content without a loading screen (open dialogs and messages stay). */
  const refresh = useCallback(async () => {
    const r = await loadContent(sb)
    if (r.kind === 'ok') setSnap(r.snapshot)
    else if (r.kind === 'expired') onSessionExpired()
  }, [sb, onSessionExpired])

  /** Permanently deletes one project (conditional on its loaded updated_at). Storage untouched. */
  const deleteProject = useCallback(
    (project: ProjectRow): Promise<OpResult> =>
      run(async () => {
        const r = await deleteProjectRow<ProjectRow>(sb, project)
        if (r.kind === 'deleted') {
          setSnap((s) => (s ? { ...s, projects: s.projects.filter((p) => p.id !== r.id) } : s))
          return { ok: true, message: `Deleted “${project.title}”. Its screenshot (if any) is still in the Media Library.` }
        }
        if (r.kind === 'conflict') apply('projects', [r.latest])
        if (r.kind === 'gone' || r.kind === 'unconfirmed') await refresh()
        if (r.kind === 'expired') onSessionExpired()
        if (r.kind === 'denied') onAccessRefused()
        return { ok: false, message: DELETE_MESSAGES[r.kind], conflict: r.kind === 'conflict' }
      }),
    [sb, run, apply, refresh, onSessionExpired, onAccessRefused],
  )

  const hasDirty = useCallback(() => dirtyForms.current.size > 0, [])

  return { load, snap, busy, hasDirty, deleteProject, reload, saveRow, insert, saveOrder, setFeatured, publishSection, unpublishSection, importSection, markDirty }
}

export type ContentApi = ReturnType<typeof useContent>
