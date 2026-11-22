/**
 * Admin → General: site_settings text columns and ui_labels. Every editable field here is
 * read by the public site (data/content.ts, data/footer.ts, data/hero.ts, data/profile.ts);
 * "Default" means the value from the local content files the site falls back to.
 */
import footerJson from '../../../content/footer.json'
import homeJson from '../../../content/home.json'
import siteJson from '../../../content/site.json'
import { localLabel, UI_LABEL_KEYS, type UiLabelKey } from '../../data/uiLabels'
import { Notice, ReadOnlyField, SettingGroup, TextField } from '../editor/controls'
import { EditorFrame } from '../editor/EditorFrame'
import { pathChanged } from '../settings/draft'
import { isObject } from '../settings/json'
import { TEXT_RULES, type TextColumn } from '../settings/schema'
import { useSettingsEditor, type SettingsEditor } from '../settings/useSettingsEditor'

const COLUMNS = ['site_title', 'meta_description', 'owner_name', 'location', 'footer_copyright', 'footer_signoff', 'footer_back_to_top', 'ui_labels'] as const

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The site's own fallback for each column (content/*.json). */
const LOCAL: Record<Exclude<TextColumn, 'location'>, string> = {
  site_title: str(siteJson.browserTabTitle) || 'Portfolio',
  meta_description: str(siteJson.searchDescription),
  owner_name: str((homeJson as { name?: unknown }).name),
  footer_copyright: str(footerJson.copyright),
  footer_signoff: str(footerJson.signoff),
  footer_back_to_top: str(footerJson.backToTop),
}

const LABEL_NAMES: Record<UiLabelKey, string> = {
  projectPreviewPlaceholder: 'Project image placeholder',
  certificatePlaceholder: 'Certificate image placeholder',
  untitledCertificate: 'Untitled certificate',
  githubLink: 'Project GitHub link',
  liveSiteLink: 'Project live-site link',
  viewCredentialLink: 'Certificate credential link',
  viewPdfLink: 'Certificate PDF link',
  emailIconTooltip: 'Email icon tooltip',
  linkedinIconTooltip: 'LinkedIn icon tooltip',
  githubIconTooltip: 'GitHub icon tooltip',
}

export default function GeneralEditor() {
  const editor = useSettingsEditor(COLUMNS)
  return (
    <EditorFrame editor={editor} title="General" intro="Site-wide text: browser tab, search results, your name, footer and small interface labels.">
      <SettingGroup title="Site" description="Shown in the browser tab and in search results.">
        <Required editor={editor} column="site_title" hint="The browser tab title." />
        <Optional editor={editor} column="meta_description" multiline hint="The description search engines may show. Empty = the default." />
      </SettingGroup>
      <SettingGroup title="Owner">
        <Required editor={editor} column="owner_name" hint="Your name in the hero and the profile." />
        <ReadOnlyField
          label="Location"
          value={str(editor.draft.location) || '(not set)'}
          reason="Stored in the database, but the site doesn’t display it anywhere yet, so editing it here would have no visible effect."
        />
      </SettingGroup>
      <SettingGroup title="Footer" description="Empty hides that line; Reset brings back the default text.">
        <Footer editor={editor} column="footer_copyright" />
        <Footer editor={editor} column="footer_signoff" />
        <Footer editor={editor} column="footer_back_to_top" />
      </SettingGroup>
      <Labels editor={editor} />
    </EditorFrame>
  )
}

type FieldProps = { editor: SettingsEditor; column: Exclude<TextColumn, 'location'>; hint?: string; multiline?: boolean }

const changedCol = (editor: SettingsEditor, column: TextColumn) => !!editor.record && pathChanged(editor.record, editor.draft, column)

/** NOT NULL column: reset puts the default text back (the column can't be empty). */
function Required({ editor, column, hint }: FieldProps) {
  const value = typeof editor.draft[column] === 'string' ? (editor.draft[column] as string) : ''
  return (
    <TextField
      label={TEXT_RULES[column].label}
      hint={hint}
      value={value}
      max={TEXT_RULES[column].max}
      required
      isDefault={value.trim() === LOCAL[column]}
      defaultText={LOCAL[column]}
      changed={changedCol(editor, column)}
      onChange={(v) => editor.edit(column, [], v)}
      onReset={() => editor.edit(column, [], LOCAL[column])}
    />
  )
}

/** Nullable column where empty means "use the default": emptying stores null. */
function Optional({ editor, column, hint, multiline }: FieldProps) {
  const stored = editor.draft[column]
  const value = typeof stored === 'string' ? stored : ''
  return (
    <TextField
      label={TEXT_RULES[column].label}
      hint={hint}
      value={value}
      max={TEXT_RULES[column].max}
      multiline={multiline}
      placeholder={LOCAL[column]}
      isDefault={!value.trim()}
      defaultText={LOCAL[column] || '(none)'}
      changed={changedCol(editor, column)}
      onChange={(v) => editor.edit(column, [], v.trim() ? v : null)}
      onReset={() => editor.edit(column, [], null)}
    />
  )
}

/** Footer lines: null = default text, '' = hidden. */
function Footer({ editor, column }: FieldProps) {
  const stored = editor.draft[column]
  const isNull = stored === null || stored === undefined
  const value = typeof stored === 'string' ? stored : ''
  return (
    <TextField
      label={TEXT_RULES[column].label}
      value={value}
      max={TEXT_RULES[column].max}
      placeholder={isNull ? LOCAL[column] : '(hidden)'}
      isDefault={isNull}
      defaultText={LOCAL[column] || '(none)'}
      hint={isNull ? 'Showing the default text.' : value.trim() ? undefined : 'Hidden on the site.'}
      changed={changedCol(editor, column)}
      onChange={(v) => editor.edit(column, [], v)}
      onReset={() => editor.edit(column, [], null)}
    />
  )
}

function Labels({ editor }: { editor: SettingsEditor }) {
  const labels = isObject(editor.draft.ui_labels) ? editor.draft.ui_labels : {}
  const other = Object.keys(labels).filter((k) => !(UI_LABEL_KEYS as string[]).includes(k))
  return (
    <SettingGroup title="Interface labels" description="Small texts on buttons, links and tooltips. Empty = the default.">
      {other.length > 0 && <Notice>Other stored labels the site doesn’t use are kept unchanged: {other.join(', ')}.</Notice>}
      {UI_LABEL_KEYS.map((key) => {
        const stored = labels[key]
        const value = typeof stored === 'string' ? stored : ''
        const fallback = localLabel(key)
        return (
          <TextField
            key={key}
            label={LABEL_NAMES[key]}
            value={value}
            max={80}
            placeholder={fallback}
            isDefault={!value.trim()}
            defaultText={fallback}
            warning={stored !== undefined && typeof stored !== 'string' ? 'The stored value isn’t text; the site may not show it as expected.' : null}
            changed={!!editor.record && pathChanged(editor.record, editor.draft, 'ui_labels', [key])}
            onChange={(v) => (v.trim() ? editor.edit('ui_labels', [key], v) : editor.remove('ui_labels', [key]))}
            onReset={() => editor.remove('ui_labels', [key])}
          />
        )
      })}
    </SettingGroup>
  )
}
