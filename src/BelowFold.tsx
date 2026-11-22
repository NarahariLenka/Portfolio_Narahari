/**
 * The sections below the hero (About → Contact), in their own chunk so the hero and the
 * navigation render first. App.tsx loads this right after the first render (not on
 * scroll), so the sections are normally in the page before anyone reaches them.
 *
 * Order and markup are exactly as before (fixed order; the scroll animations depend on it).
 * After mounting: every ScrollTrigger is re-measured (the page just grew), the "sections
 * ready" signal is set (navigation tracking, early menu clicks), and a direct link to a
 * section (/#about) scrolls to it.
 */
import { useEffect } from 'react'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import About from './components/About/About'
import Certificates from './components/Certificates/Certificates'
import Contact from './components/Contact/Contact'
import { SafeBoundary } from './components/ErrorBoundary/ErrorBoundary'
import Projects from './components/Projects/Projects'
import Skills from './components/Skills/Skills'
import { SECTION_SLUGS } from './data/remote'
import { markSectionsReady } from './data/sectionsReady'
import { isSectionVisible } from './data/sections'

export default function BelowFold() {
  useEffect(() => {
    // Next frame: layout of the new sections is final.
    const raf = requestAnimationFrame(() => {
      ScrollTrigger.refresh()
      markSectionsReady()
      const id = window.location.hash.slice(1)
      if (id && id !== 'home' && (SECTION_SLUGS as readonly string[]).includes(id)) document.getElementById(id)?.scrollIntoView()
    })
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <>
      {isSectionVisible('about') && (
        <SafeBoundary name="about">
          <About />
        </SafeBoundary>
      )}
      {isSectionVisible('skills') && (
        <SafeBoundary name="skills">
          <Skills />
        </SafeBoundary>
      )}
      {isSectionVisible('projects') && (
        <SafeBoundary name="projects">
          <Projects />
        </SafeBoundary>
      )}
      {isSectionVisible('certificates') && (
        <SafeBoundary name="certificates">
          <Certificates />
        </SafeBoundary>
      )}
      {isSectionVisible('contact') && (
        <SafeBoundary name="contact">
          <Contact />
        </SafeBoundary>
      )}
    </>
  )
}
