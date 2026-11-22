/**
 * Animation Registry — types.
 *
 * An animation is described by a plain, serialisable DEFINITION (id, name, sections,
 * parameters with ranges and defaults) plus, for pluggable animations, a lazy loader for
 * its React component. Only the definition's ids and the admin's validated values ever
 * touch Supabase; the code always stays in this repository.
 */
import type { ComponentType } from 'react'
import type { SectionSlug } from '../data/remote'

export type Device = 'desktop' | 'mobile'

/** Global CMS multipliers a numeric parameter can opt into. */
export type GlobalScale = 'speed' | 'intensity' | 'density' | 'duration'

export interface NumberParam {
  kind: 'number'
  label: string
  min: number
  max: number
  /** Step for the admin slider; values are rounded to it. */
  step: number
  default: number
  unit?: string
  /** If set, the global multiplier of that name is applied (then clamped to min–max). */
  scale?: GlobalScale
  help?: string
}

export interface BooleanParam {
  kind: 'boolean'
  label: string
  default: boolean
  help?: string
}

export interface ChoiceParam<T extends string = string> {
  kind: 'choice'
  label: string
  options: readonly T[]
  default: T
  help?: string
}

export type ParamSpec = NumberParam | BooleanParam | ChoiceParam
export type ParamSchema = Record<string, ParamSpec>

/** Resolved parameter values for a schema. */
export type ParamValues<S extends ParamSchema> = {
  [K in keyof S]: S[K] extends NumberParam ? number : S[K] extends BooleanParam ? boolean : S[K] extends ChoiceParam<infer T> ? T : never
}

/**
 * Where a pluggable animation is drawn. Layers never take pointer input and never
 * change layout, so they cannot interfere with the page or with each other.
 *   page-background   fixed, behind all content, above the cosmic background
 *   page-overlay      fixed, above content, below the shooting-star sling and the nav
 *   section-background inside the section, behind its content
 *   section-overlay   inside the section, above its content
 */
export const PLACEMENTS = ['page-background', 'page-overlay', 'section-background', 'section-overlay'] as const
export type Placement = (typeof PLACEMENTS)[number]

/**
 * What happens for visitors who ask for reduced motion. "full" motion is deliberately
 * not an option: the preference is always honoured.
 *   off     the animation is not shown at all
 *   static  shown as a still frame (the module receives reducedMotion = true)
 *   reduced shown with `reducedParams` applied on top (gentler values)
 */
export const REDUCED_MOTION_MODES = ['off', 'static', 'reduced'] as const
export type ReducedMotionMode = (typeof REDUCED_MOTION_MODES)[number]

/** Props every pluggable animation component receives. */
export interface AnimationProps<S extends ParamSchema = ParamSchema> {
  params: ParamValues<S>
  device: Device
  /** True when the visitor prefers reduced motion (mode "static" or "reduced"). */
  reducedMotion: boolean
  placement: Placement
  /** The section it is drawn in, or null for page-level placements. */
  section: SectionSlug | null
}

export interface AnimationDefinition<S extends ParamSchema = ParamSchema> {
  /** Unique, stable id (camelCase). This is the key stored in the CMS — never rename it. */
  id: string
  name: string
  description: string
  /**
   * "builtin": an existing effect implemented inside its section component, which reads
   *            its settings through useAnimation(id).
   * "layer":   a self-contained module mounted by the registry via `load`.
   */
  kind: 'builtin' | 'layer'
  /** Sections it may appear in. For page-level effects use []. */
  sections: readonly SectionSlug[]
  /** Layers only: allowed placements; the first is the default. */
  placements?: readonly Placement[]
  params: S
  /** Per-device defaults that differ from each param's `default`. */
  deviceDefaults?: Partial<Record<Device, Partial<ParamValues<S>>>>
  /** Devices it runs on by default. */
  defaultDevices?: Partial<Record<Device, boolean>>
  /** Off by default? New layer animations should usually start disabled. */
  defaultEnabled: boolean
  reducedMotion: { default: ReducedMotionMode; allowed: readonly ReducedMotionMode[] }
  /** Values applied in "reduced" mode. */
  reducedParams?: Partial<ParamValues<S>>
  /**
   * Builtins only: false while the component does not yet read its settings, so the
   * admin can show it as "always on" instead of offering controls that do nothing.
   */
  managed?: boolean
  /** Layers only: lazy component loader (keeps each animation in its own chunk). */
  load?: () => Promise<{ default: ComponentType<AnimationProps<S>> }>
}

/** Fully validated settings for one animation on one device. */
export interface ResolvedAnimation<S extends ParamSchema = ParamSchema> {
  id: string
  /** False if switched off, not for this device, failed, or hidden for reduced motion. */
  active: boolean
  params: ParamValues<S>
  device: Device
  reducedMotion: boolean
  mode: 'full' | ReducedMotionMode
  placement: Placement | null
  sections: SectionSlug[]
}

/** Any definition, whatever its params (used by the registry's storage and lists). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyAnimationDefinition = AnimationDefinition<any>
