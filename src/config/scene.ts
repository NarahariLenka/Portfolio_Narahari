/** Tunables for the cosmic background. Positions are screen UV (0,0 = bottom-left). */

export type PlanetKind = 'rocky' | 'ringed' | 'banded' | 'crescent'

export const planetKindIndex: Record<PlanetKind, number> = {
  rocky: 0,
  ringed: 1,
  banded: 2,
  crescent: 3,
}

export interface Planet {
  x: number
  /** Screen v before scrolling; below 0 means it rises into view later. */
  y: number
  /** Radius in CSS px. */
  radius: number
  kind: PlanetKind
  /** Screen heights risen per viewport scrolled (bigger = nearer). */
  speed: number
  /** Ring tilt in radians (ringed only). */
  tilt?: number
  /** 0 = violet, 1 = cool blue. */
  tint?: number
  /** Shown in the dark theme only. */
  darkOnly?: boolean
}

export interface SceneQuality {
  /** Sky height share: horizon sits at this screen-v from the bottom. */
  horizon: number
  starLayers: 2 | 3
  /** 0 = low (mobile / weak GPUs), 1 = full wave detail. */
  waveQuality: 0 | 1
  maxRipples: number
  /** Ripple size on the water plane; smaller on narrow screens. */
  rippleScale: number
  maxDpr: number
  planets: Planet[]
}

export const desktopScene: SceneQuality = {
  horizon: 0.33,
  starLayers: 3,
  waveQuality: 1,
  maxRipples: 16,
  rippleScale: 1,
  maxDpr: 1.5,
  planets: [
    // Hero sky
    { x: 0.14, y: 0.79, radius: 14, kind: 'rocky', speed: 0.12 },
    { x: 0.9, y: 0.72, radius: 11, kind: 'ringed', speed: 0.17, tilt: -0.1 },
    { x: 0.63, y: 0.93, radius: 3.5, kind: 'rocky', speed: 0.06 },
    // Rising in as the page descends
    { x: 0.84, y: -0.2, radius: 30, kind: 'banded', speed: 0.2, tint: 0.2 },
    { x: 0.22, y: -0.7, radius: 10, kind: 'crescent', speed: 0.15 },
    { x: 0.7, y: -1.15, radius: 5, kind: 'rocky', speed: 0.21, tint: 1 },
    { x: 0.1, y: -1.75, radius: 16, kind: 'ringed', speed: 0.26, tilt: 0.32, tint: 0.5 },
    { x: 0.4, y: -1.3, radius: 2.5, kind: 'rocky', speed: 0.12 },
    // Night-only feature planet: a little larger, high and away from the Hero's travel path.
    { x: 0.42, y: 0.935, radius: 20, kind: 'banded', speed: 0.14, tint: 0.35, darkOnly: true },
  ],
}

export const mobileScene: SceneQuality = {
  horizon: 0.36,
  starLayers: 2,
  waveQuality: 0,
  maxRipples: 8,
  rippleScale: 0.6,
  maxDpr: 1,
  planets: [
    { x: 0.16, y: 0.86, radius: 9, kind: 'rocky', speed: 0.12 },
    { x: 0.84, y: 0.74, radius: 8, kind: 'ringed', speed: 0.17, tilt: -0.1 },
    { x: 0.82, y: -0.3, radius: 18, kind: 'banded', speed: 0.2, tint: 0.2 },
    { x: 0.2, y: -0.75, radius: 7, kind: 'crescent', speed: 0.15 },
    { x: 0.12, y: -1.6, radius: 10, kind: 'ringed', speed: 0.24, tilt: 0.32, tint: 0.5 },
  ],
}

export const interaction = {
  /** Higher = cursor disturbance catches up faster (per second). */
  pointerFollow: 3.2,
  moveRippleInterval: 0.09,
  /** Reduced motion keeps the water alive but nearly still. */
  reducedTimeScale: 0.12,
  introSeconds: 2.4,
  /** Viewports of descent over which the water drains below the frame. */
  drainViewports: 1.6,
} as const

/** Skills particle budgets: one Points draw call, sized per device. */
export const skillsBudget = {
  desktop: { column: 9000, pool: 3500, spiral: 5000, pathways: 1800, dpr: 1.5, cameraZ: 9, cameraY: 0.4 },
  lowPower: { column: 5000, pool: 2000, spiral: 3000, pathways: 1100, dpr: 1, cameraZ: 9, cameraY: 0.4 },
  mobile: { column: 3200, pool: 1200, spiral: 2000, pathways: 700, dpr: 1.25, cameraZ: 12.5, cameraY: 0.3 },
} as const
