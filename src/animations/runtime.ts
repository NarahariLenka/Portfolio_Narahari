/**
 * Animation Registry — runtime: the loaded CMS config, failure isolation, the
 * useAnimation() hook. The error boundary is in AnimationBoundary.tsx.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { remoteContent } from '../data/remote'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { MOBILE_QUERY, useResponsive } from '../hooks/useResponsive'
import { parseAnimationConfig, resolveAnimation, type AnimationConfig } from './config'
import { getAnimation, listAnimations } from './registry'
import { own } from './values'
import type { Device, ParamSchema, ResolvedAnimation } from './types'

// ---------------------------------------------------------------------------- config

let config: AnimationConfig | null = null
const configListeners = new Set<() => void>()

/**
 * The validated CMS animation settings, parsed once (after the registry is filled).
 * site_settings.animation exists only after migration 003, so it is read defensively.
 */
export function animationConfig(): AnimationConfig {
  if (!config) {
    const raw = (remoteContent()?.settings as { animation?: unknown } | null | undefined)?.animation
    const { config: parsed, issues } = parseAnimationConfig(raw)
    if (issues.length) console.warn(`[animations] CMS settings corrected: ${issues.join('; ')}`)
    config = parsed
  }
  return config
}

/**
 * Replaces the animation settings for the rest of the visit (validated exactly like the
 * CMS value; never throws) and notifies non-React subscribers. For a future admin live
 * preview and for tests — the public site sets its config once, from Supabase.
 * Components using useAnimation() keep their values until they next re-resolve (device,
 * motion preference or failure change); live re-rendering them is not part of this.
 * Returns the validation notes.
 */
export function setAnimationConfig(raw: unknown): string[] {
  const { config: parsed, issues } = parseAnimationConfig(raw)
  config = parsed
  configListeners.forEach((l) => l())
  return issues
}

/** Called after setAnimationConfig() replaced the settings. Returns an unsubscribe function. */
export function subscribeAnimationConfig(listener: () => void) {
  configListeners.add(listener)
  return () => {
    configListeners.delete(listener)
  }
}

/** The visitor's device class, using the same breakpoint as useResponsive(). */
export function currentDevice(): Device {
  return typeof window !== 'undefined' && window.matchMedia?.(MOBILE_QUERY).matches ? 'mobile' : 'desktop'
}

/**
 * Non-React access to an animation's resolved settings (for plain functions such as the
 * theme transition, which must not call hooks). Same rules as useAnimation(): CMS values
 * validated against the registry, device values, global multipliers, reduced motion, and
 * failures. Unknown ids resolve to inactive.
 */
export function getAnimationSettings<S extends ParamSchema = ParamSchema>(
  id: string,
  opts: { device?: Device; prefersReduced?: boolean } = {},
): ResolvedAnimation<S> {
  const def = getAnimation(id)
  if (!def) {
    console.error(`[animations] "${id}" is not registered`)
    return inactive(id) as ResolvedAnimation<S>
  }
  const prefersReduced = opts.prefersReduced ?? (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)
  return resolveAnimation(def, animationConfig(), opts.device ?? currentDevice(), prefersReduced, failed.has(id)) as ResolvedAnimation<S>
}

/**
 * True if at least one layer animation is switched on in the CMS (or by default). When
 * false, the layer host is neither loaded nor mounted. Device and reduced-motion rules
 * are applied later by each layer itself.
 */
export function anyLayerEnabled(): boolean {
  const cfg = animationConfig()
  if (!cfg.global.enabled) return false
  return listAnimations().some((def) => {
    if (def.kind !== 'layer' || !def.load) return false
    const enabled = (own(cfg.animations, def.id) as { enabled?: boolean } | undefined)?.enabled
    return enabled ?? def.defaultEnabled
  })
}

// ---------------------------------------------------------------------------- failures

const failed = new Set<string>()
const listeners = new Set<() => void>()
let failedVersion = 0

/**
 * Marks an animation as failed for the rest of the visit: it is switched off and
 * everything else keeps running. Safe to call more than once.
 */
export function reportAnimationError(id: string, error: unknown) {
  if (failed.has(id)) return
  failed.add(id)
  failedVersion++
  console.error(`[animations] "${id}" failed and was switched off:`, error)
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}
const getFailedVersion = () => failedVersion

/** Runs an animation's setup code; on error reports it and returns undefined. */
export function guardAnimation<T>(id: string, setup: () => T): T | undefined {
  try {
    return setup()
  } catch (error) {
    reportAnimationError(id, error)
    return undefined
  }
}

// ---------------------------------------------------------------------------- hook

const inactive = (id: string): ResolvedAnimation => ({
  id, active: false, params: {}, device: 'desktop', reducedMotion: false, mode: 'off', placement: null, sections: [],
})

/**
 * Live settings for a registered animation on this device. Re-resolves when the
 * viewport crosses the mobile breakpoint, the motion preference changes, or the
 * animation fails. Unknown ids resolve to inactive.
 */
export function useAnimation<S extends ParamSchema = ParamSchema>(id: string): ResolvedAnimation<S> {
  const { isMobile } = useResponsive()
  const reduced = useReducedMotion()
  const version = useSyncExternalStore(subscribe, getFailedVersion)
  return useMemo(() => {
    const def = getAnimation(id)
    if (!def) {
      console.error(`[animations] "${id}" is not registered`)
      return inactive(id) as ResolvedAnimation<S>
    }
    return resolveAnimation(def, animationConfig(), isMobile ? 'mobile' : 'desktop', reduced, failed.has(id)) as ResolvedAnimation<S>
    // `version` re-runs this when any animation fails.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isMobile, reduced, version])
}
