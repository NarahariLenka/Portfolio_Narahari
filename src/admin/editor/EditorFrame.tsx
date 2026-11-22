/**
 * Common frame for every settings editor: load states, the publish warning, and the
 * save bar (unsaved-change indicator, problems, Discard, Save, conflict handling).
 */
import type { ReactNode } from 'react'
import { COLUMN_LABELS } from '../settings/schema'
import type { SettingsEditor } from '../settings/useSettingsEditor'
import { Notice } from './controls'

const LOAD_MESSAGES = {
  missing: 'The settings record (site_settings, id 1) doesn’t exist, so there is nothing to edit. It is created by supabase/schema.sql; the admin panel never creates it.',
  malformed: 'The settings record came back in an unexpected shape, so editing is disabled to avoid saving something wrong.',
  network: 'Couldn’t reach Supabase to load the current settings.',
  error: 'The current settings couldn’t be loaded.',
} as const

export function EditorFrame({ editor, title, intro, saves = true, children }: { editor: SettingsEditor; title: string; intro: ReactNode; saves?: boolean; children: ReactNode }) {
  return (
    <div className="adm-editor">
      <header className="adm-editor__head">
        <h1 id="adm-section-title" className="adm-title">
          {title}
        </h1>
        <div className="adm-text">{intro}</div>
      </header>
      {editor.load === 'loading' && (
        <div className="adm-loading" role="status" aria-live="polite">
          <span className="adm-spinner" aria-hidden="true" />
          Loading the current settings from Supabase…
        </div>
      )}
      {editor.load !== 'loading' && editor.load !== 'ready' && (
        <Notice tone="error">
          <p>{LOAD_MESSAGES[editor.load]}</p>
          {(editor.load === 'network' || editor.load === 'error' || editor.load === 'malformed') && (
            <button type="button" className="adm-button adm-button--quiet" onClick={() => void editor.reload()}>
              Try again
            </button>
          )}
        </Notice>
      )}
      {editor.load === 'ready' && (
        <>
          {saves && (
            <Notice tone="warning">
              <strong>Saving publishes immediately.</strong> Visitors see saved settings the next time they load the site. Nothing is saved until you press Save.
            </Notice>
          )}
          <div className="adm-editor__body">{children}</div>
          {saves && <SaveBar editor={editor} />}
        </>
      )}
    </div>
  )
}

function SaveBar({ editor }: { editor: SettingsEditor }) {
  const { save, dirty, changed, problems } = editor
  const confirmDiscard = () => {
    if (window.confirm('Discard all unsaved changes in this section?')) editor.discard()
  }
  return (
    <div className="adm-savebar" aria-label="Save changes">
      <div className="adm-savebar__messages" aria-live="polite">
        {save.kind === 'saving' && <Notice>Saving…</Notice>}
        {save.kind === 'saved' && <Notice tone={save.warning ? 'warning' : 'success'}>{save.warning ?? 'Saved. The database confirmed the change.'}</Notice>}
        {save.kind === 'failed' && (
          <Notice tone="error">
            <p>{save.message}</p>
            {save.problems && (
              <ul>
                {save.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </Notice>
        )}
        {save.kind === 'conflict' && (
          <Notice tone="error">
            <p>These settings were changed somewhere else (another tab or device) after you opened them. Nothing was saved and the newer version was not overwritten.</p>
            <div className="adm-actions">
              {save.latest && (
                <button type="button" className="adm-button adm-button--quiet" onClick={editor.reviewOnLatest}>
                  Keep my changes on top of the newer version (review, then save)
                </button>
              )}
              <button
                type="button"
                className="adm-button adm-button--quiet"
                onClick={() => {
                  if (window.confirm('Load the newer version and discard your unsaved changes?')) void editor.reload()
                }}
              >
                Load the newer version (discard mine)
              </button>
            </div>
          </Notice>
        )}
        {dirty && problems.length > 0 && save.kind !== 'failed' && (
          <Notice tone="error">
            <p>Fix these before saving:</p>
            <ul>
              {[...new Set(problems)].map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        )}
      </div>
      <div className="adm-savebar__row">
        <span className="adm-savebar__status">
          {dirty ? (
            <>
              <span className="adm-dot" aria-hidden="true" /> Unsaved changes: {changed.map((c) => COLUMN_LABELS[c]).join(', ')}
            </>
          ) : (
            'No unsaved changes'
          )}
        </span>
        <span className="adm-actions">
          <button type="button" className="adm-button adm-button--quiet" onClick={confirmDiscard} disabled={!dirty || save.kind === 'saving'}>
            Discard
          </button>
          <button type="button" className="adm-button" onClick={() => void editor.saveNow()} disabled={!editor.canSave || save.kind === 'conflict'}>
            {save.kind === 'saving' ? 'Saving…' : 'Save & publish'}
          </button>
        </span>
      </div>
    </div>
  )
}
