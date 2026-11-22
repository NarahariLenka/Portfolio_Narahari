import { revealMotion } from '../../config/animations'
import { profile } from '../../data/profile'
import { useResponsive } from '../../hooks/useResponsive'
import ScrollReveal from './ScrollReveal'
import './About.css'

export default function About() {
  const { index, label, statement, details } = profile.about
  const { isMobile } = useResponsive()
  const size = isMobile ? 'mobile' : 'desktop'

  return (
    <section id="about" className="about" aria-labelledby="about-title">
      <p className="section-label">
        <span className="section-label__index">{index}</span>
        <span aria-hidden="true">•</span>
        {label}
      </p>

      <ScrollReveal
        as="h2"
        id="about-title"
        containerClassName="about__statement"
        enableBlur={true}
        {...revealMotion.statement[size]}
      >
        {statement}
      </ScrollReveal>

      {details && (
        <ScrollReveal
          as="p"
          containerClassName="about__details"
          enableBlur={true}
          {...revealMotion.details[size]}
        >
          {details}
        </ScrollReveal>
      )}
    </section>
  )
}
