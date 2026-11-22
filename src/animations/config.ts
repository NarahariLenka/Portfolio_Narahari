/**
 * Animation settings stored in Supabase (site_settings.animation, migration 003) and
 * their resolution against the registry.
 *
 * Stored shape (data only — ids, numbers, booleans, option names):
 * {
 *   "version": 1,
 *   "global": { "enabled": true, "speed": 1, "intensity": 1, "density": 1, "duration": 1 },
 *   "animations": {
 *     "contactDotField": {
 *       "enabled": true,
 *       "devices": { "desktop": true, "mobile": true },
 *       "reducedMotion": "static",
 *       "placement": "section-overlay",          // layers only
 *       "sections": ["contact"],                  // layers only, subset of supported
 *       "desktop": { "bulgeStrength": 80 },       // per-device parameter values
 *       "mobile":  { "bulgeStrength": 40 }
 *     }
 *   }
 * }
 *
 * Everything is validated against the registered definition: unknown ids, unknown
 * params and out-of-range values are dropped or clamped, never trusted. Parsing never
 * throws. With no stored settings every animation behaves exactly as coded today.
 */
import type { SectionSlug } from '../data/remote'
import { getAnimation, listAnimations } from './registry'
import { clamp, cleanParams, cleanValue, isNum, obj, own } from './values'
import type {
  AnimationDefinition,
  AnyAnimationDefinition,
  Device,
  GlobalScale,
  ParamSchema,
  ParamValues,
  Placement,
  ReducedMotionMode,
  ResolvedAnimation,
} from './types'

export interface StoredAnimation {
  enabled?: boolean
  devices?: Partial<Record<Device, boolean>>
  reducedMotion?: ReducedMotionMode
  placement?: Placement
  sections?: SectionSlug[]
  desktop?: Record<string, unknown>
  mobile?: Record<string, unknown>
}

export interface AnimationConfig {
  version: 1
  global: { enabled: boolean } & Record<GlobalScale, number>
  animations: Record<string, StoredAnimation>
}

/** Limits for the global multipliers (1 = as designed). */
export const GLOBAL_LIMITS: Record<GlobalScale, { min: number; max: number }> = {
  speed: { min: 0.25, max: 2 },
  intensity: { min: 0, max: 2 },
  density: { min: 0.25, max: 2 },
  duration: { min: 0.5, max: 2 },
}

export const DEFAULT_ANIMATION_CONFIG: AnimationConfig = {
  version: 1,
  global: { enabled: true, speed: 1, intensity: 1, density: 1, duration: 1 },
  animations: {},
}

// ---------------------------------------------------------------------------- parse

export interface ParseResult {
  config: AnimationConfig
  /** Human-readable notes about anything dropped or corrected (for the admin). */
  issues: string[]
}

/**
 * Whether CMS settings for this animation take effect today. Builtins with
 * `managed: false` don't read settings yet: their entries are dropped, never stored.
 */
export const isConfigurable = (def: AnyAnimationDefinition) => def.kind === 'layer' || def.managed !== false

const BOOL_DEVICES = ['desktop', 'mobile'] as const

/** Validates raw CMS JSON against the registry. Never throws. */
export function parseAnimationConfig(input: unknown): ParseResult {
  try {
    return parseUnsafe(input)
  } catch (error) {
    // Defensive: the checks below shouldn't throw, but a parser bug must never take
    // the page down. Fall back to "as coded" for every animation.
    return { config: structuredClone(DEFAULT_ANIMATION_CONFIG), issues: [`animation settings ignored: ${String(error)}`] }
  }
}

function parseUnsafe(input: unknown): ParseResult {
  const issues: string[] = []
  const v = obj(input)
  const g = obj(own(v, 'global'))
  const global = { ...DEFAULT_ANIMATION_CONFIG.global }
  const enabledIn = own(g, 'enabled')
  if (typeof enabledIn === 'boolean') global.enabled = enabledIn
  for (const k of Object.keys(GLOBAL_LIMITS) as GlobalScale[]) {
    const n = own(g, k)
    if (n === undefined) continue
    if (isNum(n)) global[k] = clamp(n, GLOBAL_LIMITS[k].min, GLOBAL_LIMITS[k].max)
    else issues.push(`global.${k} ignored (not a number)`)
  }

  const animations: Record<string, StoredAnimation> = {}
  for (const [id, raw] of Object.entries(obj(own(v, 'animations')))) {
    const def = getAnimation(id)
    if (!def) {
      issues.push(`"${id}" is not a registered animation; ignored`)
      continue
    }
    if (!isConfigurable(def)) {
      issues.push(`"${id}" is not configurable yet; its settings were not kept`)
      continue
    }
    const a = obj(raw)
    const out: StoredAnimation = {}

    const enabled = own(a, 'enabled')
    if (typeof enabled === 'boolean') out.enabled = enabled
    const dev = obj(own(a, 'devices'))
    for (const d of BOOL_DEVICES) {
      const on = own(dev, d)
      if (typeof on === 'boolean') (out.devices ??= {})[d] = on
    }

    const rm = own(a, 'reducedMotion')
    if (rm !== undefined) {
      if (typeof rm === 'string' && (def.reducedMotion.allowed as readonly string[]).includes(rm)) out.reducedMotion = rm as ReducedMotionMode
      else issues.push(`"${id}": reduced-motion mode ${JSON.stringify(rm)} not allowed`)
    }

    if (def.kind === 'layer') {
      const placement = own(a, 'placement')
      if (placement !== undefined) {
        if (typeof placement === 'string' && (def.placements as readonly string[] | undefined)?.includes(placement)) out.placement = placement as Placement
        else issues.push(`"${id}": placement ${JSON.stringify(placement)} not allowed`)
      }
      const sections = own(a, 'sections')
      if (Array.isArray(sections)) {
        const ok = sections.filter((s): s is SectionSlug => typeof s === 'string' && (def.sections as readonly string[]).includes(s))
        if (ok.length !== sections.length) issues.push(`"${id}": unsupported sections dropped`)
        out.sections = [...new Set(ok)]
      }
    }

    for (const d of BOOL_DEVICES) {
      const rejected: string[] = []
      const p = cleanParams(def, own(a, d), rejected)
      if (Object.keys(p).length) out[d] = p
      if (rejected.length) issues.push(`"${id}": invalid ${d} values ignored (${rejected.join(', ')})`)
    }
    animations[id] = out
  }
  return { config: { version: 1, global, animations }, issues }
}

/**
 * What the admin should save: the validated config only. Unknown ids, invalid values
 * and entries for animations that aren't configurable yet are removed, so nothing is
 * stored that looks configurable but has no effect.
 */
export const prepareAnimationConfigForSave = (input: unknown): ParseResult => parseAnimationConfig(input)

// ---------------------------------------------------------------------------- resolve

/** Final settings for one animation on one device, given the visitor's motion preference. */
export function resolveAnimation<S extends ParamSchema>(
  def: AnimationDefinition<S>,
  config: AnimationConfig,
  device: Device,
  prefersReduced: boolean,
  failed: boolean,
): ResolvedAnimation<S> {
  // Builtins that don't read settings yet are always "as coded": ignore the CMS for them.
  const stored: StoredAnimation = isConfigurable(def) ? ((own(config.animations, def.id) as StoredAnimation | undefined) ?? {}) : {}
  const values: Record<string, unknown> = {}
  for (const [key, spec] of Object.entries(def.params)) values[key] = spec.default
  Object.assign(values, def.deviceDefaults?.[device], stored[device])

  // Global multipliers on opted-in numeric params, then clamp/round back into range.
  // (Definitions were sanitised at registration, so their own defaults are in range.)
  if (isConfigurable(def)) {
    for (const [key, spec] of Object.entries(def.params)) {
      if (spec.kind === 'number' && spec.scale && config.global[spec.scale] !== 1)
        values[key] = cleanValue(spec, (values[key] as number) * config.global[spec.scale]) ?? spec.default
    }
  }

  const mode: ResolvedAnimation['mode'] = prefersReduced ? (stored.reducedMotion ?? def.reducedMotion.default) : 'full'
  if (mode === 'reduced') Object.assign(values, def.reducedParams)

  const enabled = stored.enabled ?? def.defaultEnabled
  const onDevice = stored.devices?.[device] ?? def.defaultDevices?.[device] ?? true
  const globalOn = config.global.enabled || !isConfigurable(def)

  return {
    id: def.id,
    active: !failed && globalOn && enabled && onDevice && mode !== 'off',
    params: values as ParamValues<S>,
    device,
    reducedMotion: prefersReduced,
    mode,
    placement: def.kind === 'layer' ? (stored.placement ?? def.placements?.[0] ?? null) : null,
    sections: def.kind === 'layer' ? (stored.sections ?? [...def.sections]) : [...def.sections],
  }
}

/** Serializable catalogue for the admin: every registered animation and its controls. */
export function describeAnimations() {
  return listAnimations().map(({ load: _load, ...meta }) => {
    const configurable = isConfigurable(meta as AnyAnimationDefinition)
    return {
      ...meta,
      /** Whether CMS settings take effect today. */
      controllable: configurable,
      status: configurable ? ('available' as const) : ('unavailable' as const),
      /** Shown in the admin instead of controls when unavailable. */
      unavailableReason: configurable ? null : 'Always on as designed. Settings for this effect are not available yet.',
      /** No controls are offered (or saved) for unavailable animations. */
      params: configurable ? meta.params : {},
    }
  })
}
