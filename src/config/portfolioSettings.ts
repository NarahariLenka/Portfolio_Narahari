/**
 * Portfolio settings: the typed, validated shape behind the future Appearance and
 * Background managers (site_settings.appearance / .backgrounds, see
 * supabase/migrations/003_portfolio_settings.sql). Animation settings
 * (site_settings.animation) belong to the Animation Registry in src/animations/.
 *
 * Rules
 *   • Only data: numbers, booleans and identifiers from fixed lists below. Never code,
 *     CSS, shader source or URLs — the site maps identifiers to its own implementation.
 *   • DEFAULTS reproduce today's site exactly, so missing or invalid values change nothing.
 *   • parse*() never throws: each field is validated on its own and falls back to its
 *     default, so one bad value can't break the others.
 *
 * Status: appearance.defaultTheme and appearance.allowThemeToggle are used by the public
 * site (src/config/appearanceRuntime.ts) and editable in the admin. Everything else here
 * (typography, font scale, spacing, all background settings) is not wired into the visuals
 * yet and is shown read-only in the admin.
 */

// ---------------------------------------------------------------------------- ids

export const THEMES = ['dark', 'light'] as const
export const PALETTES = ['cosmic-night', 'cosmic-dawn'] as const
export const TYPE_PRESETS = ['editorial', 'compact'] as const
export const SPACING_PRESETS = ['spacious', 'balanced', 'compact'] as const
export const BACKGROUND_PRESETS = ['cosmic', 'calm', 'minimal'] as const

type OneOf<T extends readonly string[]> = T[number]

// ---------------------------------------------------------------------------- shapes

export interface AppearanceSettings {
  version: 1
  /** Theme a visit opens in (today: always dark). */
  defaultTheme: OneOf<typeof THEMES>
  /** Whether visitors see the theme toggle. */
  allowThemeToggle: boolean
  palette: { dark: 'cosmic-night'; light: 'cosmic-dawn' }
  typography: OneOf<typeof TYPE_PRESETS>
  /** Multiplier on the existing type scale, 0.85–1.15. */
  fontScale: number
  spacing: OneOf<typeof SPACING_PRESETS>
}

export interface BackgroundSettings {
  version: 1
  preset: OneOf<typeof BACKGROUND_PRESETS>
  water: { enabled: boolean; intensity: number; movement: number }
  clouds: { enabled: boolean; density: number; movement: number }
  particles: { enabled: boolean; density: number }
  planets: { enabled: boolean }
  stars: { enabled: boolean; brightness: number }
}

// ---------------------------------------------------------------------------- defaults

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  version: 1,
  defaultTheme: 'dark',
  allowThemeToggle: true,
  palette: { dark: 'cosmic-night', light: 'cosmic-dawn' },
  typography: 'editorial',
  fontScale: 1,
  spacing: 'spacious',
}

export const DEFAULT_BACKGROUNDS: BackgroundSettings = {
  version: 1,
  preset: 'cosmic',
  water: { enabled: true, intensity: 1, movement: 1 },
  clouds: { enabled: true, density: 1, movement: 1 },
  particles: { enabled: true, density: 1 },
  planets: { enabled: true },
  stars: { enabled: true, brightness: 1 },
}

// ---------------------------------------------------------------------------- validation

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
const num = (v: unknown, d: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d
const pick = <T extends readonly string[]>(v: unknown, allowed: T, d: T[number]): T[number] =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T[number]) : d

export function parseAppearance(input: unknown): AppearanceSettings {
  const v = obj(input)
  const d = DEFAULT_APPEARANCE
  return {
    version: 1,
    defaultTheme: pick(v.defaultTheme, THEMES, d.defaultTheme),
    allowThemeToggle: bool(v.allowThemeToggle, d.allowThemeToggle),
    palette: d.palette, // one palette per theme exists today; kept for future presets
    typography: pick(v.typography, TYPE_PRESETS, d.typography),
    fontScale: num(v.fontScale, d.fontScale, 0.85, 1.15),
    spacing: pick(v.spacing, SPACING_PRESETS, d.spacing),
  }
}

export function parseBackgrounds(input: unknown): BackgroundSettings {
  const v = obj(input)
  const d = DEFAULT_BACKGROUNDS
  const w = obj(v.water)
  const c = obj(v.clouds)
  const p = obj(v.particles)
  const s = obj(v.stars)
  return {
    version: 1,
    preset: pick(v.preset, BACKGROUND_PRESETS, d.preset),
    water: { enabled: bool(w.enabled, true), intensity: num(w.intensity, 1, 0, 1.5), movement: num(w.movement, 1, 0, 1.5) },
    clouds: { enabled: bool(c.enabled, true), density: num(c.density, 1, 0, 1.5), movement: num(c.movement, 1, 0, 1.5) },
    particles: { enabled: bool(p.enabled, true), density: num(p.density, 1, 0.25, 1) },
    planets: { enabled: bool(obj(v.planets).enabled, true) },
    stars: { enabled: bool(s.enabled, true), brightness: num(s.brightness, 1, 0, 1.5) },
  }
}
