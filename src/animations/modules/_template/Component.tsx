/**
 * TEMPLATE component. Receives validated params only; owns its own canvas/DOM inside
 * the click-through layer the registry provides, and must clean up on unmount.
 */
import { useEffect, useRef } from 'react'
import type { AnimationProps } from '../../types'
import type { params as schema } from './params'

type Props = AnimationProps<typeof schema>

export default function TemplateAnimation({ params, reducedMotion }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const el = canvas.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    let raf = 0
    const draw = (t: number) => {
      // ...draw using params.speed, params.intensity, params.density, params.style
      void t
      if (!reducedMotion) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [params, reducedMotion])

  return <canvas ref={canvas} style={{ width: '100%', height: '100%' }} />
}
