/**
 * Canvas shooting stars in the spirit of the "Your Name" comet: a white-hot head, a
 * thin cyan core and cyan → blue → violet → magenta bands that fan out along the tail,
 * shedding sparkles, sometimes trailed by a small warm fragment. The loop only runs
 * while something is in flight; the canvas is cleared and idle otherwise.
 */

type RGB = [number, number, number]

interface Palette {
  aura: RGB
  bands: RGB[]
  core: RGB
}

const COMET: Palette = {
  aura: [56, 120, 255],
  bands: [
    [64, 160, 255],
    [130, 92, 255],
    [214, 84, 255],
  ],
  core: [120, 232, 255],
}

const EMBER: Palette = {
  aura: [255, 140, 60],
  bands: [[255, 120, 64]],
  core: [255, 214, 150],
}

const SPARKLE_COLORS: RGB[] = [
  [255, 255, 255],
  [150, 236, 255],
  [190, 160, 255],
  [255, 150, 230],
]

/** Tail length in milliseconds of travel. */
const TRAIL_MS = 760
/** Seconds a comet lives; it slows and fades out well before the screen edge. */
const LIFE = 1.45
/** Velocity decay per second (drag) — the comet eases to a drift as it fades. */
const DRAG = 1.7
/** Fraction of life after which the comet begins to fade. */
const FADE_FROM = 0.35
const MAX_DPR = 2

interface Comet {
  x: number
  y: number
  vx: number
  vy: number
  /** Gentle curvature (rad/s) so the path arcs like the reference. */
  turn: number
  scale: number
  palette: Palette
  /** Side the colour bands fan towards (+1 / -1). */
  side: number
  delay: number
  age: number
  life: number
  headGone: number | null
  trail: { x: number; y: number; t: number }[]
}

interface Sparkle {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  color: RGB
}

const rgba = ([r, g, b]: RGB, a: number) => `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a)).toFixed(3)})`

export class ShootingStars {
  private readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  private comets: Comet[] = []
  private sparkles: Sparkle[] = []
  private raf = 0
  private last = 0
  private now = 0
  private width = 0
  private height = 0

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
  }

  /** Fire from (x, y) along the unit direction (dx, dy). power: 0–1. */
  launch(x: number, y: number, dx: number, dy: number, power = 0.5) {
    this.resize()
    // Scale travel to the screen so it always dissolves inside the viewport.
    const reach = Math.min(1, Math.hypot(window.innerWidth, window.innerHeight) / 1700)
    const speed = (1050 + 650 * power) * reach
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len
    const uy = dy / len
    const side = Math.random() < 0.5 ? -1 : 1
    this.comets.push(this.comet(x, y, ux, uy, speed, 1 + 0.25 * power, COMET, side, 0))
    // A small warm fragment breaking away at a slight angle, like the ember in the still.
    if (Math.random() < 0.75) {
      const a = (side * (6 + Math.random() * 6) * Math.PI) / 180
      const fx = ux * Math.cos(a) - uy * Math.sin(a)
      const fy = ux * Math.sin(a) + uy * Math.cos(a)
      this.comets.push(this.comet(x, y, fx, fy, speed * 0.78, 0.4, EMBER, side, 0.12))
    }
    if (!this.raf) {
      this.last = performance.now()
      this.raf = requestAnimationFrame(this.frame)
    }
  }

  dispose() {
    cancelAnimationFrame(this.raf)
    this.raf = 0
    this.comets = []
    this.sparkles = []
  }

  private comet(x: number, y: number, ux: number, uy: number, speed: number, scale: number, palette: Palette, side: number, delay: number): Comet {
    return {
      x,
      y,
      vx: ux * speed,
      vy: uy * speed,
      turn: side * (0.04 + Math.random() * 0.07),
      scale,
      palette,
      side,
      delay,
      age: 0,
      life: LIFE * (0.9 + Math.random() * 0.2) * (palette === EMBER ? 0.8 : 1),
      headGone: null,
      trail: [],
    }
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)
    const w = window.innerWidth
    const h = window.innerHeight
    if (w === this.width && h === this.height) return
    this.width = w
    this.height = h
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }

  private frame = (t: number) => {
    const dt = Math.min(0.05, (t - this.last) / 1000)
    this.last = t
    this.now = t
    this.update(dt)
    this.draw()
    if (this.comets.length || this.sparkles.length) {
      this.raf = requestAnimationFrame(this.frame)
    } else {
      this.raf = 0
      this.ctx.clearRect(0, 0, this.width, this.height)
    }
  }

  private update(dt: number) {
    const margin = 260
    for (const c of this.comets) {
      if (c.delay > 0) {
        c.delay -= dt
        continue
      }
      c.age += dt
      if (c.headGone === null && c.age >= c.life) c.headGone = this.now
      if (c.headGone === null) {
        // Ease off: drag slows the comet to a drift as it fades.
        const drag = Math.exp(-DRAG * dt)
        c.vx *= drag
        c.vy *= drag
        // Arc gently: rotate velocity by the comet's curvature.
        const a = c.turn * dt
        const vx = c.vx * Math.cos(a) - c.vy * Math.sin(a)
        c.vy = c.vx * Math.sin(a) + c.vy * Math.cos(a)
        c.vx = vx
        c.x += c.vx * dt
        c.y += c.vy * dt
        c.trail.push({ x: c.x, y: c.y, t: this.now })
        // Shed sparkles from the head.
        const n = Math.round((c.palette === COMET ? 6 : 1) * this.fade(c))
        for (let i = 0; i < n; i++) {
          this.sparkles.push({
            x: c.x + (Math.random() - 0.5) * 28 * c.scale,
            y: c.y + (Math.random() - 0.5) * 28 * c.scale,
            vx: -c.vx * 0.04 + (Math.random() - 0.5) * 60,
            vy: -c.vy * 0.04 + (Math.random() - 0.5) * 60,
            age: 0,
            life: 0.5 + Math.random() * 0.9,
            size: (0.5 + Math.random() * 1.4) * c.scale,
            color: SPARKLE_COLORS[(Math.random() * SPARKLE_COLORS.length) | 0],
          })
        }
        if (c.x < -margin || c.x > this.width + margin || c.y < -margin || c.y > this.height + margin) c.headGone = this.now
      }
      // Drop tail points older than the tail length.
      while (c.trail.length && this.now - c.trail[0].t > TRAIL_MS) c.trail.shift()
    }
    // Gone once fully faded (or its tail has emptied after leaving the screen).
    this.comets = this.comets.filter((c) => c.delay > 0 || (c.age < c.life && (c.headGone === null || c.trail.length > 1)))

    for (const s of this.sparkles) {
      s.age += dt
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vx *= 0.96
      s.vy *= 0.96
    }
    this.sparkles = this.sparkles.filter((s) => s.age < s.life)
  }

  private draw() {
    const ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.height)
    ctx.globalCompositeOperation = 'lighter'
    // Flat ends: overlapping round caps bead up under additive blending.
    ctx.lineCap = 'butt'

    for (const c of this.comets) {
      if (c.delay > 0 || c.trail.length < 2) continue
      // The whole comet — head, tail and colour — dissolves together.
      ctx.globalAlpha = this.fade(c)
      const s = c.scale
      const pts = c.trail
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]
        const b = pts[i]
        // f: 1 at the head, 0 at the end of the tail.
        const f = 1 - (this.now - b.t) / TRAIL_MS
        if (f <= 0) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const len = Math.hypot(dx, dy) || 1
        const nx = (-dy / len) * c.side
        const ny = (dx / len) * c.side
        // The tail widens and its colour bands fan apart with distance from the head.
        const away = 1 - f
        const spread = Math.pow(away, 0.75) * 70 * s
        const fan = (4 + 30 * away) * s

        // Soft blue aura around everything.
        this.segment(a, b, nx * spread * 0.4, ny * spread * 0.4, (10 + 46 * away) * s, rgba(c.palette.aura, 0.06 * f))
        // Colour bands: a broad soft wash plus a brighter line inside each.
        c.palette.bands.forEach((col, k) => {
          const off = spread * ((k + 1) / c.palette.bands.length)
          this.segment(a, b, nx * off, ny * off, fan, rgba(col, (0.16 - k * 0.02) * f))
          this.segment(a, b, nx * off, ny * off, (1.4 + 2.6 * f) * s, rgba(col, (0.5 - k * 0.08) * f))
        })
        // Cyan core and white-hot centre line.
        this.segment(a, b, 0, 0, (0.8 + 2.4 * f) * s, rgba(c.palette.core, 0.85 * f))
        this.segment(a, b, 0, 0, (0.4 + 1 * f) * s, `rgba(255,255,255,${(0.95 * f * f).toFixed(3)})`)
      }

      // Head glow.
      if (c.headGone === null) {
        const r = 20 * s
        const g = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r)
        g.addColorStop(0, 'rgba(255,255,255,0.95)')
        g.addColorStop(0.25, rgba(c.palette.core, 0.7))
        g.addColorStop(1, rgba(c.palette.aura, 0))
        ctx.fillStyle = g
        ctx.beginPath()
        ctx.arc(c.x, c.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.globalAlpha = 1
    for (const p of this.sparkles) {
      const k = 1 - p.age / p.life
      const twinkle = 0.6 + 0.4 * Math.sin(p.age * 30 + p.x)
      ctx.fillStyle = rgba(p.color, k * twinkle)
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  /** 1 while bright, easing to 0 across the second part of the comet's life. */
  private fade(c: Comet) {
    const t = Math.min(1, Math.max(0, (c.age / c.life - FADE_FROM) / (1 - FADE_FROM)))
    return 1 - t * t * (3 - 2 * t)
  }

  private segment(a: { x: number; y: number }, b: { x: number; y: number }, ox: number, oy: number, width: number, color: string) {
    const ctx = this.ctx
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(a.x + ox, a.y + oy)
    ctx.lineTo(b.x + ox, b.y + oy)
    ctx.stroke()
  }
}
