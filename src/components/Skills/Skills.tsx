import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { skillsBudget } from '../../config/scene'
import { skills, skillsSection } from '../../data/skills'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { useResponsive } from '../../hooks/useResponsive'
import SkillInfo from './SkillInfo'
import type { SkillsState } from './SkillsScene'
import './Skills.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const SkillsScene = lazy(() => import('./SkillsScene'))

/** Scroll lead-in/out (in skills) before the first and after the last skill. */
const LEAD = 0.35
const LAST = skills.length - 1
const SPAN = LAST + LEAD * 2

const lowPower = () => (navigator.hardwareConcurrency ?? 8) <= 4

export default function Skills() {
  const { isMobile } = useResponsive()
  const reducedMotion = useReducedMotion()
  const budget = isMobile ? skillsBudget.mobile : lowPower() ? skillsBudget.lowPower : skillsBudget.desktop

  const section = useRef<HTMLElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const focus = useRef<HTMLDivElement>(null)
  const info = useRef<HTMLDivElement>(null)
  const rail = useRef<HTMLElement>(null)
  const sequence = useRef<ScrollTrigger | null>(null)
  const state = useRef<SkillsState>({ t: -LEAD, reveal: 0, pointerX: 0, pointerY: 0 })
  const labels = useRef<(HTMLElement | null)[]>([])
  const activeRef = useRef(0)
  const [active, setActive] = useState(0)
  const [inView, setInView] = useState(false)
  const [mounted, setMounted] = useState(false)

  // React only hears about the active skill when it changes (six times per pass).
  const sync = useCallback(() => {
    const s = state.current
    const i = Math.min(LAST, Math.max(0, Math.round(s.t)))
    if (i !== activeRef.current) {
      activeRef.current = i
      setActive(i)
    }
    s.invalidate?.()
  }, [])

  // Render the WebGL scene only while the section is near the viewport.
  useEffect(() => {
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting)
        if (entry.isIntersecting) setMounted(true)
      },
      { rootMargin: '25% 0px' },
    )
    io.observe(section.current!)
    return () => io.disconnect()
  }, [])

  // Desktop: a slight perspective response to the cursor. Skills themselves never follow it.
  useEffect(() => {
    if (isMobile || reducedMotion) return
    const s = state.current
    const onMove = (e: globalThis.PointerEvent) => {
      s.pointerX = e.clientX / window.innerWidth - 0.5
      s.pointerY = 0.5 - e.clientY / window.innerHeight
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [isMobile, reducedMotion])

  useGSAP(
    () => {
      const s = state.current
      const el = section.current!

      // About → Skills: the column emerges and the environment quiets down.
      gsap.fromTo(
        s,
        { reveal: 0 },
        {
          reveal: 1,
          ease: 'none',
          onUpdate: () => s.invalidate?.(),
          scrollTrigger: { trigger: el, start: 'top bottom', end: isMobile ? 'top 15%' : 'top top', scrub: true },
        },
      )
      gsap.fromTo(
        focus.current,
        { autoAlpha: 0 },
        { autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 80%', end: 'top top', scrub: true } },
      )
      gsap.fromTo(
        [info.current, rail.current].filter(Boolean),
        { autoAlpha: 0 },
        { autoAlpha: 1, ease: 'none', scrollTrigger: { trigger: el, start: 'top 30%', end: 'top top', scrub: true } },
      )

      // Skills → Projects: the scene recedes as the section scrolls away, no hard edge.
      gsap.to(stage.current, {
        autoAlpha: 0,
        ease: 'none',
        scrollTrigger: { trigger: el, start: 'bottom 85%', end: 'bottom 25%', scrub: true },
      })

      if (isMobile) {
        // Mobile is driven by swipe / tap instead of a scroll runway.
        s.t = activeRef.current
        sync()
        return
      }

      const tween = gsap.fromTo(
        s,
        { t: -LEAD },
        {
          t: LAST + LEAD,
          ease: 'none',
          onUpdate: sync,
          scrollTrigger: {
            trigger: el,
            start: 'top top',
            end: 'bottom bottom',
            scrub: reducedMotion ? true : 1.2,
            snap: reducedMotion
              ? undefined
              : {
                  snapTo: skills.map((_, i) => (i + LEAD) / SPAN),
                  duration: { min: 0.4, max: 1 },
                  delay: 0.12,
                  ease: 'power1.inOut',
                },
          },
        },
      )
      sequence.current = tween.scrollTrigger ?? null
    },
    { scope: section, dependencies: [isMobile, reducedMotion], revertOnUpdate: true },
  )

  const goTo = useCallback(
    (i: number) => {
      const target = Math.min(LAST, Math.max(0, i))
      const st = sequence.current
      if (!isMobile && st) {
        const top = st.start + ((target + LEAD) / SPAN) * (st.end - st.start)
        window.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' })
        return
      }
      gsap.to(state.current, {
        t: target,
        duration: reducedMotion ? 0 : 1.1,
        ease: 'power2.inOut',
        overwrite: true,
        onUpdate: sync,
      })
    },
    [isMobile, reducedMotion, sync],
  )

  // Mobile swipe: horizontal gestures step through skills; vertical scroll is untouched.
  const swipe = useRef({ x: 0, y: 0 })
  const onPointerDown = (e: PointerEvent) => {
    swipe.current = { x: e.clientX, y: e.clientY }
  }
  const onPointerUp = (e: PointerEvent) => {
    const dx = e.clientX - swipe.current.x
    const dy = e.clientY - swipe.current.y
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) goTo(activeRef.current + (dx < 0 ? 1 : -1))
  }

  const skill = skills[active]

  return (
    <section
      id="skills"
      ref={section}
      className="skills"
      aria-labelledby="skills-title"
      style={{ '--skill-count': skills.length } as CSSProperties}
    >
      <div
        ref={stage}
        className="skills__stage"
        onPointerDown={isMobile ? onPointerDown : undefined}
        onPointerUp={isMobile ? onPointerUp : undefined}
      >
        <div ref={focus} className="skills__focus" aria-hidden="true" />

        <div className="skills__visual" aria-hidden="true" onClick={isMobile ? () => goTo(activeRef.current + 1) : undefined}>
          {mounted && (
            <Suspense fallback={null}>
              <SkillsScene
                active={inView}
                state={state}
                labels={labels}
                budget={budget}
                reducedMotion={reducedMotion}
                pointerParallax={!isMobile && !reducedMotion}
              />
            </Suspense>
          )}
          <div className="skills__labels">
            {skills.map((s, i) => (
              <span
                key={s.id}
                ref={(node) => {
                  labels.current[i] = node
                }}
                className="skill-token"
              >
                {s.name}
              </span>
            ))}
          </div>
        </div>

        <header className="skills__header">
          <p className="section-label">
            <span className="section-label__index">{skillsSection.index}</span>
            <span aria-hidden="true">•</span>
            {skillsSection.label}
          </p>
          <h2 id="skills-title" className="sr-only">
            {skillsSection.label}
          </h2>
        </header>

        <div ref={info} className="skills__info">
          <SkillInfo skill={skill} index={active} total={skills.length} reducedMotion={reducedMotion} />
          {isMobile && (
            <div className="skills__controls">
              <button type="button" onClick={() => goTo(active - 1)} disabled={active === 0} aria-label="Previous skill">
                ←
              </button>
              <button type="button" onClick={() => goTo(active + 1)} disabled={active === LAST} aria-label="Next skill">
                →
              </button>
            </div>
          )}
        </div>

        {!isMobile && (
          <nav ref={rail} className="skills__rail" aria-label="Skills">
            <ol>
              {skills.map((s, i) => (
                <li key={s.id}>
                  <button type="button" aria-current={i === active ? 'step' : undefined} onClick={() => goTo(i)}>
                    {s.name}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        )}
      </div>
    </section>
  )
}
