/**
 * Error boundaries for the portfolio.
 *
 *   <SafeBoundary name="about">  — around each section / effect. If it throws while
 *       rendering, only that part disappears (logged as "[app] … failed"); the rest of
 *       the page keeps working. Renders no extra DOM, so layout is unchanged.
 *   <RootErrorBoundary>          — last line of defence around the whole app: shows a
 *       simple fallback instead of a blank page.
 */
import { Component, type ReactNode } from 'react'

interface SafeProps {
  name: string
  children: ReactNode
  fallback?: ReactNode
}

export class SafeBoundary extends Component<SafeProps, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error(`[app] "${this.props.name}" failed and was hidden:`, error)
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}

/** Plain, dependency-free fallback (no data modules, no theme store — they may be the cause). */
export function RootFallback() {
  return (
    <div
      role="alert"
      style={{
        position: 'fixed',
        inset: 0,
        display: 'grid',
        placeItems: 'center',
        padding: '1.5rem',
        background: '#05050b',
        color: '#ece8f6',
        fontFamily: '"Space Grotesk", Inter, system-ui, sans-serif',
        textAlign: 'center',
      }}
    >
      <div style={{ maxWidth: '28rem' }}>
        <p style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</p>
        <p style={{ margin: '0 0 1.5rem', opacity: 0.7, lineHeight: 1.5 }}>The page couldn&rsquo;t be displayed. Please reload to try again.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{
            font: 'inherit',
            padding: '0.6rem 1.4rem',
            borderRadius: '999px',
            border: '1px solid rgb(236 232 246 / 0.35)',
            background: 'transparent',
            color: 'inherit',
            cursor: 'pointer',
          }}
        >
          Reload
        </button>
      </div>
    </div>
  )
}

export class RootErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    console.error('[app] the page failed to render:', error)
  }
  render() {
    return this.state.failed ? <RootFallback /> : this.props.children
  }
}
