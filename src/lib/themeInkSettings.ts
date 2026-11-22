/**
 * Theme ink transition — settings (pure: no DOM, no React, safe to import anywhere).
 *
 * Single source of truth for the transition's CMS-editable values: their defaults (the
 * exact values the transition used before CMS support), their allowed ranges (used by the
 * Animation Registry definition `themeInkTransition` in src/animations/builtin.ts), and
 * the conversion from resolved CMS values to what themeTransition.ts needs.
 *
 * With no CMS settings, every value below equals the previous hard-coded constant, so the
 * transition looks and behaves exactly as before.
 */
import type { NumberParam, BooleanParam, ResolvedAnimation } from '../animations/types'

export const THEME_INK_ID = 'themeInkTransition'

// ---------------------------------------------------------------------------- fixed look (code only)

/** Noise seed; every switch adds a counter so no two transitions look identical. */
export const FLOW_SEED = 17
/** Radius (fraction of the screen diagonal) of the clean splash right at the toggle. */
export const CALM_RADIUS = 0.2
/** Size of the large bulges (higher = more, smaller bulges). */
export const LOBE_SCALE = 2.6
/** How much the ink streaks stretch in the direction of travel (1 = no stretch). */
export const RADIAL_STRETCH = 1.0
/** Number of crown spikes (per radian). */
export const SPIKE_FREQ = 10
/** How far from the toggle the crown spikes reach (fraction of the diagonal). */
export const SPIKE_REACH = 0.12
/** Flow-field resolution relative to the viewport (the mask is smoothly upscaled). */
export const FIELD_RESOLUTION = 0.5

// ---------------------------------------------------------------------------- CMS-editable

/**
 * Parameter specs for the registry. Defaults = the transition's values before CMS support
 * (DURATION_MS 2200, easing burst 0.18, PLANAR 0.65, LOBES 0.17, MARBLE_MIX 0.22,
 * MARBLE_SCALE 2.6, MARBLE_WARP 1.2, SPIKES 0.04, EDGE_SHARPNESS 90, new pattern per switch).
 */
export const THEME_INK_PARAMS = {
  durationMs: { kind: 'number', label: 'Duration', min: 1200, max: 3000, step: 100, default: 2200, unit: 'ms', scale: 'duration', help: 'Total length of the switch. Clicks are ignored while it runs.' },
  openingSplash: { kind: 'number', label: 'Opening splash', min: 0, max: 0.3, step: 0.01, default: 0.18, help: 'How quickly the first splash bursts out of the toggle.' },
  straightness: { kind: 'number', label: 'Front straightness', min: 0, max: 1, step: 0.05, default: 0.65, help: '0 = spreads in circles around the toggle, 1 = a straight sweeping front.' },
  raggedness: { kind: 'number', label: 'Raggedness', min: 0.05, max: 0.25, step: 0.01, default: 0.17, help: 'Size of the irregular bulges and fjords of the ink.' },
  edgeWidth: { kind: 'number', label: 'Broken edge width', min: 0.1, max: 0.35, step: 0.01, default: 0.22, help: 'Width of the zone with islands and lakes around the front.' },
  chunkSize: { kind: 'number', label: 'Chunk size', min: 1.5, max: 4, step: 0.1, default: 2.6, help: 'Higher = smaller, busier ink pieces.' },
  swirl: { kind: 'number', label: 'Swirl', min: 0.5, max: 2.5, step: 0.1, default: 1.2, help: 'How much the ink pieces curl.' },
  crownSpikes: { kind: 'number', label: 'Crown spikes', min: 0, max: 0.08, step: 0.01, default: 0.04, help: 'Spiky crown of the first splash.' },
  edgeCrispness: { kind: 'number', label: 'Edge crispness', min: 40, max: 110, step: 5, default: 90, help: 'Higher = crisper ink edges; very high values can look stepped.' },
  fixedPattern: { kind: 'boolean', label: 'Same pattern every time', default: false, help: 'Off = a new pattern for every switch.' },
} as const satisfies Record<string, NumberParam | BooleanParam>

type NumberKey = { [K in keyof typeof THEME_INK_PARAMS]: (typeof THEME_INK_PARAMS)[K] extends { kind: 'number' } ? K : never }[keyof typeof THEME_INK_PARAMS]

/** Values handed to the field worker (same shape as FieldRequest['params']). */
export interface InkFieldParams {
  planar: number
  calm: number
  lobes: number
  lobeScale: number
  marbleMix: number
  marbleScale: number
  marbleWarp: number
  radialStretch: number
  spikes: number
  spikeFreq: number
  spikeReach: number
}

export interface InkSettings {
  durationMs: number
  openingSplash: number
  fixedPattern: boolean
  /** Edge sharpness in raw field units. */
  sharpness: number
  field: InkFieldParams
  /** Identifies everything that changes the prepared pattern/mask (not duration/easing). */
  key: string
}

/**
 * Converts resolved CMS values into transition settings. Defensive on its own: anything
 * missing, of the wrong type or non-finite falls back to the default, and every number is
 * clamped to its declared range — so the worker never receives an unsafe value even if
 * called with unvalidated input.
 */
export function inkSettingsFrom(params: unknown): InkSettings {
  const p = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
  const num = (k: NumberKey) => {
    const spec = THEME_INK_PARAMS[k]
    const v = Object.hasOwn(p, k) ? p[k] : undefined
    return typeof v === 'number' && Number.isFinite(v) ? Math.min(spec.max, Math.max(spec.min, v)) : spec.default
  }
  const fixed = Object.hasOwn(p, 'fixedPattern') ? p.fixedPattern : undefined
  const field: InkFieldParams = {
    planar: num('straightness'),
    calm: CALM_RADIUS,
    lobes: num('raggedness'),
    lobeScale: LOBE_SCALE,
    marbleMix: num('edgeWidth'),
    marbleScale: num('chunkSize'),
    marbleWarp: num('swirl'),
    radialStretch: RADIAL_STRETCH,
    spikes: num('crownSpikes'),
    spikeFreq: SPIKE_FREQ,
    spikeReach: SPIKE_REACH,
  }
  const sharpness = num('edgeCrispness')
  const fixedPattern = typeof fixed === 'boolean' ? fixed : THEME_INK_PARAMS.fixedPattern.default
  return {
    durationMs: num('durationMs'),
    openingSplash: num('openingSplash'),
    fixedPattern,
    sharpness,
    field,
    key: JSON.stringify([field, sharpness, fixedPattern, FIELD_RESOLUTION]),
  }
}

/** The settings with no CMS values (= the transition before CMS support). */
export const DEFAULT_INK_SETTINGS = inkSettingsFrom({})

/**
 * Progress easing: an ink splash bursts out of the toggle (weight `splash`), then the
 * front crosses the screen at a nearly steady pace. splash 0.18 = the original curve.
 */
export const inkEasing = (t: number, splash: number) => Math.min(1, splash * (1 - Math.exp(-20 * t)) + (1 - splash) * t ** 1.1)

/**
 * Field values are stored as 0–1 in an 8-bit image: raw = d + lobes + marble + spikes.
 * Returns the mapping and the mask slope for these settings.
 */
export function inkMath(s: InkSettings) {
  const spread = s.field.lobes + s.field.marbleMix + s.field.spikes
  return {
    toStored: (raw: number) => (raw + spread) / (1 + 2 * spread),
    /** Mask slope in stored (normalised) field units. */
    slope: s.sharpness * (1 + 2 * spread),
  }
}

/** Seed of the next pattern: new per switch, or always the first switch's pattern. */
export const inkSeed = (runs: number, fixedPattern: boolean) => FLOW_SEED + (fixedPattern ? 1 : runs + 1) * 101

// ---------------------------------------------------------------------------- what to run

/**
 *   ink        the marbled ink transition
 *   crossfade  150 ms crossfade (reduced motion, mode "static")
 *   instant    switch with no animation (reduced motion with "off", or no View Transitions)
 *   fade       the existing page-wide colour fade (switched off, not for this device,
 *              failed, or no View Transitions)
 */
export type InkTransitionMode = 'ink' | 'crossfade' | 'instant' | 'fade'

export function chooseInkMode(opts: { viewTransitions: boolean; prefersReduced: boolean; resolved: Pick<ResolvedAnimation, 'active' | 'mode'> | null }): InkTransitionMode {
  const { viewTransitions, prefersReduced, resolved } = opts
  // No View Transitions: the existing fallback, exactly as before CMS support.
  if (!viewTransitions) return prefersReduced ? 'instant' : 'fade'
  if (prefersReduced && resolved?.mode === 'off') return 'instant'
  // Disabled, wrong device, failed, or settings unreadable: the simple colour fade
  // (no animation at all for visitors who prefer reduced motion).
  if (!resolved?.active) return prefersReduced ? 'instant' : 'fade'
  return prefersReduced ? 'crossfade' : 'ink'
}
