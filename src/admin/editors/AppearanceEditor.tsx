/**
 * Admin → Appearance (site_settings.appearance). Editable: the two settings the public site
 * reads today (default theme, theme toggle). Everything else is listed read-only with the
 * reason, so nothing is offered that the site would ignore.
 */
import { DEFAULT_APPEARANCE } from '../../config/portfolioSettings'
import { Notice, ReadOnlyField, SelectField, SettingGroup, ToggleField } from '../editor/controls'
import { EditorFrame } from '../editor/EditorFrame'
import { pathChanged } from '../settings/draft'
import { useSettingsEditor } from '../settings/useSettingsEditor'
import { themeState, toggleState, validateAppearanceDraft } from './appearanceModel'

const COLUMNS = ['appearance'] as const
const INVALID = 'The stored value is invalid; the site uses the default.'

export default function AppearanceEditor() {
  const editor = useSettingsEditor(COLUMNS, { validate: validateAppearanceDraft })
  const cfg = editor.draft.appearance
  const theme = themeState(cfg)
  const toggle = toggleState(cfg)
  const changed = (key: string) => !!editor.record && pathChanged(editor.record, editor.draft, 'appearance', [key])

  return (
    <EditorFrame editor={editor} title="Appearance" intro="How the site opens and what visitors can change. The dark and light themes themselves are part of the design and are not edited here.">
      <Notice>Preview isn’t available for these settings in the admin panel: they affect the whole public page. Check the site in a new tab after saving.</Notice>
      <SettingGroup title="Theme">
        <SelectField
          label="Theme a visit opens in"
          value={theme.value}
          options={[
            { value: 'dark', label: 'Dark (cosmic night)' },
            { value: 'light', label: 'Light (cosmic dawn)' },
          ]}
          isDefault={theme.isDefault}
          defaultText="Dark"
          changed={changed('defaultTheme')}
          warning={theme.storedInvalid ? INVALID : null}
          hint="Light: the page background is dark for a moment while the site loads, then the site opens in light."
          onChange={(v) => editor.edit('appearance', ['defaultTheme'], v)}
          onReset={() => editor.remove('appearance', ['defaultTheme'])}
        />
        <ToggleField
          label="Theme toggle in the navigation"
          checked={toggle.value}
          onLabel="Shown"
          offLabel="Hidden"
          isDefault={toggle.isDefault}
          defaultText="Shown"
          changed={changed('allowThemeToggle')}
          warning={toggle.storedInvalid ? INVALID : null}
          hint="Hidden: visitors stay in the theme the site opens in."
          onChange={(v) => editor.edit('appearance', ['allowThemeToggle'], v)}
          onReset={() => editor.remove('appearance', ['allowThemeToggle'])}
        />
      </SettingGroup>
      <SettingGroup title="Not adjustable yet" description="Defined in the settings format, but the site has no implementation for them yet.">
        <ReadOnlyField
          label="Theme colours"
          value="Cosmic night (dark) · Cosmic dawn (light)"
          reason="The colours are shared by the page, the WebGL scenes and the transitions; changing single colours safely needs a design pass (contrast, scenes), not a colour picker."
        />
        <ReadOnlyField label="Typography preset" value={DEFAULT_APPEARANCE.typography} reason="Only one type design exists; there is no other preset to switch to." />
        <ReadOnlyField label="Font scale" value={`${DEFAULT_APPEARANCE.fontScale}×`} reason="Not connected: the layouts and scroll animations are tuned to the current type sizes." />
        <ReadOnlyField label="Spacing preset" value={DEFAULT_APPEARANCE.spacing} reason="Not connected: section spacing drives the scroll sequences (hero travel, projects)." />
      </SettingGroup>
    </EditorFrame>
  )
}
