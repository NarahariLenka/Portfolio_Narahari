/**
 * Animation Registry — the in-code list of every animation the CMS can manage.
 * Registering is the ONLY step that makes an animation manageable: the CMS stores
 * settings keyed by id, and ids that aren't registered here are ignored.
 */
import { SECTION_SLUGS } from '../data/remote'
import { PLACEMENTS, REDUCED_MOTION_MODES, type AnimationDefinition, type AnyAnimationDefinition, type ParamSchema, type ParamSpec } from './types'
import { cleanParams, cleanValue, obj, own } from './values'

const registry = new Map<string, AnyAnimationDefinition>()

/** Identity helper that keeps full type inference for a definition's params. */
export const defineAnimation = <S extends ParamSchema>(def: AnimationDefinition<S>) => def

const ID = /^[a-z][a-zA-Z0-9]{1,47}$/

/**
 * Structural problems that make a definition unusable (empty = valid). Out-of-range
 * default VALUES are not problems: sanitizeDefinition() clamps them with a warning.
 */
export function definitionProblems(def: AnyAnimationDefinition): string[] {
  const p: string[] = []
  if (!ID.test(def.id)) p.push(`id "${def.id}" must be camelCase letters/digits (2–48 chars)`)
  if (!def.name.trim()) p.push('name is empty')
  for (const s of def.sections) if (!(SECTION_SLUGS as readonly string[]).includes(s)) p.push(`unknown section "${s}"`)
  if (def.kind === 'layer') {
    if (!def.load) p.push('layer animations need load()')
    if (!def.placements?.length) p.push('layer animations need at least one placement')
    for (const pl of def.placements ?? []) if (!(PLACEMENTS as readonly string[]).includes(pl)) p.push(`unknown placement "${pl}"`)
    if (def.placements?.some((pl) => pl.startsWith('section-')) && !def.sections.length)
      p.push('section placements need at least one supported section')
  }
  const rm = def.reducedMotion
  if (!rm.allowed.length || !rm.allowed.includes(rm.default)) p.push('reducedMotion.default must be one of reducedMotion.allowed')
  for (const m of rm.allowed) if (!(REDUCED_MOTION_MODES as readonly string[]).includes(m)) p.push(`unknown reduced-motion mode "${m}"`)
  for (const [key, spec] of Object.entries(def.params as ParamSchema)) {
    if (!ID.test(key)) p.push(`param "${key}" must be camelCase`)
    if (spec.kind === 'number' && (!(spec.min < spec.max) || !(spec.step > 0))) p.push(`param "${key}": need min < max and step > 0`)
    if (spec.kind === 'choice' && !spec.options.length) p.push(`param "${key}": needs at least one option`)
  }
  return p
}

/**
 * Clamps a definition's own default values into their declared ranges: param defaults,
 * per-device defaults and reduced-motion values. Unknown keys are dropped. Returns a
 * clean copy and a warning per correction (never rejects, so a typo in a default can't
 * switch an existing effect off).
 */
export function sanitizeDefinition(def: AnyAnimationDefinition): { def: AnyAnimationDefinition; warnings: string[] } {
  const warnings: string[] = []
  const params: ParamSchema = {}
  for (const [key, spec] of Object.entries(def.params as ParamSchema)) {
    const fixed = cleanValue(spec, spec.default)
    if (fixed === undefined || fixed !== spec.default) {
      const fallback = fixed ?? (spec.kind === 'number' ? spec.min : spec.kind === 'boolean' ? false : spec.options[0])
      warnings.push(`param "${key}": default ${JSON.stringify(spec.default)} corrected to ${JSON.stringify(fallback)}`)
      params[key] = { ...spec, default: fallback } as ParamSpec
    } else params[key] = spec
  }
  const clean = { ...def, params }

  type Values = Partial<Record<string, string | number | boolean>>
  const values = (label: string, input: unknown): Values => {
    const rejected: string[] = []
    const out = cleanParams(clean, input, rejected)
    // A value that changed while cleaning (clamped / rounded) is also worth a warning.
    for (const [k, v] of Object.entries(obj(input))) if (Object.hasOwn(out, k) && out[k] !== v) warnings.push(`${label}.${k}: ${JSON.stringify(v)} corrected to ${JSON.stringify(out[k])}`)
    if (rejected.length) warnings.push(`${label}: invalid entries dropped (${rejected.join(', ')})`)
    return out as Values
  }
  if (def.deviceDefaults) {
    clean.deviceDefaults = {}
    for (const d of ['desktop', 'mobile'] as const) {
      const input = own(def.deviceDefaults, d)
      if (input !== undefined) clean.deviceDefaults[d] = values(`deviceDefaults.${d}`, input)
    }
  }
  if (def.reducedParams) clean.reducedParams = values('reducedParams', def.reducedParams)
  if (def.defaultDevices) {
    clean.defaultDevices = {}
    for (const d of ['desktop', 'mobile'] as const) {
      const on = own(def.defaultDevices, d)
      if (typeof on === 'boolean') clean.defaultDevices[d] = on
      else if (on !== undefined) warnings.push(`defaultDevices.${d} must be true/false; ignored`)
    }
  }
  return { def: clean, warnings }
}

/**
 * Replaces the registry with this list (so dev hot-reload can re-run it safely).
 * A structurally invalid definition, or a second one with an id already in the list, is
 * rejected with a console error and skipped — one broken module can't take the others
 * down. Out-of-range defaults are clamped with a console warning.
 * Returns the ids that were registered.
 */
export function registerAnimations(defs: readonly AnyAnimationDefinition[]): string[] {
  registry.clear()
  for (const def of defs) {
    const problems = definitionProblems(def)
    if (registry.has(def.id)) problems.push(`duplicate id "${def.id}"`)
    if (problems.length) {
      console.error(`[animations] "${def.id}" not registered: ${problems.join('; ')}`)
      continue
    }
    const { def: clean, warnings } = sanitizeDefinition(def)
    if (warnings.length) console.warn(`[animations] "${def.id}" defaults corrected: ${warnings.join('; ')}`)
    registry.set(def.id, Object.freeze(clean))
  }
  return [...registry.keys()]
}

export const getAnimation = (id: string): AnyAnimationDefinition | undefined => registry.get(id)
export const listAnimations = (): AnyAnimationDefinition[] => [...registry.values()]
