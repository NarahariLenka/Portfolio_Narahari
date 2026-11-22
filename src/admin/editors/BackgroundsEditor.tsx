/**
 * Admin → Backgrounds (site_settings.backgrounds). Read-only: every background layer is
 * drawn by fixed code (one WebGL shader for water, stars and planets; per-device particle
 * budgets for Skills), so no setting here would change anything yet. Stored values are
 * shown and kept as they are; nothing is saved from this page.
 */
import { DEFAULT_BACKGROUNDS } from '../../config/portfolioSettings'
import { Notice, ReadOnlyField, SettingGroup } from '../editor/controls'
import { EditorFrame } from '../editor/EditorFrame'
import { isObject } from '../settings/json'
import { useSettingsEditor } from '../settings/useSettingsEditor'

const COLUMNS = ['backgrounds'] as const

const SHADER =
  'Drawn inside the cosmic background shader (cosmic.frag.glsl) with fixed values. Making it adjustable means changing the shader, which this phase avoids so the scene stays exactly as designed.'

const LAYERS: { label: string; value: string; reason: string }[] = [
  { label: 'Scene preset', value: DEFAULT_BACKGROUNDS.preset, reason: 'Only the cosmic scene exists; the other preset names have no implementation.' },
  { label: 'Water (hero)', value: 'On · ripples follow the pointer and clicks', reason: SHADER },
  { label: 'Stars', value: 'On · 3 layers on desktop, 2 on mobile', reason: SHADER },
  { label: 'Planets', value: 'On · 9 on desktop, 5 on mobile', reason: SHADER },
  { label: 'Clouds and horizon haze', value: 'On', reason: SHADER },
  { label: 'Skills particles', value: 'On · budget set per device', reason: 'Particle counts are tuned per device for performance (config/scene.ts); changing them could make phones stutter.' },
  {
    label: 'Mobile and reduced-motion versions',
    value: 'Automatic',
    reason: 'Lighter scene on phones and weak GPUs; near-still water for reduced motion. These protect visitors and stay automatic.',
  },
]

export default function BackgroundsEditor() {
  const editor = useSettingsEditor(COLUMNS)
  const stored = isObject(editor.draft.backgrounds) ? Object.keys(editor.draft.backgrounds) : []
  return (
    <EditorFrame
      editor={editor}
      saves={false}
      title="Backgrounds"
      intro="The water, cosmic sky, stars and planets behind the site. These are read-only for now; nothing on this page can change the live site."
    >
      {stored.length > 0 ? (
        <Notice>The database holds background settings ({stored.join(', ')}). The site doesn’t use them yet; they are kept unchanged.</Notice>
      ) : (
        <Notice>No background settings are stored; the site uses its built-in scene.</Notice>
      )}
      <SettingGroup title="Background layers" description="Shown so you can see what exists and why it isn’t adjustable yet.">
        {LAYERS.map((l) => (
          <ReadOnlyField key={l.label} label={l.label} value={l.value} reason={l.reason} />
        ))}
      </SettingGroup>
    </EditorFrame>
  )
}
