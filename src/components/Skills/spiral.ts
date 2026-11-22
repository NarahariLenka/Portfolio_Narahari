/**
 * Shared geometry of the skill spiral. The particle shader (particles.vert.glsl)
 * mirrors these constants, so DOM skill labels ride exactly on the ribbon.
 */
export const COLUMN_BOTTOM = -2.4
export const COLUMN_TOP = 3.4
export const TURNS = 2.2
/** Spiral parameter (0 = bottom, 1 = top) where the active skill sits. */
export const ACTIVE_S = 0.42
/** Spiral distance between consecutive skills. */
export const SKILL_GAP = 0.12
/** Rotation that puts ACTIVE_S at the front of the spiral (facing the camera). */
export const PHASE = Math.PI / 2 - ACTIVE_S * TURNS * Math.PI * 2

export interface SpiralPoint {
  x: number
  y: number
  z: number
}

export function spiralPoint(s: number, out: SpiralPoint, radiusOffset = 0) {
  const a = s * TURNS * Math.PI * 2 + PHASE
  const r = 1.75 + (0.55 - 1.75) * s + radiusOffset
  out.x = Math.cos(a) * r
  out.y = COLUMN_BOTTOM + 0.3 + (COLUMN_TOP - 0.4 - (COLUMN_BOTTOM + 0.3)) * s
  out.z = Math.sin(a) * r
  return out
}
