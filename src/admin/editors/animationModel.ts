/**
 * Animations editor model (pure): what the stored site_settings.animation JSON means for
 * each registered animation, which paths the editor may change, and validation of
 * those changes against the registry. Metadata comes from the registry only.
 */
import { describeAnimations, GLOBAL_LIMITS, getAnimation, isConfigurable, parseAnimationConfig } from '../../animations'
import type { AnyAnimationDefinition, Device, NumberParam, ParamSchema, ReducedMotionMode } from '../../animations'
import { cleanValue } from '../../animations/values'
import { diffLeaves, getPath, isObject, type Path } from '../settings/json'
import type { Draft } from '../settings/draft'
import type { SettingsRecord } from '../settings/schema'

export const DEVICES: readonly Device[] = ['desktop', 'mobile']

/** Global multipliers that at least one registered parameter actually uses. */
export function usedGlobalScales(): (keyof typeof GLOBAL_LIMITS)[] {
  const used = new Set<string>()
  for (const d of describeAnimations()) {
    if (!d.controllable) continue
    for (const spec of Object.values(d.params as ParamSchema)) if (spec.kind === 'number' && spec.scale) used.add(spec.scale)
  }
  return (Object.keys(GLOBAL_LIMITS) as (keyof typeof GLOBAL_LIMITS)[]).filter((k) => used.has(k))
}

/** Slider step for the global multipliers (the parser keeps any value in range). */
export const GLOBAL_STEP = 0.05

// ---------------------------------------------------------------------------- paths

export const globalPath = (key: string): Path => ['global', key]
export const entryPath = (id: string): Path => ['animations', id]
export const enabledPath = (id: string): Path => ['animations', id, 'enabled']
export const devicePath = (id: string, d: Device): Path => ['animations', id, 'devices', d]
export const reducedPath = (id: string): Path => ['animations', id, 'reducedMotion']
export const paramPath = (id: string, d: Device, key: string): Path => ['animations', id, d, key]

// ---------------------------------------------------------------------------- effective values

export const defaultParam = (def: AnyAnimationDefinition, d: Device, key: string) =>
  (def.deviceDefaults?.[d] as Record<string, unknown> | undefined)?.[key] ?? def.params[key].default

/** What a stored value means: the value itself when the site accepts it exactly, else the default. */
export function paramState(def: AnyAnimationDefinition, cfg: unknown, d: Device, key: string) {
  const spec = def.params[key]
  const fallback = defaultParam(def, d, key)
  const stored = getPath(cfg, paramPath(def.id, d, key))
  if (stored === undefined) return { value: fallback, isDefault: true, storedInvalid: false }
  const valid = cleanValue(spec, stored) === stored
  return { value: valid ? stored : fallback, isDefault: !valid || stored === fallback, storedInvalid: !valid }
}

export function boolState(cfg: unknown, path: Path, fallback: boolean) {
  const stored = getPath(cfg, path)
  const valid = typeof stored === 'boolean'
  return { value: valid ? stored : fallback, isDefault: !valid || stored === fallback, storedInvalid: stored !== undefined && !valid }
}

export function reducedState(def: AnyAnimationDefinition, cfg: unknown) {
  const stored = getPath(cfg, reducedPath(def.id))
  const valid = typeof stored === 'string' && (def.reducedMotion.allowed as readonly string[]).includes(stored)
  const value = (valid ? stored : def.reducedMotion.default) as ReducedMotionMode
  return { value, isDefault: value === def.reducedMotion.default, storedInvalid: stored !== undefined && !valid }
}

export function globalNumberState(cfg: unknown, key: keyof typeof GLOBAL_LIMITS) {
  const stored = getPath(cfg, globalPath(key))
  const { min, max } = GLOBAL_LIMITS[key]
  const valid = typeof stored === 'number' && Number.isFinite(stored) && stored >= min && stored <= max
  const value = valid ? stored : 1
  return { value, isDefault: value === 1, storedInvalid: stored !== undefined && !valid }
}

/** Reset helpers: the keys the editor manages (unknown keys in the same objects are kept). */
export function managedParamPaths(def: AnyAnimationDefinition, d: Device): Path[] {
  return Object.keys(def.params).map((k) => paramPath(def.id, d, k))
}
export function managedEntryPaths(def: AnyAnimationDefinition): Path[] {
  return [enabledPath(def.id), ...DEVICES.map((d) => devicePath(def.id, d)), reducedPath(def.id), ...DEVICES.flatMap((d) => managedParamPaths(def, d))]
}

// ---------------------------------------------------------------------------- validation

const near = (a: number, b: number) => Math.abs(a - b) < 1e-9

/** Why a value the admin set isn't valid for this path, or null. Never corrects it. */
function changeProblem(path: string[], value: unknown): string | null {
  if (path[0] === 'global' && path.length === 2) {
    const key = path[1]
    if (key === 'enabled') return typeof value === 'boolean' ? null : 'Master switch must be on or off.'
    const lim = GLOBAL_LIMITS[key as keyof typeof GLOBAL_LIMITS]
    if (!lim) return `Unknown global setting "${key}".`
    if (typeof value !== 'number' || !Number.isFinite(value) || value < lim.min || value > lim.max) return `Global ${key} must be between ${lim.min} and ${lim.max}.`
    return null
  }
  if (path[0] !== 'animations' || path.length < 3) return `Unexpected change at "${path.join('.')}".`
  const def = getAnimation(path[1])
  if (!def) return `"${path[1]}" is not a registered animation.`
  if (!isConfigurable(def)) return `${def.name} can’t be configured.`
  const [, , field, sub] = path
  if (field === 'enabled' && path.length === 3) return typeof value === 'boolean' ? null : `${def.name}: on/off must be a switch value.`
  if (field === 'devices' && path.length === 4 && (DEVICES as readonly string[]).includes(sub))
    return typeof value === 'boolean' ? null : `${def.name}: device switch must be on or off.`
  if (field === 'reducedMotion' && path.length === 3)
    return typeof value === 'string' && (def.reducedMotion.allowed as readonly string[]).includes(value) ? null : `${def.name}: reduced-motion option not allowed.`
  if ((DEVICES as readonly string[]).includes(field) && path.length === 4) {
    const spec = def.params[sub]
    if (!spec || !Object.hasOwn(def.params, sub)) return `${def.name}: unknown setting "${sub}".`
    const clean = cleanValue(spec, value)
    if (clean === undefined) return `${def.name}: ${spec.label} has an invalid value.`
    if (spec.kind === 'number' && !near(clean as number, value as number)) {
      const s = spec as NumberParam
      return `${def.name}: ${spec.label} must be between ${s.min} and ${s.max} in steps of ${s.step}.`
    }
    return null
  }
  return `Unexpected change at "${path.join('.')}".`
}

/**
 * Validates the editor's changes to the animation column: every changed value must be
 * one the site would use exactly as entered. Removals (= back to default) are always fine.
 * Unknown keys that were already stored are left alone and not judged.
 */
export function validateAnimationDraft(draft: Draft, record: SettingsRecord): string[] {
  const next = draft.animation
  if (!isObject(next)) return ['Animation settings must be a JSON object.']
  const problems: string[] = []
  for (const change of diffLeaves(record.animation, next)) {
    if ('remove' in change) continue
    const p = changeProblem(change.path, change.value)
    if (p) problems.push(p)
  }
  return problems
}

/** Corrections the site applies to what is stored today (shown to the admin, never auto-fixed). */
export const storedIssues = (record: SettingsRecord) => parseAnimationConfig(record.animation).issues

/**
 * The config used for a local preview. `as` = the device whose values to show; when it
 * differs from the device this screen counts as, those values are copied onto the
 * screen's device (a simulation, labelled as such in the UI).
 */
export function previewConfig(animation: unknown, id: string, as: Device, actual: Device): unknown {
  if (as === actual || !isObject(animation)) return animation
  const cfg = JSON.parse(JSON.stringify(animation)) as Record<string, unknown>
  const entry = getPath(cfg, entryPath(id))
  if (!isObject(entry)) return cfg
  const src = isObject(entry[as]) ? entry[as] : {}
  entry[actual] = { ...src }
  if (isObject(entry.devices) && typeof entry.devices[as] === 'boolean') entry.devices[actual] = entry.devices[as]
  else if (isObject(entry.devices)) delete entry.devices[actual]
  return cfg
}
