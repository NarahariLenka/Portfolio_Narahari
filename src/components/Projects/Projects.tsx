import { useRef } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { projects, projectsSection } from '../../data/projects'
import ProjectCard from './ProjectCard'
import './Projects.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)

export default function Projects() {
  const section = useRef<HTMLElement>(null)

  // Each project settles into place once as it enters; nothing replays on scroll-up.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.utils.toArray<HTMLElement>('.project').forEach((card) => {
          const frame = card.querySelector('.project__frame')
          const meta = card.querySelectorAll('.project__number, .project__links')
          gsap
            .timeline({
              defaults: { ease: 'power3.out' },
              scrollTrigger: { trigger: card, start: 'top 82%', once: true },
            })
            .from(frame, {
              autoAlpha: 0,
              y: 56,
              clipPath: 'inset(14% 0% 0% 0%)',
              duration: 1.3,
              clearProps: 'clipPath',
            })
            .from(meta, { autoAlpha: 0, y: 22, filter: 'blur(6px)', duration: 0.9, stagger: 0.08, clearProps: 'filter' }, 0.25)
        })
      })
    },
    { scope: section },
  )

  return (
    <section id="projects" ref={section} className="projects" aria-labelledby="projects-title">
      <header className="projects__header">
        <p className="section-label">
          <span className="section-label__index">{projectsSection.index}</span>
          <span aria-hidden="true">•</span>
          {projectsSection.label}
        </p>
        <h2 id="projects-title" className="sr-only">
          {projectsSection.label}
        </h2>
      </header>

      <div className="projects__list">
        {projects.map((project, i) => (
          <ProjectCard key={project.id} project={project} mirrored={i % 2 === 1} />
        ))}
      </div>
    </section>
  )
}
