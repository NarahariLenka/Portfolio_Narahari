/**
 * "The sections below the hero are in the page" — set by BelowFold.tsx after it mounts.
 * The hero and navigation render first; About…Contact arrive moments later (their own
 * chunk). Anything that needs those sections' DOM (navigation's active-section tracking,
 * a menu click made before they loaded) waits for this.
 */
import { useSyncExternalStore } from 'react'

let ready = false
const listeners = new Set<() => void>()
let resolveReady: () => void = () => {}
const readyPromise = new Promise<void>((resolve) => (resolveReady = resolve))

export function markSectionsReady() {
  if (ready) return
  ready = true
  resolveReady()
  listeners.forEach((l) => l())
}

export const sectionsReady = () => ready
export const whenSectionsReady = () => readyPromise

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

export function useSectionsReady(): boolean {
  return useSyncExternalStore(subscribe, sectionsReady, () => false)
}
