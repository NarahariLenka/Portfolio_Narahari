import { useEffect, useMemo, type RefObject } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  AdditiveBlending,
  NormalBlending,
  BufferAttribute,
  BufferGeometry,
  MathUtils,
  ShaderMaterial,
  Vector2,
  Vector3,
  type PerspectiveCamera,
} from 'three'
import { getTheme, useTheme, themeSnapsScenes } from '../../theme/themeStore'
import { lightSceneUniforms } from '../../theme/sceneUniforms'
import { ACTIVE_S, COLUMN_BOTTOM, SKILL_GAP, spiralPoint } from './spiral'
import fragmentShader from './particles.frag.glsl?raw'
import vertexShader from './particles.vert.glsl?raw'

/** Mutable scene state shared with the DOM layer; never stored in React state. */
export interface SkillsState {
  /** Continuous skill position: 0 = first skill active, 1 = second, … */
  t: number
  reveal: number
  pointerX: number
  pointerY: number
  invalidate?: () => void
}

export interface ParticleBudget {
  column: number
  pool: number
  spiral: number
  pathways: number
  dpr: number
  cameraZ: number
  cameraY: number
}

interface SceneProps {
  state: RefObject<SkillsState>
  labels: RefObject<(HTMLElement | null)[]>
  budget: ParticleBudget
  reducedMotion: boolean
  pointerParallax: boolean
}

// Deterministic randomness so geometry is stable across remounts.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function buildGeometry(b: ParticleBudget) {
  const total = b.column + b.pool + b.spiral + b.pathways
  const position = new Float32Array(total * 3)
  const seed = new Float32Array(total * 4)
  const kind = new Float32Array(total)
  const rand = random(7)
  let i = 0

  const push = (k: number, x = 0, y = 0, z = 0, s0 = rand()) => {
    position.set([x, y, z], i * 3)
    seed.set([s0, rand(), rand(), rand()], i * 4)
    kind[i++] = k
  }

  for (let n = 0; n < b.column; n++) push(0)
  for (let n = 0; n < b.pool; n++) {
    // Gaussian-ish disc, densest at the base of the column.
    const r = Math.sqrt(-Math.log(1 - rand() * 0.98)) * 1.1
    const a = rand() * Math.PI * 2
    push(1, Math.cos(a) * r, COLUMN_BOTTOM + (rand() - 0.5) * 0.12, Math.sin(a) * r * 0.8)
  }
  for (let n = 0; n < b.spiral; n++) push(2)

  // Pathways: a few curved lavender roots spreading from the pool, some climbing.
  const paths = 9
  const perPath = Math.floor(b.pathways / paths)
  for (let p = 0; p < paths; p++) {
    const a0 = (p / paths) * Math.PI * 2 + rand() * 0.5
    const reach = 2.2 + rand() * 1.6
    const bend = (rand() - 0.5) * 1.6
    const climb = p % 3 === 0 ? 1.4 + rand() : 0.15
    for (let n = 0; n < perPath; n++) {
      const u = n / perPath
      const a = a0 + bend * u * u
      const r = 0.25 + reach * u
      const jitter = (rand() - 0.5) * 0.03
      push(
        3,
        Math.cos(a) * r + jitter,
        COLUMN_BOTTOM + climb * Math.sin(u * Math.PI * 0.5) * (1 - u * 0.4) + jitter,
        Math.sin(a) * r * 0.8 + jitter,
        u,
      )
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position.subarray(0, i * 3), 3))
  geometry.setAttribute('aSeed', new BufferAttribute(seed.subarray(0, i * 4), 4))
  geometry.setAttribute('aKind', new BufferAttribute(kind.subarray(0, i), 1))
  // Procedural particles move in the shader: give culling a generous fixed bound.
  geometry.computeBoundingSphere()
  geometry.boundingSphere!.radius = 8
  return geometry
}

/**
 * Owns the particle geometry/material and the per-frame work: uniforms, camera
 * drift and projecting skill labels onto the ribbon. Lives outside React state.
 */
class SkillField {
  readonly geometry: BufferGeometry
  readonly material: ShaderMaterial
  private readonly v = new Vector3()
  private readonly p = { x: 0, y: 0, z: 0 }
  private readonly budget: ParticleBudget

  constructor(budget: ParticleBudget) {
    this.budget = budget
    this.geometry = buildGeometry(budget)
    this.material = new ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      premultipliedAlpha: true,
      uniforms: {
        uTime: { value: 0 },
        uFlow: { value: 0 },
        uReveal: { value: 0 },
        uProjScale: { value: 1 },
        uSize: { value: 0.045 },
        uTheme: { value: getTheme() === 'light' ? 1 : 0 },
        ...lightSceneUniforms(),
      },
    })
  }

  private themeTarget = getTheme() === 'light' ? 1 : 0

  setTheme(value: number, snap = false) {
    this.themeTarget = value
    if (snap) this.material.uniforms.uTheme.value = value
  }

  bind(state: SkillsState, invalidate: () => void) {
    state.invalidate = invalidate
  }

  resize(bufferHeight: number, fov: number) {
    this.material.uniforms.uProjScale.value = bufferHeight / (2 * Math.tan(MathUtils.degToRad(fov) / 2))
  }

  update(
    delta: number,
    s: SkillsState,
    camera: PerspectiveCamera,
    width: number,
    height: number,
    labels: (HTMLElement | null)[],
    animate: boolean,
    parallax: boolean,
  ) {
    const dt = Math.min(delta, 0.1)
    const u = this.material.uniforms
    if (animate) u.uTime.value += dt
    // Night ↔ dawn. Light glows additively at night; at dawn particles are painted
    // normally so the helix never washes out to white on the bright sky.
    u.uTheme.value += (this.themeTarget - u.uTheme.value) * (animate ? 1 - Math.exp(-dt * 6) : 1)
    if (Math.abs(this.themeTarget - u.uTheme.value) < 0.002) u.uTheme.value = this.themeTarget
    this.material.blending = u.uTheme.value > 0.5 ? NormalBlending : AdditiveBlending
    u.uFlow.value = s.t
    u.uReveal.value = s.reveal

    // Environmental perspective only — skills never follow the cursor.
    const { cameraY, cameraZ } = this.budget
    if (parallax) {
      const k = 1 - Math.exp(-dt * 1.5)
      camera.position.x += (s.pointerX * 0.35 - camera.position.x) * k
      camera.position.y += (cameraY + s.pointerY * 0.2 - camera.position.y) * k
    }
    camera.lookAt(0, cameraY, 0)

    // Project each skill onto its point of the ribbon; the active one comes forward.
    for (let i = 0; i < labels.length; i++) {
      const el = labels[i]
      if (!el) continue
      const off = i - s.t
      const sp = ACTIVE_S - off * SKILL_GAP
      const focus = Math.exp(-off * off * 1.6)
      const edge = MathUtils.smoothstep(sp, 0.02, 0.12) * (1 - MathUtils.smoothstep(sp, 0.82, 0.96))
      const opacity = Math.min(1, focus * 1.15 + 0.12 * Math.exp(-off * off * 0.25)) * edge * s.reveal
      if (opacity < 0.01) {
        if (el.style.opacity !== '0') el.style.opacity = '0'
        continue
      }
      const pt = spiralPoint(sp, this.p, 0.3)
      const v = this.v.set(pt.x, pt.y, pt.z + focus * 1.5)
      const dist = v.distanceTo(camera.position)
      v.project(camera)
      const x = (v.x * 0.5 + 0.5) * width
      const y = (-v.y * 0.5 + 0.5) * height
      const scale = (cameraZ / dist) * (0.82 + 0.25 * focus)
      el.style.opacity = opacity.toFixed(3)
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)}) rotate(${(off * -3).toFixed(2)}deg)`
      el.style.filter = focus > 0.92 ? 'none' : `blur(${((1 - focus) * 3.5).toFixed(2)}px)`
      el.style.zIndex = String(Math.round(focus * 100))
      el.classList.toggle('is-active', Math.abs(off) < 0.5)
    }
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

function Particles({ state, labels, budget, reducedMotion, pointerParallax }: SceneProps) {
  const { size, camera, gl, invalidate } = useThree()
  const field = useMemo(() => new SkillField(budget), [budget])
  useEffect(() => () => field.dispose(), [field])
  const theme = useTheme()
  useEffect(() => {
    field.setTheme(theme === 'light' ? 1 : 0, themeSnapsScenes())
    invalidate()
  }, [field, theme, invalidate])
  useEffect(() => field.bind(state.current, invalidate), [field, state, invalidate])
  useEffect(() => {
    field.resize(gl.getDrawingBufferSize(new Vector2()).y, (camera as PerspectiveCamera).fov)
  }, [field, camera, gl, size])

  useFrame((_, delta) =>
    field.update(
      delta,
      state.current,
      camera as PerspectiveCamera,
      size.width,
      size.height,
      labels.current,
      !reducedMotion,
      pointerParallax,
    ),
  )

  return <points geometry={field.geometry} material={field.material} frustumCulled={false} />
}

interface SkillsSceneProps extends SceneProps {
  active: boolean
}

export default function SkillsScene({ active, ...props }: SkillsSceneProps) {
  const { budget, reducedMotion } = props
  const frameloop = !active ? 'never' : reducedMotion ? 'demand' : 'always'

  return (
    <Canvas
      className="skills__canvas"
      frameloop={frameloop}
      dpr={Math.min(window.devicePixelRatio || 1, budget.dpr)}
      camera={{ fov: 40, position: [0, budget.cameraY, budget.cameraZ], near: 0.1, far: 50 }}
      gl={{ antialias: false, alpha: true, depth: false, stencil: false, powerPreference: 'high-performance' }}
      flat
      linear
    >
      <Particles {...props} />
    </Canvas>
  )
}
