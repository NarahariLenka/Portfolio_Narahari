import { useSyncExternalStore } from 'react'
import { themes, type ThemeName } from '../config/themes'

const TRANSITION_MS = 700

/**
 * The theme the page was painted in by index.html's inline script: dark, or light when the
 * published default theme is light (remembered from the previous visit). main.tsx then
 * applies the current published default before anything renders. The visitor's own toggle
 * choice is never remembered (every visit opens in the default theme).
 */
function initialTheme(): ThemeName {
  return typeof document !== 'undefined' && document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

let current: ThemeName = initialTheme()
const listeners = new Set<() => void>()

function apply(theme: ThemeName) {
  const root = document.documentElement
  root.dataset.theme = theme
  for (const [name, value] of Object.entries(themes[theme].css)) root.style.setProperty(name, value)
  root.style.background = themes[theme].css['--bg']
}
apply(current)

let transitionTimer = 0
let snapScenes = false

export interface SetThemeOptions {
  /** Ease colours across the page (default true). The fluid transition turns this off. */
  fade?: boolean
  /** WebGL scenes jump to the new theme instead of easing (used by the fluid transition). */
  snapScenes?: boolean
}

/** True while the latest theme change asked the WebGL scenes to switch instantly. */
export function themeSnapsScenes() {
  return snapScenes
}

export function getTheme() {
  return current
}

export function setTheme(theme: ThemeName, { fade = true, snapScenes: snap = false }: SetThemeOptions = {}) {
  if (theme === current) return
  const root = document.documentElement
  snapScenes = snap
  // Colours ease across the whole page for the duration of the switch only.
  clearTimeout(transitionTimer)
  if (fade) {
    root.classList.add('theme-transition')
    transitionTimer = window.setTimeout(() => root.classList.remove('theme-transition'), TRANSITION_MS)
  } else root.classList.remove('theme-transition')
  current = theme
  apply(theme)
  listeners.forEach((l) => l())
}

export function subscribeTheme(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useTheme() {
  return useSyncExternalStore(subscribeTheme, getTheme)
}
