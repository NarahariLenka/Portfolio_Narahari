/**
 * Admin → Content. Dashboard of the six page sections and, per section, its publishing
 * state, section details, text blocks and list items.
 *
 * Draft / publish (what the schema supports — see model.ts):
 *   • A DRAFT section: visitors see the built-in content (content/*.json). Everything in
 *     the database for it can be built and edited safely; "Publish section" switches the
 *     site to it, after a checklist.
 *   • A PUBLISHED section: its database content is live. Saving a published, visible item
 *     or block changes the site immediately (confirmed first). New items start as drafts
 *     and are published one by one. There is no separate draft copy of a live row: that
 *     needs a revisions table (schema change, not made).
 */
import { useState } from 'react'
import type { SectionSlug } from '../../data/remote'
import { Badge, Notice, SettingGroup, ToggleField } from '../editor/controls'
import { useAdminSession } from '../settings/AdminSession'
import ListManager from './ListManager'
import {
  ALL_SECTIONS,
  canImport,
  importPlan,
  isLive,
  LIST_NAMES,
  publishCheck,
  SECTION_BLOCKS,
  SECTION_FIELDS,
  SECTION_LIST,
  SECTION_NAMES,
  sectionOf,
  type BlockRow,
  type BlockSpec,
  type ContentSnapshot,
  type FieldSpec,
  type SectionRow,
} from './model'
import RowForm from './RowForm'
import { useContent, type ContentApi, type OpResult } from './useContent'

export default function ContentEditor() {
  const api = useContent()
  const [open, setOpen] = useState<SectionSlug | null>(null)

  return (
    <div className="adm-editor">
      <header className="adm-editor__head">
        <h1 id="adm-section-title" className="adm-title">
          Content
        </h1>
        <div className="adm-text">
          Text and lists for each page section. A <strong>draft</strong> section shows the built-in content to visitors while you prepare it here;
          a <strong>published</strong> section shows what is in the database.
        </div>
      </header>
      {api.load === 'loading' && (
        <div className="adm-loading" role="status" aria-live="polite">
          <span className="adm-spinner" aria-hidden="true" />
          Loading content from Supabase…
        </div>
      )}
      {(api.load === 'network' || api.load === 'error' || api.load === 'malformed') && (
        <Notice tone="error">
          <p>
            {api.load === 'network'
              ? 'Couldn’t reach Supabase to load the content.'
              : api.load === 'malformed'
                ? 'The content came back in an unexpected shape, so editing is disabled.'
                : 'The content couldn’t be loaded.'}
          </p>
          <button type="button" className="adm-button adm-button--quiet" onClick={() => void api.reload()}>
            Try again
          </button>
        </Notice>
      )}
      {api.load === 'ready' && api.snap && (
        <>
          <Overview
            snap={api.snap}
            open={open}
            onOpen={(s) => {
              if (s !== open && api.hasDirty() && !window.confirm('You have unsaved changes in this section. Leave and discard them?')) return
              setOpen(s)
            }}
          />
          {open && <SectionPanel key={open} slug={open} snap={api.snap} api={api} />}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------- overview

function counts(snap: ContentSnapshot, slug: SectionSlug, section: SectionRow | null) {
  const table = SECTION_LIST[slug]
  const blocks = section ? snap.blocks.filter((b) => b.section_id === section.id).length : 0
  const rows = table ? (snap[table] as { status: string; is_visible: boolean }[]) : []
  const published = rows.filter((r) => r.status === 'published' && r.is_visible).length
  return { table, blocks, rows: rows.length, published }
}

function Overview({ snap, open, onOpen }: { snap: ContentSnapshot; open: SectionSlug | null; onOpen: (s: SectionSlug) => void }) {
  return (
    <ul className="adm-cards" aria-label="Page sections">
      {ALL_SECTIONS.map((slug) => {
        const section = sectionOf(snap, slug)
        const c = counts(snap, slug, section)
        const live = isLive(section)
        return (
          <li key={slug}>
            <button type="button" className="adm-card-btn" aria-current={open === slug ? 'true' : undefined} onClick={() => onOpen(slug)}>
              <span className="adm-card-btn__title">{SECTION_NAMES[slug]}</span>
              <span className="adm-card-btn__badges">
                {!section ? <Badge tone="readonly">No record</Badge> : live ? <Badge tone="ok">Published</Badge> : <Badge tone="changed">Draft</Badge>}
                {section && !section.is_visible && slug !== 'home' && <Badge tone="default">Hidden</Badge>}
              </span>
              <span className="adm-card-btn__meta">
                {live ? 'Visitors see the database content' : 'Visitors see the built-in content'}
                <br />
                {c.blocks ? `${c.blocks} text block${c.blocks === 1 ? '' : 's'}` : SECTION_BLOCKS[slug] ? 'No text blocks yet' : ''}
                {c.table ? `${SECTION_BLOCKS[slug] ? ' · ' : ''}${c.rows} ${c.rows === 1 ? LIST_NAMES[c.table].one : LIST_NAMES[c.table].many.toLowerCase()} (${c.published} published & visible)` : ''}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------- section

function SectionPanel({ slug, snap, api }: { slug: SectionSlug; snap: ContentSnapshot; api: ContentApi }) {
  const { sb } = useAdminSession()
  // Kept here: the import card disappears once its content is copied.
  const [importResult, setImportResult] = useState<OpResult | null>(null)
  const section = sectionOf(snap, slug)
  if (!section)
    return (
      <Notice tone="warning">
        {SECTION_NAMES[slug]} has no record in the sections table, so it can’t be managed here. It is created by supabase/schema.sql; the admin panel never creates
        sections.
      </Notice>
    )
  const live = isLive(section)
  const table = SECTION_LIST[slug]
  return (
    <section className="adm-editor__body" aria-label={`${SECTION_NAMES[slug]} content`}>
      <h2 className="adm-title">{SECTION_NAMES[slug]}</h2>
      <PublishCard slug={slug} section={section} snap={snap} api={api} />
      {importResult && <Notice tone={importResult.ok ? 'success' : 'error'}>{importResult.message}</Notice>}
      {canImport(snap, slug) && <ImportCard slug={slug} snap={snap} api={api} onResult={setImportResult} />}
      <SectionDetails slug={slug} section={section} api={api} />
      {SECTION_BLOCKS[slug] && <Blocks slug={slug} section={section} snap={snap} api={api} />}
      {table && <ListManager sb={sb} table={table} rows={snap[table]} section={section} api={api} />}
      {slug === 'home' && <Notice>The name in the hero is the Owner name in General; the portrait image can be chosen from the Media Library in the Portrait block below.</Notice>}
      {!live && <Notice>Nothing in this section is public until you publish the section.</Notice>}
    </section>
  )
}

function PublishCard({ slug, section, snap, api }: { slug: SectionSlug; section: SectionRow; snap: ContentSnapshot; api: ContentApi }) {
  const [reviewing, setReviewing] = useState(false)
  const [includeDrafts, setIncludeDrafts] = useState(true)
  const [msg, setMsg] = useState<OpResult | null>(null)
  const live = isLive(section)
  const check = publishCheck(snap, slug)
  return (
    <SettingGroup
      title={live ? 'Published' : 'Draft'}
      description={
        live
          ? 'Visitors see this section’s database content. Returning it to draft makes the site show the built-in content again (the database content is kept).'
          : 'Visitors see the built-in content for this section. Publish when the database content is ready.'
      }
      actions={
        live ? (
          <button
            type="button"
            className="adm-button adm-button--quiet"
            disabled={api.busy}
            onClick={async () => {
              if (window.confirm('Return this section to draft? Visitors will see the built-in content again.')) setMsg(await api.unpublishSection(slug))
            }}
          >
            Return to draft
          </button>
        ) : (
          <button type="button" className="adm-button" disabled={api.busy} onClick={() => setReviewing((r) => !r)}>
            {reviewing ? 'Close checklist' : 'Publish section…'}
          </button>
        )
      }
    >
      {msg && <Notice tone={msg.ok ? 'success' : 'error'}>{msg.ok ? msg.message : msg.message}</Notice>}
      {reviewing && !live && (
        <div className="adm-checklist">
          <p className="adm-setting__label">Before publishing</p>
          {check.blocking.length > 0 && (
            <Notice tone="error">
              <p>Can’t publish yet:</p>
              <ul>
                {check.blocking.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </Notice>
          )}
          {check.warnings.length > 0 && (
            <Notice tone="warning">
              <ul>
                {check.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          )}
          {check.drafts.length > 0 && (
            <ToggleField
              label={`Also publish ${check.drafts.length} draft item${check.drafts.length === 1 ? '' : 's'}: ${check.drafts.map((d) => d.label).join(', ')}`}
              checked={includeDrafts}
              onLabel="Yes"
              offLabel="No, keep them as drafts"
              onChange={setIncludeDrafts}
            />
          )}
          {!check.blocking.length && !check.warnings.length && !check.drafts.length && <p className="adm-setting__hint">No problems found.</p>}
          <Notice tone="warning">
            <strong>Publishing is live.</strong> Visitors will see this section’s database content instead of the built-in content on their next visit.
          </Notice>
          <div className="adm-actions">
            <button
              type="button"
              className="adm-button"
              disabled={api.busy || check.blocking.length > 0}
              onClick={async () => {
                if (!window.confirm(`Publish ${SECTION_NAMES[slug]} now? This is live.`)) return
                const r = await api.publishSection(slug, includeDrafts)
                setMsg(r)
                if (r.ok) setReviewing(false)
              }}
            >
              Publish {SECTION_NAMES[slug]} now
            </button>
          </div>
        </div>
      )}
    </SettingGroup>
  )
}

function ImportCard({ slug, snap, api, onResult }: { slug: SectionSlug; snap: ContentSnapshot; api: ContentApi; onResult: (r: OpResult) => void }) {
  const plan = importPlan(slug, snap)
  const n = plan.blocks.length + plan.rows.length
  if (!n) return null
  return (
    <SettingGroup
      title="Start from the current site content"
      description="The database has no content for this section yet. Copy what the site shows today (from the built-in content files) into the database as drafts, then edit it here. Nothing becomes public."
      actions={
        <button
          type="button"
          className="adm-button adm-button--quiet"
          disabled={api.busy}
          onClick={async () => {
            if (window.confirm(`Copy ${n} item${n === 1 ? '' : 's'} into the database as drafts?`)) onResult(await api.importSection(slug))
          }}
        >
          Copy {n} item{n === 1 ? '' : 's'} as drafts
        </button>
      }
    >
      {plan.notes.length > 0 && (
        <Notice tone="warning">
          <ul>
            {plan.notes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </Notice>
      )}
    </SettingGroup>
  )
}

function SectionDetails({ slug, section, api }: { slug: SectionSlug; section: SectionRow; api: ContentApi }) {
  const { sb } = useAdminSession()
  const live = isLive(section)
  const [msg, setMsg] = useState<OpResult | null>(null)
  // Home's heading and number aren't shown anywhere; only its menu label is.
  const fields = slug === 'home' ? SECTION_FIELDS.filter((f) => f.key === 'nav_label') : SECTION_FIELDS
  return (
    <SettingGroup title="Section details" description={live ? 'Live: saving updates the site immediately.' : 'Used when the section is published.'}>
      <RowForm
        sb={sb}
        formId={`section-${section.id}`}
        fields={fields}
        row={section as unknown as Record<string, unknown>}
        live={live}
        saveLabel={live ? 'Save & publish (live)' : 'Save'}
        markDirty={api.markDirty}
        onSave={(patch) => api.saveRow('sections', section, patch)}
      />
      {slug === 'home' ? (
        <p className="adm-setting__hint">Home is always shown: it carries the background, water and opening scroll.</p>
      ) : (
        <ToggleField
          label="Shown on the site"
          checked={section.is_visible}
          onLabel="Shown"
          offLabel="Hidden"
          hint={live ? 'Hidden removes the section and its menu item for visitors.' : 'Takes effect when the section is published (drafts are always shown with the built-in content).'}
          disabled={api.busy}
          onChange={async (v) => {
            if (live && !window.confirm(`${v ? 'Show' : 'Hide'} ${SECTION_NAMES[slug]} on the live site now?`)) return
            setMsg(await api.saveRow('sections', section, { is_visible: v }))
          }}
        />
      )}
      {msg && <Notice tone={msg.ok ? 'success' : 'error'}>{msg.ok ? 'Saved.' : msg.message}</Notice>}
      <p className="adm-setting__hint">The order of sections is fixed by the page design (the scroll animations depend on it).</p>
    </SettingGroup>
  )
}

// ---------------------------------------------------------------------------- blocks

const blockFields = (spec: BlockSpec): FieldSpec[] =>
  spec.field === 'body'
    ? [{ key: 'body', label: spec.label, kind: spec.multiline ? 'textarea' : 'text', max: spec.max, help: spec.help }]
    : spec.field === 'words'
      ? [{ key: 'data', label: spec.label, kind: 'list', max: spec.max, maxItems: 12, help: spec.help }]
      : [
          { key: 'image_path', label: 'Portrait image (storage path)', kind: 'media', max: 300, help: 'A file in the portfolio-media bucket. Empty = the built-in portrait.', folder: 'portrait' },
          { key: 'image_alt', label: 'Portrait description', kind: 'text', max: 300 },
        ]

function Blocks({ slug, section, snap, api }: { slug: SectionSlug; section: SectionRow; snap: ContentSnapshot; api: ContentApi }) {
  const { sb } = useAdminSession()
  const live = isLive(section)
  const [msg, setMsg] = useState<OpResult | null>(null)
  return (
    <SettingGroup title="Text" description="A block that isn’t in the database (or is a draft) keeps showing the built-in text.">
      {msg && <Notice tone={msg.ok ? 'success' : 'error'}>{msg.ok ? 'Saved.' : msg.message}</Notice>}
      {(SECTION_BLOCKS[slug] ?? []).map((spec) => {
        const block = snap.blocks.find((b) => b.section_id === section.id && b.key === spec.key) ?? null
        const blockLive = live && block?.status === 'published' && block.is_visible
        return (
          <div key={spec.key} className="adm-item adm-item--open">
            <div className="adm-item__row">
              <span className="adm-item__title">{spec.label}</span>
              <span className="adm-item__badges">
                {!block ? <Badge tone="readonly">Not in database</Badge> : blockLive ? <Badge tone="ok">Live</Badge> : block.status === 'draft' ? <Badge tone="changed">Draft</Badge> : <Badge tone="default">Published (goes live with the section)</Badge>}
              </span>
            </div>
            <RowForm
              sb={sb}
              formId={`block-${section.id}-${spec.key}`}
              fields={blockFields(spec)}
              row={block as unknown as Record<string, unknown> | null}
              live={blockLive}
              saveLabel={!block ? 'Save as draft' : blockLive ? 'Save & publish (live)' : block.status === 'draft' ? 'Save draft' : 'Save'}
              markDirty={api.markDirty}
              finalize={(patch) => (Array.isArray(patch.data) && !patch.data.length ? { ...patch, data: null } : patch)}
              onSave={async (patch) => {
                if (block) return api.saveRow('content_blocks', block as BlockRow, patch)
                const r = await api.insert('content_blocks', [{ section_id: section.id, key: spec.key, status: 'draft', is_visible: true, sort_order: 0, ...patch }])
                return r.ok ? { ok: true, message: 'Saved as a draft.' } : r
              }}
            />
            {block && (
              <div className="adm-actions">
                <button
                  type="button"
                  className="adm-reset"
                  disabled={api.busy}
                  onClick={async () => {
                    const toLive = live && block.status === 'draft' && block.is_visible
                    const fromLive = blockLive
                    if ((toLive || fromLive) && !window.confirm('This changes the live site immediately. Continue?')) return
                    setMsg(await api.saveRow('content_blocks', block, { status: block.status === 'draft' ? 'published' : 'draft' }))
                  }}
                >
                  {block.status === 'draft' ? 'Publish block' : 'Move block to draft'}
                </button>
              </div>
            )}
          </div>
        )
      })}
    </SettingGroup>
  )
}
