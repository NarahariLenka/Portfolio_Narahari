import { Component, type ReactNode } from 'react'
import { reportAnimationError } from './runtime'

interface BoundaryProps {
  id: string
  children: ReactNode
  /** Shown instead of a failed animation (default: nothing). */
  fallback?: ReactNode
}

/** Contains a crashing animation: it disappears, the page and other animations stay. */
export default class AnimationBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error: unknown) {
    reportAnimationError(this.props.id, error)
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children
  }
}
