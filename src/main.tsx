import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import './index.css'
import { getTheme, setTheme } from './theme/themeStore'
import './contentErrors'
import { setRemoteContent } from './data/remote'
import { RootErrorBoundary, RootFallback } from './components/ErrorBoundary/ErrorBoundary'
import { isAdminRoute } from './admin/route'
import { siteAppearance } from './config/appearanceRuntime'
import { rememberDefaultTheme } from './data/contentCache'

/**
 * Font budget, measured from navigation start (fonts are self-hosted and preloaded, so this
 * is only a safety cap). The content budget is chosen in remoteLoader.ts.
 */
const FONT_DEADLINE_MS = 1500

const sleepUntil = (t: number) => new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, t - performance.now())))

/**
 * Waits (until the deadline at most) for the self-hosted face the first screen uses
 * (src/fonts.css; its Latin file is preloaded by index.html), so the first render
 * already has the real fonts in the normal case (no font swap, no re-measured layout).
 * Never throws.
 */
function waitForFonts(deadline: number): Promise<void> {
  if (!document.fonts?.load) return Promise.resolve()
  // The first screen (hero name, greeting, menu) uses Space Grotesk only; Inter is the body
  // font of the sections below and loads as soon as their text needs it.
  const faces = document.fonts.load('500 1em "Space Grotesk"').then(() => undefined)
  return Promise.race([faces.catch(() => undefined), sleepUntil(deadline)])
}

/**
 * Published CMS content is fetched first (bounded by a timeout, falling back to the local
 * JSON on any failure), and only then is the app imported. Every data module therefore
 * builds its exports from final content before any component calculates layout.
 */
async function boot() {
  // Entering or leaving /#admin by editing the address swaps apps: reload into the other one.
  const admin = isAdminRoute()
  window.addEventListener('hashchange', () => {
    if (isAdminRoute() !== admin) window.location.reload()
  })
  if (admin) return bootAdmin()

  // Content and fonts load in parallel; the app's code is already downloading too
  // (modulepreload links added at build time), so waiting costs only the slowest of them.
  const fonts = waitForFonts(FONT_DEADLINE_MS)
  let loaded = false
  try {
    const { loadRemoteContent } = await import('./data/remoteLoader')
    const { content } = await loadRemoteContent()
    setRemoteContent(content)
    loaded = content !== null
  } catch (error) {
    console.warn('[cms] content loader failed, using local content', error)
    setRemoteContent(null)
  }
  await fonts
  // The theme a visit opens in (site_settings.appearance.defaultTheme; dark unless set),
  // applied before anything renders so every component and scene starts in it.
  try {
    const initial = siteAppearance().defaultTheme
    if (initial !== getTheme()) setTheme(initial, { fade: false })
    // Remembered so the next visit's first paint (index.html) already uses it. Only from
    // real published settings: a fallback to local content must not reset it.
    if (loaded) rememberDefaultTheme(initial)
  } catch (error) {
    console.warn('[cms] appearance settings ignored', error)
  }
  const root = createRoot(document.getElementById('root')!)
  try {
    const { default: App } = await import('./App.tsx')
    root.render(
      <StrictMode>
        <RootErrorBoundary>
          <App />
        </RootErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    // The app's code itself failed to load or evaluate (e.g. a broken network chunk).
    console.error('[app] failed to start:', error)
    root.render(<RootFallback />)
  }
}

/**
 * CMS admin panel (/#admin): its own lazily loaded chunk. The portfolio, its 3D scenes and
 * the published-content request are never loaded on this route.
 */
async function bootAdmin() {
  const root = createRoot(document.getElementById('root')!)
  try {
    const { default: AdminApp } = await import('./admin/AdminApp.tsx')
    root.render(
      <StrictMode>
        <RootErrorBoundary>
          <AdminApp />
        </RootErrorBoundary>
      </StrictMode>,
    )
  } catch (error) {
    console.error('[admin] failed to start:', error)
    root.render(<RootFallback />)
  }
}

void boot()
