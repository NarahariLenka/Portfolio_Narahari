/**
 * Theme tokens. Dark is the original cosmic-night look; Light is cosmic dawn.
 * `css` becomes CSS custom properties on <html>; `scene` feeds the WebGL shaders.
 * Triplets ("r g b") are used as rgb(var(--token) / alpha) so alphas stay in the CSS.
 */
export type ThemeName = 'dark' | 'light'

export interface Theme {
  css: Record<string, string>
  /** Contact DotField (drawn on a canvas, so plain colour strings). */
  dots: { from: string; to: string; glow: string }
}

export const darkTheme: Theme = {
  css: {
    '--bg': '#05050b',
    '--heading': '#f1edff',
    '--ink': '221 214 254',
    '--accent': '#a78bfa',
    '--accent-rgb': '167 139 250',
    '--accent-hi': '196 181 253',
    '--accent-ink': '#ddd6fe',
    '--scrim': '5 5 11',
    '--surface': '8 8 18',
    '--glow': '75 42 115',
    '--card-shadow': 'none',
    // Tailwind theme colours used across the CSS.
    '--color-night': '#05050b',
    '--color-lavender': '#a78bfa',
    '--color-lavender-soft': '#ddd6fe',
    // Contact sling button.
    '--sling-pad': '#16132b',
    '--sling-icon': '#ddd6fe',
    '--sling-accent': '#a78bfa',
    '--sling-well': 'rgba(10, 9, 22, 0.75)',
    '--sling-band': '#4b3f7a',
  },
  dots: { from: 'rgba(167, 139, 250, 0.6)', to: 'rgba(221, 214, 254, 0.35)', glow: '#120F17' },
}

export const lightTheme: Theme = {
  css: {
    '--bg': '#F3F5FA',
    '--heading': '#171827',
    '--ink': '38 42 72',
    '--accent': '#4A3D96',
    '--accent-rgb': '74 61 150',
    '--accent-hi': '139 124 200',
    '--accent-ink': '#2E2A4F',
    '--scrim': '238 241 247',
    '--surface': '255 255 255',
    '--glow': '183 174 220',
    '--card-shadow': '0 18px 44px rgb(79 85 104 / 0.12)',
    '--color-night': '#F3F5FA',
    '--color-lavender': '#3F3488', // labels/indices: deep violet so they read on the blue sky
    '--color-lavender-soft': '#2E2A4F',
    '--sling-pad': '#FFFFFF',
    '--sling-icon': '#2E2A4F',
    '--sling-accent': '#8B7CC8',
    '--sling-well': 'rgba(183, 174, 220, 0.45)',
    '--sling-band': '#B7AEDC',
  },
  // Dark navy dots so the grid reads on the blue dawn sky.
  dots: { from: 'rgba(20, 21, 43, 0.6)', to: 'rgba(40, 32, 96, 0.55)', glow: '#FFFFFF' },
}

/**
 * Light-mode palette for the WebGL environment and Skills particles (dawn).
 * Dark-mode scene colours remain the original shader constants.
 */
export const lightScene = {
  // Dawn sky grade: cool blue top → blue/lavender middle → warm cream horizon.
  skyTop: '#7188BC',
  skyHigh: '#8FA5D0',
  skyPale: '#A9B5D9',
  lavender: '#C0B9D7',
  cream: '#FFFDD0',
  blush: '#F4C2C2',
  glow: '#FFF8DC',
  bg: '#F3F5FA',
  // Clouds: near-white bodies, cool lavender-blue shadows, a faint warm edge.
  cloudShade: '#D9D6E8',
  cloudBody: '#F4F2F2',
  cloudLit: '#FFFDF8',
  cloudWarm: '#F1D8D0',
  // Planets: muted blue / soft lavender with a warm rim.
  planetDark: '#6C77B8',
  planetLit: '#CDCBEE',
  planetRing: '#D7C8EE',
  planetRim: '#FFC7B0',
  // Water: deeper cool blue toward the viewer.
  waterNear: '#91A6CF',
  waterMid: '#A7B4D3',
  waterFar: '#BBC3DD',
  waterGlint: '#FFFDD0',
  // Skills helix: terracotta → blush → cream → lavender, sparse mustard/taupe/sage motes.
  terracotta: '#C86B45',
  mustard: '#E3A827',
  warmCream: '#FFFDD0',
  taupe: '#B3A99F',
  blushPink: '#F4C2C2',
  sage: '#9CAF88',
  lavenderSoft: '#8B7CC8',
  helixDeep: '#9C8DE0',
  helixCore: '#ECE7FF',
  strandWarm: '#F5AE9B',
  strandLight: '#FFF3E8',
  strandPink: '#D9A7E3',
} as const

export const themes: Record<ThemeName, Theme> = { dark: darkTheme, light: lightTheme }

/** '#rrggbb' → [r, g, b] in 0–1, raw (the canvases render without colour conversion). */
export const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
