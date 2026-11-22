import { useCallback, useEffect, useMemo, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { LinearFilter, NoColorSpace, ShaderMaterial, TextureLoader, Vector2, Vector3, Vector4 } from 'three'
import dawnUrl from '../../../assets/backgrounds/dawn-background.webp'
import {
  desktopScene,
  planetKindIndex,
  mobileScene,
  type SceneQuality,
} from '../../../config/scene'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { getTheme, useTheme, themeSnapsScenes } from '../../../theme/themeStore'
import { lightSceneUniforms } from '../../../theme/sceneUniforms'
import { useResponsive } from '../../../hooks/useResponsive'
import { WaterSurface } from '../WaterDistortion/WaterSurface'
import fragmentShader from './cosmic.frag.glsl?raw'
import vertexShader from './cosmic.vert.glsl?raw'

function isLowPowerDevice() {
  return (navigator.hardwareConcurrency ?? 8) <= 4
}

interface SceneProps {
  quality: SceneQuality
  reducedMotion: boolean
  onCompiled: () => void
}

function CosmicScene({ quality, reducedMotion, onCompiled }: SceneProps) {
  const size = useThree((s) => s.size)
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader,
        fragmentShader,
        depthTest: false,
        depthWrite: false,
        defines: {
          MAX_RIPPLES: quality.maxRipples,
          PLANET_COUNT: quality.planets.length,
          STAR_LAYERS: quality.starLayers,
          QUALITY: quality.waveQuality,
          RIPPLE_SCALE: quality.rippleScale.toFixed(3),
        },
        uniforms: {
          uTime: { value: 0 },
          uRes: { value: new Vector2(1, 1) },
          uHorizon: { value: quality.horizon },
          uParallax: { value: new Vector2() },
          uRipples: {
            value: Array.from(
              { length: quality.maxRipples },
              () => new Vector4(0, 0, -100, 0),
            ),
          },
          uPointer: { value: new Vector3(0.5, 0.5, 0) },
          uPlanets: {
            value: quality.planets.map(
              (p) => new Vector4(p.x, p.y, p.radius, planetKindIndex[p.kind]),
            ),
          },
          uPlanetMotion: {
            value: quality.planets.map(
              // Negative seed = night-only planet (fades out in the light theme).
              (p, i) => new Vector4(p.speed, p.tilt ?? 0, p.tint ?? 0, p.darkOnly ? -(i * 1.7 + 0.1) : i * 1.7),
            ),
          },
          uDescent: { value: 0 },
          uIntro: { value: 0 },
          uTheme: { value: getTheme() === 'light' ? 1 : 0 },
          uDawnTex: { value: null },
          uDawnReady: { value: 0 },
          ...lightSceneUniforms(),
        },
      }),
    [quality],
  )
  useEffect(() => () => material.dispose(), [material])

  // Light-theme backdrop image; the dawn path falls back to the procedural sky until it loads.
  useEffect(() => {
    let disposed = false
    const tex = new TextureLoader().load(dawnUrl, () => {
      if (disposed) return
      material.uniforms.uDawnTex.value = tex
      material.uniforms.uDawnReady.value = 1
    })
    tex.colorSpace = NoColorSpace
    tex.minFilter = LinearFilter
    tex.generateMipmaps = false
    return () => {
      disposed = true
      tex.dispose()
    }
  }, [material])

  const surface = useMemo(
    () => new WaterSurface(material.uniforms as never, quality.horizon),
    [material, quality.horizon],
  )
  useEffect(() => surface.attach(), [surface])

  // Night ↔ dawn: the surface eases the shader toward the selected theme.
  const theme = useTheme()
  useEffect(() => surface.setTheme(theme === 'light' ? 1 : 0, themeSnapsScenes()), [surface, theme])

  // From About onward the camera rises: water drains away, planets drift past.
  // The origin is About's top reaching the bottom of the viewport, re-measured on layout changes.
  useEffect(() => {
    const measure = () => {
      const about = document.querySelector('.about')
      if (!about) return
      surface.setDescentOrigin(about.getBoundingClientRect().top + window.scrollY - window.innerHeight)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(document.body)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [surface])
  useEffect(() => surface.resize(size.width, size.height), [surface, size])

  useFrame((_, delta) => surface.update(delta, reducedMotion))

  // Compile the (large) sky shader before the first frame. Otherwise the first render links
  // the program synchronously and blocks the main thread for the whole compile; compileAsync
  // uses KHR_parallel_shader_compile so the browser compiles it off the main thread.
  // The frame loop starts once it is done (or straight away if compiling fails).
  useEffect(() => {
    let cancelled = false
    gl.compileAsync(scene, camera)
      .catch(() => undefined)
      .then(() => {
        if (!cancelled) onCompiled()
      })
    return () => {
      cancelled = true
    }
  }, [gl, scene, camera, material, onCompiled])

  return (
    <mesh frustumCulled={false} material={material}>
      <planeGeometry args={[2, 2]} />
    </mesh>
  )
}

export default function CosmicBackground() {
  const { isMobile } = useResponsive()
  const reducedMotion = useReducedMotion()
  const quality = isMobile || isLowPowerDevice() ? mobileScene : desktopScene
  const dpr = Math.min(window.devicePixelRatio || 1, quality.maxDpr)
  // Hidden with no frame loop until the shader is compiled (the page background shows meanwhile).
  const [compiled, setCompiled] = useState(false)
  const onCompiled = useCallback(() => setCompiled(true), [])

  return (
    <div className="cosmic-background" aria-hidden="true">
      <Canvas
        dpr={dpr}
        frameloop={compiled ? 'always' : 'never'}
        style={compiled ? undefined : { visibility: 'hidden' }}
        flat
        linear
        gl={{
          antialias: false,
          alpha: false,
          depth: false,
          stencil: false,
          powerPreference: 'high-performance',
        }}
        fallback={<div className="cosmic-background__fallback" />}
      >
        <CosmicScene quality={quality} reducedMotion={reducedMotion} onCompiled={onCompiled} />
      </Canvas>
    </div>
  )
}
