import { useEffect } from 'react'

interface Zone {
  /** Scroll position where the paced stretch begins. */
  entry: number
  /** Resting points inside the stretch (each project, the certificates). */
  stops: number[]
  /** Scroll position where the paced stretch ends. */
  exit: number
}

/** Max wheel distance taken from a single event (px). */
const MAX_EVENT = 100
/** How far the target may run ahead of the page, as a fraction of the viewport. */
const MAX_LEAD = 0.28
/** Per-frame catch-up toward the target (higher = snappier). */
const FOLLOW = 0.12
/** After input stops, ease onto a stop if it is this close (fraction of viewport). */
const SETTLE_RANGE = 0.22
const SETTLE_DELAY = 160
/** Native scroll faster than this (px/ms) entering the stretch gets taken over. */
const TAKEOVER_SPEED = 2

/**
 * A paced stretch of the page: scrolling stays continuous and smooth, but its top speed
 * is capped so a hard flick still moves through every item at a readable pace. When input
 * stops, the page eases gently onto the nearest item if one is close. Outside the stretch,
 * and for keyboard / scrollbar input, the page scrolls natively.
 */
export function useScrollSequence(measure: () => Zone | null) {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let zone: Zone | null = null
    let target: number | null = null
    let raf = 0
    let settleTimer = 0
    let touchStartY = 0
    let touchStartScroll = 0
    let lastTouchY = 0
    let lastTouchT = 0
    let touchVelocity = 0
    let touching = false
    /** Touches that start on an interactive control (e.g. the sling) are left alone. */
    let ignoreTouch = false
    /** Last scroll position this hook wrote; anything else moving the page wins. */
    let written = -1
    /** Last time a wheel event was seen, intercepted or not (for momentum takeover). */
    let lastWheelAt = -Infinity

    const refresh = () => {
      zone = measure()
    }
    refresh()
    const ro = new ResizeObserver(refresh)
    ro.observe(document.body)

    const maxScroll = () => document.documentElement.scrollHeight - window.innerHeight
    const inZone = (y: number, dir: number) =>
      !!zone && (dir > 0 ? y >= zone.entry - 2 && y < zone.exit - 2 : y > zone.entry + 2 && y <= zone.exit + 2)

    const loop = () => {
      raf = 0
      if (target === null) return
      const y = window.scrollY
      // Scrollbar, keyboard or a link moved the page mid-glide: yield to it.
      if (written >= 0 && Math.abs(y - written) > 2) {
        target = null
        written = -1
        return
      }
      const diff = target - y
      if (Math.abs(diff) < 0.5) {
        window.scrollTo(0, target)
        written = -1
        // At rest: hand control back so keyboard, scrollbar and native scrolling just work.
        target = null
        return
      }
      window.scrollTo(0, reduced ? target : y + diff * FOLLOW)
      written = window.scrollY
      raf = requestAnimationFrame(loop)
    }
    const run = () => {
      if (!raf) {
        written = window.scrollY
        raf = requestAnimationFrame(loop)
      }
    }

    // Once input pauses, drift onto the nearest item if it is close; never yank far.
    const scheduleSettle = () => {
      clearTimeout(settleTimer)
      settleTimer = window.setTimeout(() => {
        if (!zone || touching) return
        const at = target ?? window.scrollY
        const vh = window.innerHeight
        const near = zone.stops.reduce((best, s) => (Math.abs(s - at) < Math.abs(best - at) ? s : best), Infinity)
        if (Math.abs(near - at) < vh * SETTLE_RANGE && Math.abs(near - at) > 1) {
          target = near
          run()
        }
      }, SETTLE_DELAY)
    }

    const push = (delta: number) => {
      const y = window.scrollY
      const lead = window.innerHeight * MAX_LEAD
      const base = target ?? y
      target = Math.min(maxScroll(), Math.max(0, Math.min(y + lead, Math.max(y - lead, base + delta))))
      run()
      scheduleSettle()
    }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return // pinch-zoom / sideways
      lastWheelAt = performance.now()
      const dir = Math.sign(e.deltaY)
      // Keep control while a paced glide is still running, even across the stretch's edge.
      if (target === null && (!dir || !inZone(window.scrollY, dir))) return
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
      push(Math.max(-MAX_EVENT, Math.min(MAX_EVENT, e.deltaY * unit)))
    }

    // A fast native coast (e.g. a flick that began above the stretch) crossing into it:
    // cancel the browser's momentum and continue at the paced speed instead.
    let lastY = window.scrollY
    let lastT = performance.now()
    const onScroll = () => {
      const y = window.scrollY
      const now = performance.now()
      const dy = y - lastY
      const v = dy / Math.max(1, now - lastT)
      lastY = y
      lastT = now
      if (target !== null || touching || !zone) return
      // Only wheel momentum, never an instant jump (links, scripts, scrollbar drags).
      const coasting = now - lastWheelAt < 1200 && Math.abs(dy) < window.innerHeight
      if (coasting && y > zone.entry && y < zone.exit && Math.abs(v) > TAKEOVER_SPEED) {
        window.scrollTo(0, y)
        target = y + Math.sign(v) * window.innerHeight * MAX_LEAD
        run()
        scheduleSettle()
      }
    }

    const onTouchStart = (e: TouchEvent) => {
      ignoreTouch = !!(e.target as Element | null)?.closest?.('.sling-button')
      if (ignoreTouch) return
      touching = true
      touchStartY = lastTouchY = e.touches[0].clientY
      touchStartScroll = window.scrollY
      lastTouchT = performance.now()
      touchVelocity = 0
      target = null
    }
    const onTouchMove = (e: TouchEvent) => {
      if (ignoreTouch) return
      const y = e.touches[0].clientY
      const dir = Math.sign(lastTouchY - y)
      if (!dir || !inZone(window.scrollY, dir)) return
      e.preventDefault()
      const now = performance.now()
      touchVelocity = (lastTouchY - y) / Math.max(1, now - lastTouchT) // px per ms
      lastTouchY = y
      lastTouchT = now
      // Follow the finger 1:1.
      target = Math.min(maxScroll(), Math.max(0, touchStartScroll + (touchStartY - y)))
      run()
    }
    const onTouchEnd = () => {
      if (ignoreTouch) {
        ignoreTouch = false
        return
      }
      touching = false
      if (target === null) return
      // Momentum, capped so a hard fling still moves at a readable pace.
      const glide = Math.max(-1, Math.min(1, touchVelocity * 0.35)) * window.innerHeight * 0.6
      target = Math.min(maxScroll(), Math.max(0, target + glide))
      run()
      scheduleSettle()
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
      clearTimeout(settleTimer)
      window.removeEventListener('wheel', onWheel)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [measure])
}
