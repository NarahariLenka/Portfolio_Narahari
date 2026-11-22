import { useEffect, useState } from 'react'
import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { siteAppearance } from '../../config/appearanceRuntime'
import { navItems } from '../../data/navigation'
import { useSectionsReady, whenSectionsReady } from '../../data/sectionsReady'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { transitionToTheme } from '../../lib/themeTransition'
import { useTheme } from '../../theme/themeStore'
import './Navigation.css'

gsap.registerPlugin(ScrollToPlugin, ScrollTrigger)

/** Shared top-right navigation with the night/dawn toggle. */
export default function Navigation() {
  const theme = useTheme()
  const reduced = useReducedMotion()
  const [active, setActive] = useState(navItems[0].id)
  const [open, setOpen] = useState(false)
  // The sections below the hero arrive in their own chunk just after the first render.
  const sectionsReady = useSectionsReady()

  // Active item follows the section crossing the middle of the viewport.
  useEffect(() => {
    const triggers = navItems.flatMap(({ id }) => {
      const el = document.getElementById(id)
      if (!el) return []
      return ScrollTrigger.create({
        trigger: el,
        // A section becomes active once its content has actually arrived in view.
        start: 'top 10%',
        end: 'bottom 10%',
        onToggle: (self) => self.isActive && setActive(id),
      })
    })
    return () => triggers.forEach((t) => t.kill())
    // Re-created once the sections below the hero are in the page.
  }, [sectionsReady])

  const go = async (id: string) => {
    setOpen(false)
    // Clicked before the sections below the hero have loaded: wait for them, then scroll.
    if (!document.getElementById(id) && id !== 'home') await whenSectionsReady()
    const el = document.getElementById(id)
    if (!el) return
    const y = id === 'home' ? 0 : el.getBoundingClientRect().top + window.scrollY
    gsap.to(window, { scrollTo: { y, autoKill: true }, duration: reduced ? 0 : 1.4, ease: 'power2.inOut' })
  }

  const next = theme === 'dark' ? 'light' : 'dark'
  // CMS (site_settings.appearance.allowThemeToggle); shown unless switched off there.
  const showToggle = siteAppearance().allowThemeToggle

  return (
    <header className={`site-nav${open ? ' is-open' : ''}`}>
      <nav aria-label="Primary">
        <ul className="site-nav__links" id="site-nav-links">
          {navItems.map(({ id, label }) => (
            <li key={id}>
              <a
                href={`#${id}`}
                aria-current={active === id ? 'location' : undefined}
                onClick={(e) => {
                  e.preventDefault()
                  void go(id)
                }}
              >
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {showToggle && <span className="site-nav__rule" aria-hidden="true" />}

      {showToggle && (
        <button
          type="button"
          className="theme-toggle"
          role="switch"
          aria-checked={theme === 'light'}
          aria-label={`Switch to ${next} theme`}
          onClick={() => transitionToTheme(next)}
        >
          <span className="theme-toggle__knob">
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" fill="currentColor" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
                <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
              </svg>
            )}
          </span>
        </button>
      )}

      <button
        type="button"
        className="site-nav__menu"
        aria-expanded={open}
        aria-controls="site-nav-links"
        aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen((o) => !o)}
      >
        <span />
        <span />
      </button>
    </header>
  )
}
