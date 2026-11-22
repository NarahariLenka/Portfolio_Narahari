/**
 * Theme switch as an organic, marbled ink displacement.
 *
 * How it works (View Transitions API):
 *   • The browser freezes the OUTGOING theme as a snapshot and shows the INCOMING theme live.
 *   • A "flow field" image is prepared in a Web Worker ahead of time (clicks start instantly).
 *     Each pixel holds when the ink reaches it:
 *       field = distance from the toggle (half radial, half a straight sweeping front)
 *               + large bulges + chunky marbled ink + a spiky splash crown at the toggle
 *     The ink chunks are domain-warped noise sampled around the toggle and stretched in the
 *     direction of travel: a splash bursts out of the toggle, then a ragged front with
 *     islands and lakes sweeps across the screen, and the last islands dissolve at the end.
 *   • An SVG mask thresholds that field: the incoming theme is visible wherever
 *     field < level. Each frame only `level` changes (one attribute), so the ink keeps
 *     spreading into the veins — fibres appear, split and merge — while the main mass
 *     travels from the toggle across the screen.
 *   • `level` ends above every value in the field, so the incoming theme always covers
 *     the whole viewport. Then the temporary mask is removed.
 *
 * Settings: registered in the Animation Registry as `themeInkTransition`; defaults and
 * ranges live in ./themeInkSettings.ts. They are read without React (getAnimationSettings)
 * when a pattern is prepared and when the toggle is clicked. A prepared pattern is only
 * used if it was made with the current settings, viewport and toggle position.
 *
 * Both surfaces are the real themes (nothing is painted on top).
 * Fallbacks: no View Transitions, switched off, or an error → the existing page-wide colour
 * fade. Reduced motion → a 150 ms crossfade (or an instant switch if set to "off").
 * The field is built in a Web Worker (no WebGL).
 */
import { flushSync } from 'react-dom'
import { getAnimationSettings, reportAnimationError, subscribeAnimationConfig } from '../animations'
import type { ThemeName } from '../config/themes'
import { getTheme, setTheme } from '../theme/themeStore'
import type { FieldRequest, FieldResult } from './flowField.worker'
import { chooseInkMode, FIELD_RESOLUTION, inkEasing, inkMath, inkSeed, inkSettingsFrom, THEME_INK_ID, type InkSettings, type InkTransitionMode } from './themeInkSettings'
import './themeTransition.css'

/** Length of the existing colour fade (themeStore), during which clicks are ignored. */
const FADE_MS = 700

// ---------------------------------------------------------------------------- settings

interface Current {
  mode: InkTransitionMode
  ink: InkSettings
}

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
const hasViewTransitions = () => typeof (document as VTDocument).startViewTransition === 'function'

/** Current mode + settings. Never throws: unreadable settings → the colour fade. */
function current(): Current {
  const prefersReduced = prefersReducedMotion()
  try {
    const resolved = getAnimationSettings(THEME_INK_ID, { prefersReduced })
    return { mode: chooseInkMode({ viewTransitions: hasViewTransitions(), prefersReduced, resolved }), ink: inkSettingsFrom(resolved.params) }
  } catch (error) {
    reportAnimationError(THEME_INK_ID, error)
    return { mode: chooseInkMode({ viewTransitions: hasViewTransitions(), prefersReduced, resolved: null }), ink: inkSettingsFrom({}) }
  }
}

// ---------------------------------------------------------------------------- flow field

interface Field {
  url: string
  /** Smallest / largest stored value actually present (0–1), so the sweep uses its full time. */
  min: number
  max: number
  width: number // viewport size it was made for
  height: number
  ox: number
  oy: number
  /** InkSettings.key it was made with. */
  key: string
}

/** Pixels → PNG blob URL (main-thread path, used only when the worker can't encode). */
async function pixelsToUrl(pixels: Uint8ClampedArray, fw: number, fh: number) {
  const canvas = document.createElement('canvas')
  canvas.width = fw
  canvas.height = fh
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.putImageData(new ImageData(new Uint8ClampedArray(pixels), fw, fh), 0, 0)
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  return blob ? URL.createObjectURL(blob) : null
}

/**
 * Builds the flow field in a Web Worker (plain JS noise, never on the main thread, and no
 * WebGL shader compilation — which can block a page for seconds on some GPU drivers).
 * Without worker support it is computed on the main thread at a lower resolution.
 */
async function renderField(w: number, h: number, ox: number, oy: number, seed: number, ink: InkSettings) {
  const request: FieldRequest = { w, h, ox, oy, seed, resolution: FIELD_RESOLUTION, params: { ...ink.field } }
  try {
    const worker = new Worker(new URL('./flowField.worker.ts', import.meta.url), { type: 'module' })
    try {
      const result = await new Promise<FieldResult>((resolve, reject) => {
        // Generous: the page itself may be busy (e.g. WebGL scenes compiling on first load).
        const timer = window.setTimeout(() => reject(new Error('flow field timed out')), 30000)
        worker.onmessage = (e: MessageEvent<FieldResult>) => {
          window.clearTimeout(timer)
          resolve(e.data)
        }
        worker.onerror = (e) => {
          window.clearTimeout(timer)
          reject(e)
        }
        worker.postMessage(request)
      })
      const url = result.blob
        ? URL.createObjectURL(result.blob)
        : result.pixels
          ? await pixelsToUrl(new Uint8ClampedArray(result.pixels), result.fw, result.fh)
          : null
      return url ? { url, min: result.min, max: result.max } : null
    } finally {
      worker.terminate()
    }
  } catch (error) {
    console.warn('[theme] flow-field worker unavailable, computing on the main thread', error)
    const { buildField } = await import('./flowField.worker')
    const r = buildField({ ...request, resolution: 0.2 })
    const url = await pixelsToUrl(r.pixels, r.fw, r.fh)
    return url ? { url, min: r.min, max: r.max } : null
  }
}

/** Centre of the theme toggle (falls back near the top-right corner). */
function toggleOrigin() {
  const r = document.querySelector('.theme-toggle')?.getBoundingClientRect()
  if (r && r.width > 0 && r.height > 0) return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  return { x: window.innerWidth - 40, y: 40 }
}

// ---------------------------------------------------------------------------- mask

const SVG_NS = 'http://www.w3.org/2000/svg'

interface Prepared extends Field {
  svg: SVGSVGElement
  warm: HTMLElement
  /** Mask slope in stored (normalised) field units. */
  slope: number
  toStored: (raw: number) => number
  setLevel: (v: number) => void
}

/**
 * The SVG mask (threshold filter over the field image), built ahead of time together with
 * a 1 px invisible element that uses it — so Chrome has decoded the image and set up the
 * filter before the first click, and the first transition starts as smoothly as later ones.
 */
function buildMask(field: Field, ink: InkSettings): Prepared {
  const { width: w, height: h } = field
  const { slope, toStored } = inkMath(ink)
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none'
  // Regions are absolute: percentages would resolve against this 0×0 SVG.
  svg.innerHTML =
    '<defs>' +
    `<filter id="theme-flow-threshold" filterUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" color-interpolation-filters="sRGB">` +
    '<feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  1 0 0 0 0"/>' +
    `<feComponentTransfer><feFuncA type="linear" slope="${-slope}" intercept="${(-slope).toFixed(3)}"/></feComponentTransfer>` +
    '</filter>' +
    `<mask id="theme-flow-mask" maskUnits="userSpaceOnUse" maskContentUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}" style="mask-type:alpha">` +
    `<image x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" filter="url(#theme-flow-threshold)"/>` +
    '</mask>' +
    '</defs>'
  svg.querySelector('image')!.setAttribute('href', field.url)
  const level = svg.querySelector('feFuncA')!
  const warm = document.createElement('div')
  warm.setAttribute('aria-hidden', 'true')
  warm.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;pointer-events:none;mask:url(#theme-flow-mask)'
  document.body.append(svg, warm)
  return { ...field, svg, warm, slope, toStored, setLevel: (v: number) => level.setAttribute('intercept', (v * slope).toFixed(3)) }
}

function dispose(p: Prepared | null) {
  if (!p) return
  p.svg.remove()
  p.warm.remove()
  URL.revokeObjectURL(p.url)
}

// ---------------------------------------------------------------------------- preparation

let runs = 0
let busy = false
let prepared: Prepared | null = null
let preparing: { key: string; promise: Promise<Prepared | null> } | null = null

async function buildPrepared(ink: InkSettings): Promise<Prepared | null> {
  const w = window.innerWidth
  const h = window.innerHeight
  const { x: ox, y: oy } = toggleOrigin()
  const made = await renderField(w, h, ox, oy, inkSeed(runs, ink.fixedPattern), ink)
  const next = made ? buildMask({ ...made, width: w, height: h, ox, oy, key: ink.key }, ink) : null
  dispose(prepared)
  prepared = next
  return next
}

/**
 * Builds the next flow field + mask for the current viewport, toggle position and
 * settings. A preparation already running for the same settings is reused; one for
 * different settings is allowed to finish first, then a new one starts. Rejects on error
 * (and never leaves a failed preparation cached).
 */
function prepareField(ink: InkSettings): Promise<Prepared | null> {
  if (preparing?.key === ink.key) return preparing.promise
  const previous = preparing?.promise.catch(() => null) ?? Promise.resolve(null)
  const entry = { key: ink.key, promise: previous.then(() => buildPrepared(ink)) }
  preparing = entry
  const clear = () => {
    if (preparing === entry) preparing = null
  }
  entry.promise.then(clear, clear)
  return entry.promise
}

const fieldMatches = (f: Field | null, ink: InkSettings): f is Prepared => {
  if (!f) return false
  const o = toggleOrigin()
  return f.key === ink.key && f.width === window.innerWidth && f.height === window.innerHeight && Math.abs(f.ox - o.x) < 2 && Math.abs(f.oy - o.y) < 2
}

/** Prepares a pattern ahead of time if the next click would use one (errors are reported). */
function prepareAhead() {
  if (busy) return
  const { mode, ink } = current()
  if (mode !== 'ink') {
    // Ink not in use (switched off, other device, reduced motion…): free the old pattern.
    dispose(prepared)
    prepared = null
    return
  }
  if (fieldMatches(prepared, ink)) return
  prepareField(ink).catch((error) => reportAnimationError(THEME_INK_ID, error))
}

// Prepare the first field once the page is idle; re-prepare after resizes and when the
// settings are replaced (e.g. a future admin preview).
if (typeof window !== 'undefined') {
  const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 4000 }) : globalThis.setTimeout(cb, 1500))
  idle(prepareAhead)
  let resizeTimer = 0
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(prepareAhead, 400)
  })
  subscribeAnimationConfig(prepareAhead)
}

// ---------------------------------------------------------------------------- transition

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void>; finished: Promise<void> } }

/** The existing page-wide colour fade; clicks are ignored while it runs. */
function colourFade(next: ThemeName) {
  busy = true
  setTheme(next, { fade: true })
  window.setTimeout(() => (busy = false), FADE_MS)
}

/**
 * Switches the theme with the ink transition. Clicks during a running transition are
 * ignored, so animations never overlap. Any error falls back to the colour fade.
 */
export async function transitionToTheme(next: ThemeName) {
  if (busy || next === getTheme()) return
  const doc = document as VTDocument
  const root = document.documentElement
  const { mode, ink } = current()

  if (mode === 'fade') return colourFade(next)
  if (mode === 'instant') return setTheme(next, { fade: false })

  // Reduced motion: a short, plain crossfade.
  if (mode === 'crossfade') {
    busy = true
    try {
      root.classList.add('theme-vt-fade')
      const vt = doc.startViewTransition!(() => flushSync(() => setTheme(next, { fade: false, snapScenes: true })))
      vt.finished
        .finally(() => {
          root.classList.remove('theme-vt-fade')
          busy = false
          if (getTheme() !== next) fail(next, new Error('theme was not applied during the transition'))
        })
        .catch(() => {}) // handled above via the theme check
    } catch (error) {
      root.classList.remove('theme-vt-fade')
      busy = false
      fail(next, error)
    }
    return
  }

  busy = true
  let field: Prepared | null = null
  try {
    field = fieldMatches(prepared, ink) ? prepared : await prepareField(ink)
    if (!fieldMatches(field, ink)) {
      // No usable field (e.g. resized or settings changed mid-preparation): plain switch
      // with the existing fade. Not an error.
      field = null
      busy = false
      colourFade(next)
      return
    }
    prepared = null // consumed; a new one is prepared after this transition
    runs++
    const { setLevel, slope, toStored } = field
    setLevel(-1) // nothing of the new theme before the first frame
    root.style.setProperty('--theme-flow-duration', `${ink.durationMs}ms`)
    root.classList.add('theme-vt-flow')

    // Level starts just before the toggle (raw 0) and ends above the largest stored value
    // (+ the soft edge) → the incoming theme always covers the whole viewport.
    // (Any values below the toggle's own are tiny far-off droplets; they simply appear first.)
    const begin = toStored(0) - 0.004
    const end = field.max + 1.5 / slope
    let raf = 0
    let start = 0
    const frame = (now: number) => {
      if (!start) start = now
      const t = Math.min(1, (now - start) / ink.durationMs)
      setLevel(begin + (end - begin) * inkEasing(t, ink.openingSplash))
      if (t < 1) raf = requestAnimationFrame(frame)
    }

    const used = field
    const vt = doc.startViewTransition!(() => flushSync(() => setTheme(next, { fade: false, snapScenes: true })))
    vt.ready.then(() => (raf = requestAnimationFrame(frame))).catch(() => {})
    vt.finished
      .finally(() => {
        cancelAnimationFrame(raf)
        root.classList.remove('theme-vt-flow')
        root.style.removeProperty('--theme-flow-duration')
        dispose(used)
        busy = false
        // The theme change itself failed inside the transition: switch with the fade.
        if (getTheme() !== next) fail(next, new Error('theme was not applied during the transition'))
        else prepareAhead() // ready for the next click
      })
      .catch(() => {}) // handled above via the theme check
  } catch (error) {
    root.classList.remove('theme-vt-flow')
    root.style.removeProperty('--theme-flow-duration')
    if (field && field !== prepared) dispose(field)
    busy = false
    fail(next, error)
  }
}

/**
 * Error fallback: the effect is switched off for the rest of the visit (registry rule) and
 * this and later switches use the colour fade.
 */
function fail(next: ThemeName, error: unknown) {
  reportAnimationError(THEME_INK_ID, error)
  if (getTheme() !== next && !busy) colourFade(next)
}
