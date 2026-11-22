import { useEffect, useRef, type SyntheticEvent } from 'react'
import gsap from 'gsap'
import { guardAnimation, useAnimation } from '../../animations'
import type { projectsTilt } from '../../animations/builtin'
import { revealMotion } from '../../config/animations'
import { siteText } from '../../data/content'
import type { Project } from '../../data/projects'
import { useResponsive } from '../../hooks/useResponsive'
import ScrollReveal from '../About/ScrollReveal'

interface ProjectCardProps {
  project: Project
  /** Preview on the right, metadata on the left. */
  mirrored: boolean
}

/** Wide screenshots stay cinematic, tall ones don't take over the page. */
const MIN_RATIO = 1.25
const MAX_RATIO = 2.1

export default function ProjectCard({ project, mirrored }: ProjectCardProps) {
  const frame = useRef<HTMLDivElement>(null)
  const { isMobile } = useResponsive()
  const reveal = revealMotion.project[isMobile ? 'mobile' : 'desktop']
  const media = useRef<HTMLDivElement>(null)
  // Max tilt (deg), image depth shift (px) and easing time (s): CMS-tunable, defaults 4 / 10 / 0.8.
  const tiltFx = useAnimation<(typeof projectsTilt)['params']>('projectsTilt')
  const { tilt: TILT, depth: DEPTH, duration } = tiltFx.params

  // Desktop pointer tilt: GSAP quickTo writes transforms directly, no React renders.
  useEffect(() => {
    const el = frame.current!
    const inner = media.current!
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduced || !tiltFx.active) return

    return guardAnimation('projectsTilt', () => {
      gsap.set(el, { transformPerspective: 1100 })
      const ease = { duration, ease: 'power3.out' }
      const rx = gsap.quickTo(el, 'rotationX', ease)
      const ry = gsap.quickTo(el, 'rotationY', ease)
      const lift = gsap.quickTo(el, 'y', ease)
      const mx = gsap.quickTo(inner, 'x', ease)
      const my = gsap.quickTo(inner, 'y', ease)

      const onMove = (e: PointerEvent) => {
        const r = el.getBoundingClientRect()
        const px = (e.clientX - r.left) / r.width - 0.5
        const py = (e.clientY - r.top) / r.height - 0.5
        ry(px * TILT * 2)
        rx(-py * TILT * 2)
        mx(-px * DEPTH)
        my(-py * DEPTH)
      }
      const onEnter = () => lift(-6)
      const onLeave = () => {
        rx(0)
        ry(0)
        lift(0)
        mx(0)
        my(0)
      }

      el.addEventListener('pointermove', onMove)
      el.addEventListener('pointerenter', onEnter)
      el.addEventListener('pointerleave', onLeave)
      return () => {
        el.removeEventListener('pointermove', onMove)
        el.removeEventListener('pointerenter', onEnter)
        el.removeEventListener('pointerleave', onLeave)
        gsap.killTweensOf([el, inner])
        gsap.set(el, { rotationX: 0, rotationY: 0, y: 0 })
        gsap.set(inner, { x: 0, y: 0 })
      }
    })
  }, [tiltFx.active, TILT, DEPTH, duration])

  // Adopt the screenshot's own proportions (clamped) so any image size fits.
  const onImageLoad = (e: SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (!w || !h) return
    const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, w / h))
    frame.current?.style.setProperty('--ratio', ratio.toFixed(3))
  }

  const links = [
    project.github && { label: siteText.labels.githubLink, href: project.github },
    project.live && { label: siteText.labels.liveSiteLink, href: project.live },
  ].filter((l): l is { label: string; href: string } => Boolean(l))

  return (
    <article
      className={`project${mirrored ? ' project--mirrored' : ''}${project.featured ? ' project--featured' : ''}`}
      aria-labelledby={`project-${project.id}`}
    >
      <div ref={frame} className="project__frame">
        <div ref={media} className="project__media">
          {project.image ? (
            <img
              src={project.image}
              alt={project.imageAlt ?? `Screenshot of ${project.title}`}
              loading="lazy"
              decoding="async"
              onLoad={onImageLoad}
              style={{ objectPosition: project.imagePosition ?? '50% 0%' }}
            />
          ) : (
            <div className="project__placeholder" role="img" aria-label={`${project.title} preview coming soon`}>
              <span>{siteText.labels.projectPreviewPlaceholder}</span>
            </div>
          )}
        </div>
      </div>

      <div className="project__meta">
        <p className="project__number">{project.number}</p>
        <ScrollReveal as="h3" id={`project-${project.id}`} containerClassName="project__title" {...reveal}>
          {project.title}
        </ScrollReveal>
        {project.technologies.length > 0 && (
          <ScrollReveal as="p" containerClassName="project__tech" {...reveal}>
            {project.technologies.join(' • ')}
          </ScrollReveal>
        )}
        {project.description && (
          <ScrollReveal as="p" containerClassName="project__description" {...reveal}>
            {project.description}
          </ScrollReveal>
        )}
        {links.length > 0 && (
          <ul className="project__links">
            {links.map((l) => (
              <li key={l.label}>
                <a href={l.href} target="_blank" rel="noreferrer">
                  {l.label} <span aria-hidden="true">↗</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}
