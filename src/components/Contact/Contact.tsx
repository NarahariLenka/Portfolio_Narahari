import { useRef, useState } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { AnimationBoundary, useAnimation } from '../../animations'
import type { contactDotField } from '../../animations/builtin'
import { themes } from '../../config/themes'
import { profile } from '../../data/profile'
import { useTheme } from '../../theme/themeStore'
import { dockLinks } from './contactLinks'
import DotField from './DotField'
import Dock from './Dock'
import SplitFlapText from './SplitFlapText'
import './Contact.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)

export default function Contact() {
  const section = useRef<HTMLElement>(null)
  const { index, label, headline } = profile.contact
  const [flapActive, setFlapActive] = useState(false)
  const dots = themes[useTheme()].dots
  const dotField = useAnimation<(typeof contactDotField)['params']>('contactDotField')

  useGSAP(
    () => {
      // The headline flips in like a departure board every time it scrolls into view…
      ScrollTrigger.create({
        trigger: '.contact__headline',
        start: 'top 85%',
        onEnter: () => setFlapActive(true),
      })
      // …and quietly resets to blank only once it is fully out of view again.
      ScrollTrigger.create({
        trigger: '.contact__headline',
        start: 'top bottom',
        onLeaveBack: () => setFlapActive(false),
      })

      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.dock', {
          autoAlpha: 0,
          y: 24,
          duration: 0.9,
          delay: 1.4,
          ease: 'power2.out',
          scrollTrigger: { trigger: '.contact__headline', start: 'top 85%', once: true },
        })
      })

      // Journey's end: one slow lavender bloom as the very bottom is reached, then it rests.
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap
          .timeline({ scrollTrigger: { trigger: section.current, start: 'bottom bottom+=40', once: true } })
          .fromTo('.contact__glow', { autoAlpha: 0, scale: 0.85 }, { autoAlpha: 1, scale: 1.05, duration: 2.4, ease: 'sine.out' })
          .to('.contact__glow', { autoAlpha: 0.6, scale: 1, duration: 3, ease: 'sine.inOut' })
      })
      mm.add('(prefers-reduced-motion: reduce)', () => {
        gsap.set('.contact__glow', { autoAlpha: 0.6 })
      })
    },
    { scope: section },
  )

  return (
    <section id="contact" ref={section} className="contact" aria-labelledby="contact-title">
      <div className="contact__dots" aria-hidden="true">
        {dotField.active && (
          <AnimationBoundary id="contactDotField">
            <DotField
              dotRadius={dotField.params.dotRadius}
              dotSpacing={dotField.params.dotSpacing}
              bulgeStrength={dotField.params.bulgeStrength}
              cursorRadius={dotField.params.cursorRadius}
              glowRadius={dotField.params.glowRadius}
              sparkle={false}
              waveAmplitude={0}
              gradientFrom={dots.from}
              gradientTo={dots.to}
              glowColor={dots.glow}
            />
          </AnimationBoundary>
        )}
      </div>
      <div className="contact__glow" aria-hidden="true" />

      <p className="section-label contact__label">
        <span className="section-label__index">{index}</span>
        <span aria-hidden="true">•</span>
        {label}
      </p>

      <h2 id="contact-title" className="contact__headline">
        <span className="sr-only">{headline.join(' ')}</span>
        {headline.map((word, i) => (
          <SplitFlapText
            key={word}
            aria-hidden="true"
            className="contact__flap"
            words={['', word.toUpperCase()]}
            loop={false}
            padTo={0}
            active={flapActive}
            cycleDelay={400 + i * 350}
            charset="alpha"
            flipsPerChar={7}
            flipDuration={0.09}
            stagger={0.08}
            fontSize="1em"
            gap={0}
            tileRadius={0}
            textColor="var(--heading)"
          />
        ))}
      </h2>

      <Dock links={dockLinks} />
    </section>
  )
}
