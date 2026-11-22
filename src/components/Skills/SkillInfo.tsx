import { useRef } from 'react'
import gsap from 'gsap'
import { useGSAP } from '@gsap/react'
import type { Skill } from '../../data/skills'

interface SkillInfoProps {
  skill: Skill
  index: number
  total: number
  reducedMotion: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Details of the active skill; re-enters softly whenever the active skill changes. */
export default function SkillInfo({ skill, index, total, reducedMotion }: SkillInfoProps) {
  const root = useRef<HTMLDivElement>(null)

  useGSAP(
    () => {
      if (reducedMotion) return
      // Explicit end state: a fast scroll interrupts this mid-way, and a plain
      // `from` would then settle on the half-faded values and leave the text dim.
      gsap.fromTo(
        root.current!.children,
        { autoAlpha: 0, y: 14, filter: 'blur(6px)' },
        {
          autoAlpha: 1,
          y: 0,
          filter: 'blur(0px)',
          duration: 0.7,
          stagger: 0.06,
          ease: 'power2.out',
          overwrite: true,
          clearProps: 'filter',
        },
      )
    },
    { scope: root, dependencies: [skill.id, reducedMotion] },
  )

  return (
    <div ref={root} className="skill-info" aria-live="polite">
      <p className="skill-info__count">
        {pad(index + 1)} <span>/ {pad(total)}</span>
      </p>
      <h3 className="skill-info__name">{skill.name}</h3>
      <p className="skill-info__summary">{skill.summary}</p>
      <ul className="skill-info__related" aria-label={`${skill.name} tools and topics`}>
        {skill.related.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}
