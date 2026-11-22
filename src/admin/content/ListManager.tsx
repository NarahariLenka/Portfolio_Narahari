/**
 * Manages one list table (skills, projects, certificates or contact links) for a section:
 * order, visibility, draft/published state, featured project, editing and adding.
 * Nothing is deleted from here.
 */
import { useEffect, useState } from 'react'
import { Badge, Notice, SettingGroup } from '../editor/controls'
import {
  isLive,
  LIST_FIELDS,
  LIST_NAMES,
  nextSortOrder,
  ordered,
  ROW_STATE_TEXT,
  rowState,
  SLUG_MAX,
  SOCIAL_PLATFORMS,
  uniqueSlug,
  type ListRow,
  type ListTable,
  type ProjectRow,
  type SectionRow,
  type SocialRow,
} from './model'
import DeleteProjectDialog from './DeleteProjectDialog'
import RowForm from './RowForm'
import type { ContentApi, OpResult } from './useContent'
import type { TypedSupabaseClient } from '../../lib/supabase'

const titleOf = (r: ListRow) => ('name' in r ? r.name : 'title' in r ? r.title : `${r.platform}`)
const subOf = (r: ListRow) =>
  'tools' in r ? r.tools.join(', ') : 'technologies' in r ? r.technologies.join(', ') : 'issuer' in r ? [r.issuer, r.issued_label ?? r.issued_on].filter(Boolean).join(' · ') : 'url' in r ? r.url : ''

const LIVE_CONFIRM = 'This changes the live site immediately. Continue?'

export default function ListManager({ sb, table, rows, section, api }: { sb: TypedSupabaseClient; table: ListTable; rows: ListRow[]; section: SectionRow; api: ContentApi }) {
  const names = LIST_NAMES[table]
  const live = isLive(section)
  const sorted = ordered(rows)
  const [order, setOrder] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [platform, setPlatform] = useState<string>('')
  const [msg, setMsg] = useState<OpResult | null>(null)
  const [deleting, setDeleting] = useState<ProjectRow | null>(null)

  const view = order ? order.map((id) => sorted.find((r) => r.id === id)).filter((r): r is ListRow => !!r) : sorted
  const orderChanged = !!order && order.join() !== sorted.map((r) => r.id).join()
  // An unsaved order counts as unsaved changes (warned before leaving).
  const { markDirty } = api
  useEffect(() => {
    markDirty(`order-${table}`, orderChanged)
  }, [markDirty, table, orderChanged])
  useEffect(() => () => markDirty(`order-${table}`, false), [markDirty, table])
  const usedPlatforms = (rows as SocialRow[]).map((r) => r.platform)
  const freePlatforms = table === 'social_links' ? SOCIAL_PLATFORMS.filter((p) => !usedPlatforms.includes(p)) : []

  const move = (id: string, delta: number) => {
    const ids = (order ?? sorted.map((r) => r.id)).slice()
    const i = ids.indexOf(id)
    const j = i + delta
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    setOrder(ids)
  }

  const act = async (fn: () => Promise<OpResult>, affectsLive: boolean) => {
    if (affectsLive && !window.confirm(LIVE_CONFIRM)) return
    setMsg(await fn())
  }

  const shownLive = (r: ListRow, change: Partial<Pick<ListRow, 'status' | 'is_visible'>>) =>
    live && (rowState(r, section) === 'live' || rowState({ ...r, ...change } as ListRow, section) === 'live')

  return (
    <SettingGroup
      title={names.many}
      description={
        live
          ? 'This section is live: saving a published, visible item updates the site immediately. New items start as drafts.'
          : 'This section is a draft: visitors see the built-in content, so nothing here is public yet.'
      }
      actions={
        <button
          type="button"
          className="adm-button adm-button--quiet"
          disabled={api.busy || adding || (table === 'social_links' && !freePlatforms.length)}
          onClick={() => {
            setAdding(true)
            setPlatform(freePlatforms[0] ?? '')
          }}
        >
          Add {names.one}
        </button>
      }
    >
      {msg && <Notice tone={msg.ok ? 'success' : 'error'}>{msg.ok ? (msg.message ?? 'Saved. The database confirmed the change.') : msg.message}</Notice>}
      {table === 'social_links' && <p className="adm-setting__hint">The Contact dock shows Email, GitHub and LinkedIn; other platforms aren’t displayed, so only these can be added.</p>}

      {adding && (
        <div className="adm-item adm-item--open">
          <h3 className="adm-item__title">New {names.one} (saved as a draft)</h3>
          {table === 'social_links' && (
            <label className="adm-setting">
              <span className="adm-setting__label">Platform</span>
              <select className="adm-input" value={platform} onChange={(e) => setPlatform(e.target.value)}>
                {freePlatforms.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
          )}
          <RowForm
            sb={sb}
            formId={`new-${table}`}
            fields={LIST_FIELDS[table]}
            row={null}
            ctx={{ platform }}
            saveLabel="Save as draft"
            markDirty={api.markDirty}
            onCancel={() => {
              if (window.confirm('Discard this new item?')) setAdding(false)
            }}
            onSave={async (patch) => {
              const extra: Record<string, unknown> = { status: 'draft', is_visible: true, sort_order: nextSortOrder(rows) }
              if (table === 'social_links') extra.platform = platform
              else {
                const name = String(patch.name ?? patch.title ?? '')
                extra.slug = uniqueSlug(name, (rows as { slug: string }[]).map((r) => r.slug), SLUG_MAX[table])
              }
              const r = await api.insert(table, [{ ...patch, ...extra }])
              if (!r.ok) return r
              // The form closes, so the confirmation is shown on the list.
              setMsg({ ok: true, message: 'Saved as a draft. It isn’t public until you publish it.' })
              setAdding(false)
              return { ok: true, message: 'Saved as a draft.' }
            }}
          />
        </div>
      )}

      {!view.length && !adding && <p className="adm-setting__hint">No {names.many.toLowerCase()} in the database yet.</p>}

      <ol className="adm-items">
        {view.map((r, i) => {
          const state = rowState(r, section)
          const open = editing === r.id
          return (
            <li key={r.id} className={`adm-item${open ? ' adm-item--open' : ''}`}>
              <div className="adm-item__row">
                <div className="adm-item__main">
                  <span className="adm-item__title">{titleOf(r) || '(untitled)'}</span>
                  {subOf(r) && <span className="adm-item__sub">{subOf(r)}</span>}
                </div>
                <div className="adm-item__badges">
                  <Badge tone={state === 'live' ? 'ok' : state === 'draft' ? 'changed' : 'default'}>{ROW_STATE_TEXT[state]}</Badge>
                  {'is_featured' in r && r.is_featured && <Badge tone="ok">Featured</Badge>}
                </div>
              </div>
              <div className="adm-actions adm-item__actions">
                <button type="button" className="adm-reset" aria-label={`Move ${titleOf(r)} up`} disabled={i === 0 || api.busy} onClick={() => move(r.id, -1)}>
                  ↑
                </button>
                <button type="button" className="adm-reset" aria-label={`Move ${titleOf(r)} down`} disabled={i === view.length - 1 || api.busy} onClick={() => move(r.id, 1)}>
                  ↓
                </button>
                <button type="button" className="adm-reset" onClick={() => setEditing(open ? null : r.id)}>
                  {open ? 'Close' : 'Edit'}
                </button>
                <button
                  type="button"
                  className="adm-reset"
                  disabled={api.busy}
                  onClick={() => void act(() => api.saveRow(table, r, { is_visible: !r.is_visible }), shownLive(r, { is_visible: !r.is_visible }))}
                >
                  {r.is_visible ? 'Hide' : 'Show'}
                </button>
                <button
                  type="button"
                  className="adm-reset"
                  disabled={api.busy}
                  onClick={() => void act(() => api.saveRow(table, r, { status: r.status === 'draft' ? 'published' : 'draft' }), shownLive(r, { status: r.status === 'draft' ? 'published' : 'draft' }))}
                >
                  {r.status === 'draft' ? 'Publish item' : 'Move to draft'}
                </button>
                {table === 'projects' && (
                  <button type="button" className="adm-reset" disabled={api.busy} onClick={() => void act(() => api.setFeatured(r as ProjectRow), live)}>
                    {(r as ProjectRow).is_featured ? 'Unfeature' : 'Make featured'}
                  </button>
                )}
                {table === 'projects' && (
                  <span className="adm-item__danger">
                    <button
                      type="button"
                      className="adm-reset adm-reset--danger"
                      disabled={api.busy}
                      aria-label={`Delete project ${titleOf(r)}`}
                      onClick={() => {
                        setMsg(null)
                        setDeleting(r as ProjectRow)
                      }}
                    >
                      Delete…
                    </button>
                  </span>
                )}
              </div>
              {open && (
                <RowForm
                  sb={sb}
                  formId={`${table}-${r.id}`}
                  fields={LIST_FIELDS[table]}
                  row={r as unknown as Record<string, unknown>}
                  ctx={{ platform: 'platform' in r ? r.platform : undefined }}
                  live={state === 'live'}
                  saveLabel={state === 'live' ? 'Save & publish (live)' : r.status === 'draft' ? 'Save draft' : 'Save'}
                  markDirty={api.markDirty}
                  onSave={(patch) => api.saveRow(table, r, patch)}
                >
                  {'platform' in r && <p className="adm-setting__hint">Platform: {r.platform} (fixed)</p>}
                </RowForm>
              )}
            </li>
          )
        })}
      </ol>

      {deleting && (
        <DeleteProjectDialog
          sb={sb}
          // The latest loaded version (after a conflict the dialog shows the newer one).
          project={((rows as ProjectRow[]).find((p) => p.id === deleting.id) ?? deleting) as ProjectRow}
          state={rowState(((rows as ProjectRow[]).find((p) => p.id === deleting.id) ?? deleting) as ProjectRow, section)}
          onDelete={() => api.deleteProject(((rows as ProjectRow[]).find((p) => p.id === deleting.id) ?? deleting) as ProjectRow)}
          onClose={(result) => {
            setDeleting(null)
            if (result) {
              if (editing === deleting.id) setEditing(null)
              setOrder(null)
              setMsg(result)
            }
          }}
        />
      )}

      {orderChanged && (
        <div className="adm-actions">
          <button type="button" className="adm-button adm-button--quiet" onClick={() => setOrder(null)} disabled={api.busy}>
            Cancel order change
          </button>
          <button
            type="button"
            className="adm-button"
            disabled={api.busy}
            onClick={async () => {
              if (live && !window.confirm(LIVE_CONFIRM)) return
              const r = await api.saveOrder(table, view)
              setMsg(r)
              setOrder(null)
            }}
          >
            {live ? 'Save order (live)' : 'Save order'}
          </button>
        </div>
      )}
    </SettingGroup>
  )
}
