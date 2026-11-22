/** TEMPLATE parameter schema — shared by definition.ts and Component.tsx. */
import type { ParamSchema } from '../../types'

export const params = {
  speed: { kind: 'number', label: 'Speed', min: 0.1, max: 3, step: 0.1, default: 1, scale: 'speed' },
  intensity: { kind: 'number', label: 'Intensity', min: 0, max: 1, step: 0.05, default: 0.6, scale: 'intensity' },
  density: { kind: 'number', label: 'Density', min: 10, max: 400, step: 10, default: 120, scale: 'density' },
  duration: { kind: 'number', label: 'Duration', min: 0.5, max: 10, step: 0.5, default: 3, unit: 's', scale: 'duration' },
  style: { kind: 'choice', label: 'Style', options: ['soft', 'sharp'], default: 'soft' },
} satisfies ParamSchema
