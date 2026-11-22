import { lazy, Suspense, useEffect, useState } from 'react'
import { anyLayerEnabled } from './animations' // importing registers every animation before the page renders
import { SafeBoundary } from './components/ErrorBoundary/ErrorBoundary'
import Footer from './components/Footer/Footer'
import Hero from './components/Hero/Hero'
import Navigation from './components/Navigation/Navigation'
import { useScrollSequence } from './hooks/useScrollSequence'

// three.js is the heaviest dependency: keep it out of the initial bundle.
const loadCosmicBackground = () => import('./components/3d/CosmicBackground/CosmicBackground')
const CosmicBackground = lazy(loadCosmicBackground)
// Registry layer animations: only loaded and mounted when at least one is switched on.
const AnimationLayers = lazy(() => import('./animations/AnimationLayers'))
const hasLayers = anyLayerEnabled()
// Bottom-right sling that fires shooting stars; loaded after the page.
const ShootingStarLauncher = lazy(() => import('./components/ShootingStar/ShootingStarLauncher'))

/**
 * The sling is loaded once the 3D background's code has arrived (or after 6 s at most), at
 * an idle moment — so on slow connections it doesn't compete with the background download.
 */
function useSlingReady() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    const idle = (cb: () => void) => (typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(cb, { timeout: 2000 }) : window.setTimeout(cb, 300))
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 6000))
    Promise.race([loadCosmicBackground().catch(() => undefined), timeout]).then(() => idle(() => !cancelled && setReady(true)))
    return () => {
      cancelled = true
    }
  }, [])
  return ready
}

// About → Contact: their own chunk, requested right after the first render (hero first).
const loadBelowFold = () => import('./BelowFold')
const BelowFold = lazy(loadBelowFold)
// A second lazy component for the in-page retry (React.lazy caches a failed import).
const BelowFoldRetry = lazy(() => loadBelowFold())

/**
 * The sections below the hero. While their chunk loads, a one-screen placeholder keeps the
 * footer below the fold; if it fails to load, a retry message replaces it (the hero and the
 * navigation keep working).
 */
function BelowFoldSections() {
  const [attempt, setAttempt] = useState(0)
  const Sections = attempt ? BelowFoldRetry : BelowFold
  const placeholder = <div className="sections-pending" aria-hidden="true" />
  return (
    <SafeBoundary
      key={attempt}
      name="sections"
      fallback={
        <div className="sections-pending sections-pending--failed" role="alert">
          <p>The rest of the page couldn’t be loaded.</p>
          {/* Browsers may remember a failed module download, so a repeated failure reloads. */}
          <button type="button" onClick={() => (attempt ? window.location.reload() : setAttempt((a) => a + 1))}>
            {attempt ? 'Reload the page' : 'Try again'}
          </button>
        </div>
      }
    >
      <Suspense fallback={placeholder}>
        <Sections />
      </Suspense>
    </SafeBoundary>
  )
}

const pageY = (el: Element) => el.getBoundingClientRect().top + window.scrollY

/**
 * Projects → Certificates play as a sequence: each project centred in turn, then the
 * certificate gallery, then on to Contact. Fast flicks step one stop at a time.
 */
function measureWorkSequence() {
  const projects = document.querySelector('.projects')
  const header = document.querySelector('.certs__header')
  const list = document.querySelector('.certs__list')
  const contact = document.querySelector('.contact')
  if (!projects || !header || !list || !contact) return null

  const vh = window.innerHeight
  const max = document.documentElement.scrollHeight - vh
  const clamp = (y: number) => Math.round(Math.min(max, Math.max(0, y)))

  const stops = [...document.querySelectorAll('.project')].map((p) => {
    const r = p.getBoundingClientRect()
    return clamp(pageY(p) + r.height / 2 - vh / 2)
  })

  // Certificates: label and gallery framed together (centred when they fit).
  const top = pageY(header)
  const block = pageY(list) + list.getBoundingClientRect().height - top
  stops.push(clamp(block < vh ? top - (vh - block) / 2 : top - vh * 0.08))

  return { entry: clamp(pageY(projects) - vh), stops, exit: clamp(pageY(contact)) }
}

function App() {
  useScrollSequence(measureWorkSequence)
  const slingReady = useSlingReady()

  return (
    <>
      {/* Each part is isolated: if one throws while rendering, only it disappears. */}
      <SafeBoundary name="background">
        <Suspense fallback={null}>
          <CosmicBackground />
        </Suspense>
      </SafeBoundary>
      <SafeBoundary name="navigation">
        <Navigation />
      </SafeBoundary>
      <main className="site-shell">
        {/* Fixed order (scroll animations depend on it); published sections can be hidden. */}
        <SafeBoundary name="home">
          <Hero />
        </SafeBoundary>
        <BelowFoldSections />
      </main>
      <SafeBoundary name="footer">
        <Footer />
      </SafeBoundary>
      <SafeBoundary name="shootingStar">
        {slingReady && (
          <Suspense fallback={null}>
            <ShootingStarLauncher />
          </Suspense>
        )}
      </SafeBoundary>
      {hasLayers && (
        <SafeBoundary name="animationLayers">
          <Suspense fallback={null}>
            <AnimationLayers />
          </Suspense>
        </SafeBoundary>
      )}
    </>
  )
}

export default App
