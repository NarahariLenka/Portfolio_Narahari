import { useEffect, useRef } from 'react'
import { AnimationBoundary, useAnimation } from '../../animations'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { ShootingStars } from './ShootingStars'
import SlingButton, { type SlingLaunch } from './SlingButton'
import './ShootingStarLauncher.css'

/** Taps / Enter: fire up and to the left, into the sky above the page. */
const DEFAULT_DIRECTION = { x: -0.62, y: -0.78 }

/**
 * Fixed bottom-right sling. Pull, aim and release: a shooting star flies the way the
 * arrow points. Drawn on its own click-through overlay, so nothing else on the page changes.
 * Registered as "shootingStar": the CMS can switch it off; a crash removes only the sling.
 */
export default function ShootingStarLauncher() {
  const anim = useAnimation('shootingStar')
  if (!anim.active) return null
  return (
    <AnimationBoundary id="shootingStar">
      <Launcher />
    </AnimationBoundary>
  )
}

function Launcher() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const anchor = useRef<HTMLDivElement>(null)
  const stars = useRef<ShootingStars | null>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const engine = new ShootingStars(canvas.current!)
    stars.current = engine
    return () => engine.dispose()
  }, [])

  const fire = (launch?: SlingLaunch) => {
    if (reduced || !stars.current || !anchor.current) return
    const r = anchor.current.getBoundingClientRect()
    const dir = launch ?? { ...DEFAULT_DIRECTION, power: 0.5 }
    stars.current.launch(r.left + r.width / 2, r.top + r.height / 2, dir.x, dir.y, dir.power)
  }

  return (
    <>
      <canvas ref={canvas} className="shooting-stars" aria-hidden="true" />
      <div ref={anchor} className="star-launcher">
        <SlingButton
          onSend={fire}
          ariaLabel="Launch a shooting star"
          padColor="var(--sling-pad)"
          iconColor="var(--sling-icon)"
          accentColor="var(--sling-accent)"
          wellColor="var(--sling-well)"
          bandColor="var(--sling-band)"
          size={48}
          strokeWidth={2.5}
          armAt={44}
          maxPull={140}
          particles={12}
          flight={90}
        />
      </div>
    </>
  )
}
