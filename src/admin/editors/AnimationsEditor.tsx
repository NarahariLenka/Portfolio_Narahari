/**
 * Admin → Animations. Registry-driven: every registered animation is listed; controls are
 * offered only for effects whose code reads its settings (isConfigurable), and only for
 * the parameters the registry declares. Writes go to site_settings.animation through the
 * shared editor (validated, conditional on updated_at, unknown keys kept).
 */
import { useCallback, useState } from 'react'
import { describeAnimations, GLOBAL_LIMITS, getAnimation } from '../../animations'
import type { AnyAnimationDefinition, Device, ParamSchema, ReducedMotionMode } from '../../animations'
import { THEME_INK_ID } from '../../lib/themeInkSettings'
import { Badge, NumberField, Notice, ReadOnlyField, SelectField, SettingGroup, ToggleField } from '../editor/controls'
import { EditorFrame } from '../editor/EditorFrame'
import { pathChanged } from '../settings/draft'
import type { Path } from '../settings/json'
import { useSettingsEditor, type SettingsEditor } from '../settings/useSettingsEditor'
import {
  boolState,
  defaultParam,
  DEVICES,
  devicePath,
  enabledPath,
  GLOBAL_STEP,
  globalNumberState,
  globalPath,
  managedEntryPaths,
  managedParamPaths,
  paramPath,
  paramState,
  reducedPath,
  reducedState,
  storedIssues,
  usedGlobalScales,
  validateAnimationDraft,
} from './animationModel'
import InkPreviewStage from './InkPreviewStage'

const COLUMNS = ['animation'] as const

/** Plain-language names for reduced-motion modes, per effect where it matters. */
const REDUCED_LABELS: Record<string, Partial<Record<ReducedMotionMode, string>>> = {
  [THEME_INK_ID]: { static: 'Short crossfade (150 ms)', off: 'Instant switch, no animation' },
  shootingStar: { static: 'Sling shown, launches nothing', off: 'Sling hidden' },
  contactDotField: { static: 'Still dot grid', off: 'Hidden' },
  projectsTilt: { off: 'No tilt' },
}
const reducedLabel = (id: string, m: ReducedMotionMode) => REDUCED_LABELS[id]?.[m] ?? { off: 'Hidden', static: 'Still (no motion)', reduced: 'Gentler motion' }[m]

const GLOBAL_TEXT: Record<string, { label: string; hint: string }> = {
  intensity: { label: 'Global intensity', hint: 'Multiplies strength settings that opt in (dot-field bulge, card tilt and depth).' },
  duration: { label: 'Global duration', hint: 'Multiplies timing settings that opt in (card easing time, theme ink duration).' },
  speed: { label: 'Global speed', hint: '' },
  density: { label: 'Global density', hint: '' },
}

export default function AnimationsEditor() {
  const editor = useSettingsEditor(COLUMNS, { validate: validateAnimationDraft })
  const [previewing, setPreviewing] = useState(false)
  const closePreview = useCallback(() => setPreviewing(false), [])
  const catalogue = describeAnimations()
  const issues = editor.record ? storedIssues(editor.record) : []

  return (
    <EditorFrame
      editor={editor}
      title="Animations"
      intro={
        <>
          Every effect registered in the code is listed here. Effects marked <em>Adjustable</em> read these settings; the others always run as
          designed. Leaving a value at its default keeps the effect exactly as built.
        </>
      }
    >
      {issues.length > 0 && (
        <Notice tone="warning">
          <p>The stored settings contain entries the site ignores. They are kept as they are unless you change them here:</p>
          <ul>
            {issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </Notice>
      )}
      <GlobalGroup editor={editor} />
      {catalogue.map((d) => {
        const def = getAnimation(d.id)!
        return d.controllable ? (
          <AnimationCard key={d.id} def={def} editor={editor} onPreview={d.id === THEME_INK_ID ? () => setPreviewing(true) : undefined} />
        ) : (
          <ReadOnlyCard key={d.id} def={def} reason={d.unavailableReason ?? ''} />
        )
      })}
      {previewing && <InkPreviewStage animation={editor.draft.animation} onClose={closePreview} />}
    </EditorFrame>
  )
}

// ---------------------------------------------------------------------------- helpers

function useField(editor: SettingsEditor) {
  const cfg = editor.draft.animation
  const changed = (path: Path) => !!editor.record && pathChanged(editor.record, editor.draft, 'animation', path)
  const set = (path: Path, value: boolean | number | string) => editor.edit('animation', path, value)
  const reset = (...paths: Path[]) => paths.forEach((p) => editor.remove('animation', p))
  return { cfg, changed, set, reset }
}

const deviceText = (def: AnyAnimationDefinition) =>
  DEVICES.filter((d) => def.defaultDevices?.[d] ?? true)
    .map((d) => (d === 'desktop' ? 'Desktop' : 'Mobile'))
    .join(' + ') || 'None'

const whereText = (def: AnyAnimationDefinition) => (def.sections.length ? def.sections.join(', ') : 'Page-wide')

// ---------------------------------------------------------------------------- global

function GlobalGroup({ editor }: { editor: SettingsEditor }) {
  const { cfg, changed, set, reset } = useField(editor)
  const used = usedGlobalScales()
  const on = boolState(cfg, globalPath('enabled'), true)
  const unused = (Object.keys(GLOBAL_LIMITS) as (keyof typeof GLOBAL_LIMITS)[]).filter((k) => !used.includes(k))
  return (
    <SettingGroup
      title="All adjustable animations"
      description="Apply to every effect marked Adjustable. Effects that always run as designed are not affected."
      actions={
        <button type="button" className="adm-button adm-button--quiet" onClick={() => reset(globalPath('enabled'), ...used.map(globalPath))}>
          Reset global settings
        </button>
      }
    >
      <ToggleField
        label="Adjustable animations"
        hint="Off = every adjustable effect is switched off (the theme switch falls back to its simple colour fade)."
        checked={on.value}
        isDefault={on.isDefault}
        changed={changed(globalPath('enabled'))}
        defaultText="On"
        warning={on.storedInvalid ? 'The stored value is invalid; the site uses the default.' : null}
        onChange={(v) => set(globalPath('enabled'), v)}
        onReset={() => reset(globalPath('enabled'))}
      />
      {used.map((k) => {
        const s = globalNumberState(cfg, k)
        return (
          <NumberField
            key={`${k}-${editor.version}`}
            label={GLOBAL_TEXT[k].label}
            hint={GLOBAL_TEXT[k].hint}
            value={s.value}
            min={GLOBAL_LIMITS[k].min}
            max={GLOBAL_LIMITS[k].max}
            step={GLOBAL_STEP}
            unit="×"
            isDefault={s.isDefault}
            defaultText="1×"
            changed={changed(globalPath(k))}
            warning={s.storedInvalid ? 'The stored value is invalid; the site uses the default.' : null}
            onChange={(v) => set(globalPath(k), v)}
            onValidity={(p) => editor.setFieldError(`global.${k}`, p)}
            onReset={() => reset(globalPath(k))}
          />
        )
      })}
      {unused.map((k) => (
        <ReadOnlyField key={k} label={GLOBAL_TEXT[k].label} reason="No current animation uses this multiplier, so changing it would have no effect." />
      ))}
    </SettingGroup>
  )
}

// ---------------------------------------------------------------------------- cards

function CardMeta({ def, preview }: { def: AnyAnimationDefinition; preview: string }) {
  return (
    <dl className="adm-meta">
      <div>
        <dt>Where</dt>
        <dd>{whereText(def)}</dd>
      </div>
      <div>
        <dt>Devices</dt>
        <dd>{deviceText(def)}</dd>
      </div>
      <div>
        <dt>Reduced motion</dt>
        <dd>{def.reducedMotion.allowed.map((m) => reducedLabel(def.id, m)).join(' / ')}</dd>
      </div>
      <div>
        <dt>Preview</dt>
        <dd>{preview}</dd>
      </div>
    </dl>
  )
}

function ReadOnlyCard({ def, reason }: { def: AnyAnimationDefinition; reason: string }) {
  return (
    <SettingGroup
      title={def.name}
      description={
        <>
          <Badge tone="readonly">Always on as designed</Badge> {def.description}
        </>
      }
    >
      <CardMeta def={def} preview="Not available" />
      <p className="adm-setting__hint">{reason}</p>
    </SettingGroup>
  )
}

function AnimationCard({ def, editor, onPreview }: { def: AnyAnimationDefinition; editor: SettingsEditor; onPreview?: () => void }) {
  const { cfg, changed, set, reset } = useField(editor)
  const [device, setDevice] = useState<Device>('desktop')
  const enabled = boolState(cfg, enabledPath(def.id), def.defaultEnabled)
  const rm = reducedState(def, cfg)
  const params = Object.entries(def.params as ParamSchema)
  const invalid = 'The stored value is invalid; the site uses the default.'

  return (
    <SettingGroup
      title={def.name}
      description={
        <>
          <Badge tone="ok">Adjustable</Badge> {def.description}
        </>
      }
      actions={
        <>
          {onPreview && (
            <button type="button" className="adm-button adm-button--quiet" onClick={onPreview}>
              Preview
            </button>
          )}
          <button
            type="button"
            className="adm-button adm-button--quiet"
            onClick={() => {
              if (window.confirm(`Reset every ${def.name} setting to its default? (Nothing is saved until you press Save.)`)) reset(...managedEntryPaths(def))
            }}
          >
            Reset all
          </button>
        </>
      }
    >
      <CardMeta def={def} preview={onPreview ? 'Local preview (not saved)' : 'Not available — check the site after saving'} />
      <ToggleField
        label="Enabled"
        checked={enabled.value}
        isDefault={enabled.isDefault}
        defaultText={def.defaultEnabled ? 'On' : 'Off'}
        changed={changed(enabledPath(def.id))}
        warning={enabled.storedInvalid ? invalid : null}
        hint={def.id === THEME_INK_ID ? 'Off = the simple colour fade used before the ink transition.' : undefined}
        onChange={(v) => set(enabledPath(def.id), v)}
        onReset={() => reset(enabledPath(def.id))}
      />
      <div className="adm-pair">
        {DEVICES.map((d) => {
          const s = boolState(cfg, devicePath(def.id, d), def.defaultDevices?.[d] ?? true)
          return (
            <ToggleField
              key={d}
              label={d === 'desktop' ? 'On desktop' : 'On mobile'}
              checked={s.value}
              isDefault={s.isDefault}
              changed={changed(devicePath(def.id, d))}
              warning={s.storedInvalid ? invalid : null}
              hint={d === 'mobile' ? 'Mobile = screens up to 767 px wide.' : undefined}
              onChange={(v) => set(devicePath(def.id, d), v)}
              onReset={() => reset(devicePath(def.id, d))}
            />
          )
        })}
      </div>
      {def.reducedMotion.allowed.length > 1 ? (
        <SelectField
          label="For visitors who prefer reduced motion"
          value={rm.value}
          options={def.reducedMotion.allowed.map((m) => ({ value: m, label: reducedLabel(def.id, m) }))}
          isDefault={rm.isDefault}
          defaultText={reducedLabel(def.id, def.reducedMotion.default)}
          changed={changed(reducedPath(def.id))}
          warning={rm.storedInvalid ? invalid : null}
          onChange={(v) => set(reducedPath(def.id), v)}
          onReset={() => reset(reducedPath(def.id))}
        />
      ) : (
        <ReadOnlyField label="For visitors who prefer reduced motion" value={reducedLabel(def.id, def.reducedMotion.default)} reason="The only option for this effect: reduced motion is always respected." />
      )}

      {params.length > 0 && (
        <div className="adm-devices">
          <div className="adm-tabs">
            {/* Only the two tabs are inside the tablist (ARIA: a tablist may contain tabs only). */}
            <div className="adm-tabs__list" role="tablist" aria-label={`${def.name} values for`}>
              {DEVICES.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  id={`${def.id}-tab-${d}`}
                  aria-controls={`${def.id}-panel`}
                  className="adm-tab"
                  aria-selected={device === d}
                  tabIndex={device === d ? 0 : -1}
                  onClick={() => setDevice(d)}
                  onKeyDown={(e) => {
                    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                    const next = DEVICES[(i + (e.key === 'ArrowRight' ? 1 : DEVICES.length - 1)) % DEVICES.length]
                    setDevice(next)
                    document.getElementById(`${def.id}-tab-${next}`)?.focus()
                  }}
                >
                  {d === 'desktop' ? 'Desktop values' : 'Mobile values'}
                  {managedParamPaths(def, d).some((p) => changed(p)) && <span className="adm-dot" aria-label="(unsaved changes)" />}
                </button>
              ))}
            </div>
            <button type="button" className="adm-reset adm-tabs__reset" onClick={() => reset(...managedParamPaths(def, device))}>
              Reset {device} values
            </button>
          </div>
          <div role="tabpanel" id={`${def.id}-panel`} aria-labelledby={`${def.id}-tab-${device}`} className="adm-devices__panel">
            {params.map(([key, spec]) => {
              const s = paramState(def, cfg, device, key)
              const path = paramPath(def.id, device, key)
              const common = {
                label: spec.label,
                hint: spec.help,
                isDefault: s.isDefault,
                changed: changed(path),
                warning: s.storedInvalid ? invalid : null,
                onReset: () => reset(path),
              }
              if (spec.kind === 'number')
                return (
                  <NumberField
                    key={`${device}.${key}-${editor.version}`}
                    {...common}
                    value={s.value as number}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    unit={spec.unit}
                    defaultText={`${defaultParam(def, device, key)}${spec.unit ? ` ${spec.unit}` : ''}`}
                    onChange={(v) => set(path, v)}
                    onValidity={(p) => editor.setFieldError(`${def.id}.${device}.${key}`, p)}
                  />
                )
              if (spec.kind === 'boolean')
                return <ToggleField key={`${device}.${key}`} {...common} checked={s.value as boolean} defaultText={defaultParam(def, device, key) ? 'On' : 'Off'} onChange={(v) => set(path, v)} />
              return (
                <SelectField
                  key={`${device}.${key}`}
                  {...common}
                  value={s.value as string}
                  options={spec.options.map((o) => ({ value: o, label: o }))}
                  defaultText={String(defaultParam(def, device, key))}
                  onChange={(v) => set(path, v)}
                />
              )
            })}
          </div>
        </div>
      )}
    </SettingGroup>
  )
}
