/**
 * Builds the theme-transition flow field off the main thread (see themeTransition.ts).
 * Plain JavaScript noise: no WebGL, so no shader compilation (which can block a page for
 * seconds on some GPUs/drivers) and nothing ever runs on the page's main thread.
 *
 * Input:  viewport size, toggle position, seed, look parameters, resolution.
 * Output: a grey-scale PNG blob (stored field 0–1) + the actual min/max stored values.
 */

interface Params {
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

export interface FieldRequest {
  w: number
  h: number
  ox: number
  oy: number
  seed: number
  resolution: number
  params: Params
}

export interface FieldResult {
  blob?: Blob
  pixels?: ArrayBuffer
  fw: number
  fh: number
  min: number
  max: number
}

/** Seeded 2-D simplex noise (≈ −1…1). */
function createNoise(seed: number) {
  let s = seed >>> 0 || 1
  const rand = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const gx = [1, -1, 1, -1, 1, -1, 0, 0]
  const gy = [1, 1, -1, -1, 0, 0, 1, -1]
  const F2 = 0.5 * (Math.sqrt(3) - 1)
  const G2 = (3 - Math.sqrt(3)) / 6
  return (x: number, y: number) => {
    const t = (x + y) * F2
    const i = Math.floor(x + t)
    const j = Math.floor(y + t)
    const t0 = (i + j) * G2
    const x0 = x - (i - t0)
    const y0 = y - (j - t0)
    const i1 = x0 > y0 ? 1 : 0
    const j1 = 1 - i1
    const x1 = x0 - i1 + G2
    const y1 = y0 - j1 + G2
    const x2 = x0 - 1 + 2 * G2
    const y2 = y0 - 1 + 2 * G2
    const ii = i & 255
    const jj = j & 255
    let n = 0
    let c = 0.5 - x0 * x0 - y0 * y0
    if (c > 0) {
      const g = perm[ii + perm[jj]] & 7
      c *= c
      n += c * c * (gx[g] * x0 + gy[g] * y0)
    }
    c = 0.5 - x1 * x1 - y1 * y1
    if (c > 0) {
      const g = perm[ii + i1 + perm[jj + j1]] & 7
      c *= c
      n += c * c * (gx[g] * x1 + gy[g] * y1)
    }
    c = 0.5 - x2 * x2 - y2 * y2
    if (c > 0) {
      const g = perm[ii + 1 + perm[jj + 1]] & 7
      c *= c
      n += c * c * (gx[g] * x2 + gy[g] * y2)
    }
    return 70 * n
  }
}

export function buildField({ w, h, ox, oy, seed, resolution, params: P }: FieldRequest) {
  const fw = Math.max(64, Math.round(w * resolution))
  const fh = Math.max(64, Math.round(h * resolution))
  const k = fw / w
  const n = createNoise(seed)
  const fbm = (x: number, y: number, octaves: number) => {
    let v = 0
    let a = 0.5
    for (let o = 0; o < octaves; o++) {
      v += a * n(x, y)
      x = x * 2.03 + 17.1
      y = y * 2.03 + 9.7
      a *= 0.5
    }
    return v
  }
  const spread = P.lobes + P.marbleMix + P.spikes
  const cx = ox * k
  const cy = oy * k
  const corners = [
    [0, 0],
    [fw, 0],
    [0, fh],
    [fw, fh],
  ]
  const dmax = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)))
  // Travel direction: from the toggle towards the screen centre. Angles are measured from
  // it, so the wrap-around seam points away from the screen (behind the toggle).
  let tx = fw / 2 - cx
  let ty = fh / 2 - cy
  const tl = Math.hypot(tx, ty) || 1
  tx /= tl
  ty /= tl
  // Distance along the travel direction (a straight sweeping front), normalised to 0–1.
  const proj = corners.map(([x, y]) => (x - cx) * tx + (y - cy) * ty)
  const pmin = Math.min(0, ...proj)
  const prange = Math.max(...proj) - pmin || 1
  const big = Math.max(fw, fh)
  const off = (seed % 997) * 0.137
  const out = new Uint8ClampedArray(fw * fh * 4)
  let min = 255
  let max = 0
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      const rx = x - cx
      const ry = y - cy
      const dr = Math.hypot(rx, ry) / dmax
      const dp = (rx * tx + ry * ty - pmin) / prange
      // Circular splash near the toggle, turning into a mostly straight front further out.
      const d = dr + (Math.max(dr * 0.6, dp) - dr) * P.planar * Math.min(1, dr / 0.25)
      const ang = Math.atan2(tx * ry - ty * rx, tx * rx + ty * ry)
      // Large, slow bulges / fjords of the ink mass.
      const lx = (x / big) * P.lobeScale + off * 0.37
      const ly = (y / big) * P.lobeScale + off * 0.37
      const lobe = fbm(lx, ly, 2)
      // Polar coordinates, slow along the radius → ink streaks in the direction of travel;
      // domain warping → chunky, marbled islands and lakes.
      const sx = (dr * P.marbleScale) / P.radialStretch + off
      const sy = ang * (0.15 + dr) * P.marbleScale + off
      const qx = fbm(sx, sy, 3)
      const qy = fbm(sx + 5.2, sy + 1.3, 3)
      const m = fbm(sx + P.marbleWarp * qx, sy + P.marbleWarp * qy, 3)
      // Spiky crown of the first splash, fading out away from the toggle.
      const spike = n(ang * P.spikeFreq + off, dr * 3 + off) * Math.exp(-dr / P.spikeReach)
      const rt = Math.min(1, dr / P.calm)
      const ramp = rt * rt * (3 - 2 * rt) // clean splash right at the toggle
      // Nothing appears before the main front is 75% of the way there, so the ink visibly
      // starts at the toggle and travels outward.
      const raw = Math.max(dr * 0.75, d + ramp * (P.lobes * lobe + P.marbleMix * m) + P.spikes * spike)
      const v = Math.round(Math.min(1, Math.max(0, (raw + spread) / (1 + 2 * spread))) * 255)
      if (v < min) min = v
      if (v > max) max = v
      const i = (y * fw + x) * 4
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = 255
    }
  }
  return { pixels: out, fw, fh, min: min / 255, max: max / 255 }
}

// Worker entry (ignored when this module is imported for tests).
const scope = globalThis as unknown as {
  onmessage: ((e: MessageEvent<FieldRequest>) => void) | null
  postMessage: (msg: FieldResult, transfer?: Transferable[]) => void
}
if ('WorkerGlobalScope' in globalThis) {
  scope.onmessage = async (e) => {
    const { pixels, fw, fh, min, max } = buildField(e.data)
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(fw, fh)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.putImageData(new ImageData(pixels, fw, fh), 0, 0)
        const blob = await canvas.convertToBlob({ type: 'image/png' })
        scope.postMessage({ blob, fw, fh, min, max })
        return
      }
    }
    scope.postMessage({ pixels: pixels.buffer as ArrayBuffer, fw, fh, min, max }, [pixels.buffer as ArrayBuffer])
  }
}
