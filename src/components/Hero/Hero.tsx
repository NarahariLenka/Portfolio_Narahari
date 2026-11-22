import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { heroMotion, type HeroMotion } from '../../config/animations'
import { hero } from '../../data/hero'
import './Hero.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)

function buildTimeline(
  section: HTMLElement,
  figure: HTMLElement,
  copy: HTMLElement,
  m: HeroMotion,
) {
  const vw = (f: number) => () => window.innerWidth * f
  const tl = gsap.timeline({
    defaults: { ease: 'sine.inOut' },
    scrollTrigger: {
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      scrub: heroMotion.scrub,
      invalidateOnRefresh: true,
    },
  })

  tl.set(figure, { x: 0, scale: m.scale.rest }, 0)
    // 0–22%: rest. 22–50%: travel LEFT → CENTER with a slow push-in.
    .to(figure, { x: vw(m.toCenter), scale: m.scale.climax, duration: 0.28 }, 0.22)
    // 50–56%: hold the climax.
    .to(figure, { scale: m.scale.climax * 1.015, duration: 0.06, ease: 'none' }, 0.5)
    // 56–86%: CENTER → RIGHT.
    .to(figure, { x: vw(m.toRight), scale: m.scale.exit, duration: 0.3 }, 0.56)
    // 86–100%: recede and dissolve, clearing the stage for what follows.
    .to(figure, { scale: m.scale.exit * 0.92, autoAlpha: 0, duration: 0.14, ease: 'power1.in' }, 0.86)

  // Copy yields while the portrait crosses, then resolves on the opposite side.
  if (m.copyShift !== 0) {
    tl.to(copy, { x: vw(m.copyShift), duration: 0.45 }, 0.28)
      .to(copy, { autoAlpha: 0.28, duration: 0.2, ease: 'sine.out' }, 0.3)
      .to(copy, { autoAlpha: 1, duration: 0.2, ease: 'sine.in' }, 0.55)
  } else {
    tl.to(copy, { autoAlpha: 0.5, duration: 0.25 }, 0.3)
      .to(copy, { autoAlpha: 1, duration: 0.25 }, 0.6)
  }
  tl.to(copy, { autoAlpha: 0.25, y: -24, duration: 0.14, ease: 'power1.in' }, 0.86)
  return tl
}

export default function Hero() {
  const section = useRef<HTMLElement>(null)
  const figure = useRef<HTMLDivElement>(null)
  const copy = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      const run = (m: HeroMotion) => () => {
        buildTimeline(section.current!, figure.current!, copy.current!, m)
      }
      // Reduced motion: no timeline, the stable start composition stays.
      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', run(heroMotion.desktop))
      mm.add('(max-width: 767px) and (prefers-reduced-motion: no-preference)', run(heroMotion.mobile))
    },
    { scope: section },
  )

  const [first, ...rest] = hero.name.split(' ')

  return (
    <section id="home" ref={section} className="hero" aria-labelledby="hero-title">
      <div className="hero__stage">
        <div ref={copy} className="hero__copy">
          <p className="hero__greeting">{hero.greeting}</p>
          <h1 id="hero-title" className="hero__name">
            <span>{first}</span> <span>{rest.join(' ')}</span>
          </h1>
        </div>

        <div ref={figure} className="hero__figure">
          <img
            className="hero__portrait"
            src={hero.portrait.src}
            alt={hero.portrait.alt}
            decoding="async"
            fetchPriority="high"
          />
          <img className="hero__reflection" src={hero.portrait.src} alt="" aria-hidden="true" />
        </div>
      </div>
    </section>
  )
}
