import type { IUniform, Vector2, Vector3, Vector4 } from 'three'
import { interaction } from '../../../config/scene'

export interface SurfaceUniforms {
  uTime: IUniform<number>
  uHorizon: IUniform<number>
  uDescent: IUniform<number>
  uRes: IUniform<Vector2>
  uIntro: IUniform<number>
  uTheme: IUniform<number>
  uRipples: IUniform<Vector4[]>
  uPointer: IUniform<Vector3>
  uParallax: IUniform<Vector2>
}

/**
 * Drives the water/sky uniforms from pointer and touch input.
 * Lives outside React state: pointer movement never triggers a render.
 */
export class WaterSurface {
  private target = { x: 0.5, y: 0.5 }
  private lagged = { x: 0.5, y: 0.5 }
  private active = false
  private energy = 0
  private lastEmit = 0
  private rippleIndex = 0
  private time = 0
  private readonly uniforms: SurfaceUniforms
  private readonly baseHorizon: number
  private horizon: number
  private descentOrigin = Number.POSITIVE_INFINITY
  private descent = 0

  constructor(uniforms: SurfaceUniforms, horizon: number) {
    this.uniforms = uniforms
    this.baseHorizon = horizon
    this.horizon = horizon
  }

  /** Window listeners so UI layered on top later doesn't block the water. */
  attach() {
    const toUv = (e: PointerEvent) => {
      this.target.x = e.clientX / window.innerWidth
      this.target.y = 1 - e.clientY / window.innerHeight
    }
    const onMove = (e: PointerEvent) => {
      toUv(e)
      this.active = true
    }
    const onDown = (e: PointerEvent) => {
      toUv(e)
      this.active = true
      // Touch has no hover history: start the disturbance where the finger lands.
      if (e.pointerType !== 'mouse') {
        this.lagged.x = this.target.x
        this.lagged.y = this.target.y
      }
      // A splash: one strong ring followed by two softer echoes.
      const { x, y } = this.target
      this.emit(x, y, 1)
      this.emit(x, y, 0.55, 0.18)
      this.emit(x, y, 0.3, 0.38)
    }
    const onEnd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') this.active = false
    }
    const onLeave = () => {
      this.active = false
    }
    const root = document.documentElement

    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerdown', onDown, { passive: true })
    window.addEventListener('pointerup', onEnd, { passive: true })
    window.addEventListener('pointercancel', onEnd, { passive: true })
    root.addEventListener('pointerleave', onLeave)
    window.addEventListener('blur', onLeave)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onEnd)
      window.removeEventListener('pointercancel', onEnd)
      root.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('blur', onLeave)
    }
  }

  /** Scroll offset (px) where the descent begins: About entering the viewport. */
  setDescentOrigin(scrollY: number) {
    this.descentOrigin = scrollY
  }

  resize(width: number, height: number) {
    this.uniforms.uRes.value.set(width, height)
  }

  private emit(x: number, y: number, strength: number, delay = 0) {
    if (y > this.horizon - 0.004) return // only the water reacts
    const ripples = this.uniforms.uRipples.value
    ripples[this.rippleIndex].set(x, y, this.time + delay, strength)
    this.rippleIndex = (this.rippleIndex + 1) % ripples.length
  }

  private themeTarget = -1

  /** 0 = night, 1 = dawn. The first call snaps; later calls ease unless `snap` is set. */
  setTheme(value: number, snap = false) {
    if (this.themeTarget < 0 || snap) this.uniforms.uTheme.value = value
    this.themeTarget = value
  }

  update(delta: number, reducedMotion: boolean) {
    const dt = Math.min(delta, 0.1) // avoid jumps after tab switches
    const u = this.uniforms
    this.time += dt * (reducedMotion ? interaction.reducedTimeScale : 1)
    u.uTime.value = this.time
    u.uIntro.value = Math.min(u.uIntro.value + dt / interaction.introSeconds, 1)
    if (this.themeTarget >= 0) {
      const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 6) // ~0.6s crossfade
      u.uTheme.value += (this.themeTarget - u.uTheme.value) * k
      if (Math.abs(this.themeTarget - u.uTheme.value) < 0.002) u.uTheme.value = this.themeTarget
    }

    // Ease toward the scroll position so wheel steps don't jolt the environment.
    const target = Math.max(0, (window.scrollY - this.descentOrigin) / window.innerHeight)
    this.descent += (target - this.descent) * (reducedMotion ? 1 : 1 - Math.exp(-dt * 4))
    u.uDescent.value = this.descent
    const drain = Math.min(this.descent / interaction.drainViewports, 1)
    const eased = drain * drain * (3 - 2 * drain)
    this.horizon = this.baseHorizon - eased * (this.baseHorizon + 0.3)
    u.uHorizon.value = this.horizon

    if (reducedMotion) {
      this.energy = 0
      u.uPointer.value.z = 0
      u.uParallax.value.set(0, 0)
      return
    }

    // Lagged follow: the surface responds a beat after the cursor.
    const k = 1 - Math.exp(-dt * interaction.pointerFollow)
    const dx = (this.target.x - this.lagged.x) * k
    const dy = (this.target.y - this.lagged.y) * k
    this.lagged.x += dx
    this.lagged.y += dy

    const speed = Math.hypot(dx, dy) / Math.max(dt, 1e-3)
    const overWater = this.active && this.lagged.y < this.horizon
    const goal = overWater ? Math.min(speed * 1.8, 1) : 0
    // Rise quickly, settle slowly: the disturbance dissipates rather than stops.
    const rate = goal > this.energy ? 4 : 0.9
    this.energy += (goal - this.energy) * (1 - Math.exp(-dt * rate))

    if (this.energy > 0.06 && this.time - this.lastEmit > interaction.moveRippleInterval) {
      this.lastEmit = this.time
      this.emit(this.lagged.x, this.lagged.y, 0.06 + 0.2 * this.energy)
    }

    u.uPointer.value.set(this.lagged.x, this.lagged.y, this.energy)

    // Almost imperceptible depth drift; scroll can feed the same uniform later.
    const p = u.uParallax.value
    const pk = 1 - Math.exp(-dt * 0.8)
    p.x += (this.target.x - 0.5 - p.x) * pk
    p.y += (this.target.y - 0.5 - p.y) * pk
  }
}
