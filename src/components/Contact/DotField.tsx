// React Bits — DotField (JS + CSS variant), ported to TypeScript.
// https://reactbits.dev
// Local changes: the loop only runs while the field is on screen, cursor position is
// measured against the live canvas rect (the page above changes height as it animates),
// the grid follows its container via ResizeObserver, and reduced motion draws one still frame.
import { memo, useEffect, useId, useRef, type HTMLAttributes } from 'react'

import './DotField.css'

const TWO_PI = Math.PI * 2

interface DotFieldProps extends HTMLAttributes<HTMLDivElement> {
  dotRadius?: number
  dotSpacing?: number
  cursorRadius?: number
  cursorForce?: number
  bulgeOnly?: boolean
  bulgeStrength?: number
  glowRadius?: number
  sparkle?: boolean
  waveAmplitude?: number
  gradientFrom?: string
  gradientTo?: string
  glowColor?: string
}

interface Dot {
  ax: number
  ay: number
  sx: number
  sy: number
  vx: number
  vy: number
  x: number
  y: number
}

const DotField = memo(
  ({
    dotRadius = 1.5,
    dotSpacing = 14,
    cursorRadius = 500,
    cursorForce = 0.1,
    bulgeOnly = true,
    bulgeStrength = 67,
    glowRadius = 160,
    sparkle = false,
    waveAmplitude = 0,
    gradientFrom = 'rgba(168, 85, 247, 0.35)',
    gradientTo = 'rgba(180, 151, 207, 0.25)',
    glowColor = '#120F17',
    ...rest
  }: DotFieldProps) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const glowRef = useRef<SVGCircleElement>(null)
    const propsRef = useRef({ dotRadius, dotSpacing, cursorRadius, cursorForce, bulgeOnly, bulgeStrength, sparkle, waveAmplitude, gradientFrom, gradientTo })
    const rebuildRef = useRef<(() => void) | null>(null)
    const glowId = `dot-field-glow-${useId().replace(/:/g, '')}`

    useEffect(() => {
      propsRef.current = { dotRadius, dotSpacing, cursorRadius, cursorForce, bulgeOnly, bulgeStrength, sparkle, waveAmplitude, gradientFrom, gradientTo }
    })

    useEffect(() => {
      const canvas = canvasRef.current
      const glowEl = glowRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d', { alpha: true })
      if (!ctx) return
      const container = canvas.parentElement!
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

      let dots: Dot[] = []
      let w = 0
      let h = 0
      const client = { x: -9999, y: -9999 }
      const mouse = { x: -9999, y: -9999, prevX: -9999, prevY: -9999, speed: 0 }
      let engagement = 0
      let glowOpacity = 0
      let frameCount = 0
      let raf = 0
      let visible = false

      function buildDots() {
        const p = propsRef.current
        const step = p.dotRadius + p.dotSpacing
        const cols = Math.floor(w / step)
        const rows = Math.floor(h / step)
        const padX = (w % step) / 2
        const padY = (h % step) / 2
        dots = new Array(rows * cols)
        let idx = 0
        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const ax = padX + col * step + step / 2
            const ay = padY + row * step + step / 2
            dots[idx++] = { ax, ay, sx: ax, sy: ay, vx: 0, vy: 0, x: ax, y: ay }
          }
        }
      }

      function resize() {
        const rect = container.getBoundingClientRect()
        w = rect.width
        h = rect.height
        canvas!.width = w * dpr
        canvas!.height = h * dpr
        canvas!.style.width = `${w}px`
        canvas!.style.height = `${h}px`
        ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
        buildDots()
        if (!raf) draw()
      }

      function onMouseMove(e: MouseEvent) {
        client.x = e.clientX
        client.y = e.clientY
      }

      function updateMouseSpeed() {
        const dx = mouse.prevX - mouse.x
        const dy = mouse.prevY - mouse.y
        const dist = Math.sqrt(dx * dx + dy * dy)
        mouse.speed += (dist - mouse.speed) * 0.5
        if (mouse.speed < 0.001) mouse.speed = 0
        mouse.prevX = mouse.x
        mouse.prevY = mouse.y
      }
      const speedInterval = window.setInterval(updateMouseSpeed, 20)

      function draw() {
        const p = propsRef.current
        const len = dots.length
        const t = frameCount * 0.02

        // Cursor relative to the canvas as it is right now.
        const rect = canvas!.getBoundingClientRect()
        mouse.x = client.x - rect.left
        mouse.y = client.y - rect.top

        const targetEngagement = Math.min(mouse.speed / 5, 1)
        engagement += (targetEngagement - engagement) * 0.06
        if (engagement < 0.001) engagement = 0
        const eng = engagement

        glowOpacity += (eng - glowOpacity) * 0.08
        if (glowEl) {
          glowEl.setAttribute('cx', String(mouse.x))
          glowEl.setAttribute('cy', String(mouse.y))
          glowEl.style.opacity = String(glowOpacity)
        }

        ctx!.clearRect(0, 0, w, h)
        const grad = ctx!.createLinearGradient(0, 0, w, h)
        grad.addColorStop(0, p.gradientFrom)
        grad.addColorStop(1, p.gradientTo)
        ctx!.fillStyle = grad

        const cr = p.cursorRadius
        const crSq = cr * cr
        const rad = p.dotRadius / 2
        const isBulge = p.bulgeOnly

        ctx!.beginPath()
        for (let i = 0; i < len; i++) {
          const d = dots[i]
          const dx = mouse.x - d.ax
          const dy = mouse.y - d.ay
          const distSq = dx * dx + dy * dy

          if (distSq < crSq && eng > 0.01) {
            const dist = Math.sqrt(distSq)
            const angle = Math.atan2(dy, dx)
            if (isBulge) {
              const k = 1 - dist / cr
              const push = k * k * p.bulgeStrength * eng
              d.sx += (d.ax - Math.cos(angle) * push - d.sx) * 0.15
              d.sy += (d.ay - Math.sin(angle) * push - d.sy) * 0.15
            } else {
              const move = (500 / dist) * (mouse.speed * p.cursorForce)
              d.vx += Math.cos(angle) * -move
              d.vy += Math.sin(angle) * -move
            }
          } else if (isBulge) {
            d.sx += (d.ax - d.sx) * 0.1
            d.sy += (d.ay - d.sy) * 0.1
          }

          if (!isBulge) {
            d.vx *= 0.9
            d.vy *= 0.9
            d.x = d.ax + d.vx
            d.y = d.ay + d.vy
            d.sx += (d.x - d.sx) * 0.1
            d.sy += (d.y - d.sy) * 0.1
          }

          let drawX = d.sx
          let drawY = d.sy
          if (p.waveAmplitude > 0) {
            drawY += Math.sin(d.ax * 0.03 + t) * p.waveAmplitude
            drawX += Math.cos(d.ay * 0.03 + t * 0.7) * p.waveAmplitude * 0.5
          }

          // ~3% of dots sparkle when enabled.
          const hash = ((i * 2654435761) ^ (frameCount >> 3)) >>> 0
          const r = p.sparkle && hash % 100 < 3 ? rad * 1.8 : rad
          ctx!.moveTo(drawX + r, drawY)
          ctx!.arc(drawX, drawY, r, 0, TWO_PI)
        }
        ctx!.fill()
      }

      function tick() {
        frameCount++
        draw()
        raf = requestAnimationFrame(tick)
      }

      const start = () => {
        if (reduced || raf || !visible) return
        raf = requestAnimationFrame(tick)
      }
      const stop = () => {
        cancelAnimationFrame(raf)
        raf = 0
      }

      // Animate only while on screen; the Contact section is the last stop of a long page.
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting
        if (visible) start()
        else stop()
      })
      io.observe(container)
      const ro = new ResizeObserver(resize)
      ro.observe(container)

      resize()
      window.addEventListener('mousemove', onMouseMove, { passive: true })
      rebuildRef.current = () => {
        if (w > 0 && h > 0) buildDots()
      }

      return () => {
        stop()
        io.disconnect()
        ro.disconnect()
        clearInterval(speedInterval)
        window.removeEventListener('mousemove', onMouseMove)
      }
    }, [])

    useEffect(() => {
      rebuildRef.current?.()
    }, [dotRadius, dotSpacing])

    return (
      <div className="dot-field-container" {...rest}>
        <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
          <defs>
            <radialGradient id={glowId}>
              <stop offset="0%" stopColor={glowColor} />
              <stop offset="100%" stopColor="transparent" />
            </radialGradient>
          </defs>
          <circle ref={glowRef} cx="-9999" cy="-9999" r={glowRadius} fill={`url(#${glowId})`} style={{ opacity: 0, willChange: 'opacity' }} />
        </svg>
      </div>
    )
  },
)

DotField.displayName = 'DotField'

export default DotField
