/**
 * Local preview of the theme ink transition with the unsaved settings.
 *
 * Runs the real transition (src/lib/themeTransition.ts) in this tab only: the draft is
 * applied with setAnimationConfig() and a full-screen stage covers the admin panel, so the
 * transition's snapshot shows the stage, not the admin. Nothing is written to Supabase.
 * Closing (or discarding, saving, leaving, signing out) restores the dark theme and the
 * default animation settings of this tab.
 *
 * Honest limits: the device is simulated by copying the chosen device's values onto this
 * screen's device; reduced motion is not simulated (it follows this device's setting).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { currentDevice, getAnimationSettings, setAnimationConfig } from '../../animations'
import type { Device } from '../../animations'
import { THEME_INK_ID, inkSettingsFrom } from '../../lib/themeInkSettings'
import { getTheme, setTheme, useTheme } from '../../theme/themeStore'
import { activePreview, startPreview, stopPreview, subscribePreview } from '../settings/preview'
import { previewConfig } from './animationModel'

const PREVIEW_ID = 'themeInkTransition'

export default function InkPreviewStage({ animation, onClose }: { animation: unknown; onClose: () => void }) {
  const actual = currentDevice()
  const [as, setAs] = useState<Device>(actual)
  const [running, setRunning] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const theme = useTheme()
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const active = useSyncExternalStore(subscribePreview, activePreview)
  const closeButton = useRef<HTMLButtonElement>(null)
  const timer = useRef(0)
  const started = useRef(false)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  // Apply the draft for as long as the stage is open (after it is on screen, so the
  // pattern is prepared for the stage's toggle). Re-applied when the device choice changes.
  useEffect(() => {
    try {
      startPreview(
        PREVIEW_ID,
        () => setAnimationConfig(previewConfig(animation, THEME_INK_ID, as, actual)),
        () => {
          setTheme('dark', { fade: false })
          setAnimationConfig(undefined)
        },
      )
      started.current = true
    } catch (error) {
      // startPreview already undid it; nothing temporary is left active.
      console.warn('[admin] preview could not start', error)
      closeRef.current()
    }
  }, [animation, as, actual])

  // Close if the preview was stopped elsewhere (discard, save, leaving the section, sign-out).
  useEffect(() => {
    // Reads the live value: `active` from this render can be stale right after starting.
    if (started.current && activePreview() !== PREVIEW_ID) closeRef.current()
  }, [active])

  // Load the transition as soon as the stage is open: it then prepares the ink pattern for
  // the stage's switch in the background, so the first press starts at once (as on the site).
  useEffect(() => {
    import('../../lib/themeTransition').catch(() => setProblem('The transition couldn’t be loaded.'))
  }, [])

  useEffect(() => {
    closeButton.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !running && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(
    () => () => {
      window.clearTimeout(timer.current)
      stopPreview(PREVIEW_ID)
    },
    [],
  )

  function close() {
    stopPreview(PREVIEW_ID)
    onClose()
  }

  async function toggle() {
    if (running) return
    setProblem(null)
    const next = getTheme() === 'dark' ? 'light' : 'dark'
    const resolved = getAnimationSettings(THEME_INK_ID)
    const ms = resolved.active ? inkSettingsFrom(resolved.params).durationMs : 700
    setRunning(true)
    try {
      // Loaded only when a preview runs, so the admin panel doesn't prepare patterns otherwise.
      const { transitionToTheme } = await import('../../lib/themeTransition')
      await transitionToTheme(next)
    } catch {
      setProblem('The transition couldn’t run in this browser.')
    }
    timer.current = window.setTimeout(() => setRunning(false), ms + 400)
  }

  const deviceNote =
    as === actual ? `Showing ${as} values on this ${actual} screen.` : `Simulated: ${as} values shown on this ${actual} screen (not a real ${as} device).`

  return createPortal(
    <div className="adm-stage" role="dialog" aria-modal="true" aria-label="Theme ink transition preview">
      <div className="adm-stage__bar">
        <button ref={closeButton} type="button" className="adm-stage__btn" onClick={close} disabled={running}>
          Close preview
        </button>
        <span className="adm-stage__note">Local preview · unsaved settings · nothing is published</span>
        <button
          type="button"
          className="theme-toggle adm-stage__toggle"
          role="switch"
          aria-checked={theme === 'light'}
          onClick={() => void toggle()}
          disabled={running}
        >
          Switch to {theme === 'dark' ? 'light' : 'dark'}
        </button>
      </div>
      <div className="adm-stage__content">
        <p className="adm-stage__eyebrow">Theme preview</p>
        <h2 className="adm-stage__title">Press the switch at the top right</h2>
        <p className="adm-stage__text">
          The ink spreads from the switch exactly as on the site, using the values you are editing. Press it again to switch back.
        </p>
        <fieldset className="adm-stage__devices" disabled={running}>
          <legend>Values to preview</legend>
          {(['desktop', 'mobile'] as const).map((d) => (
            <label key={d}>
              <input type="radio" name="ink-device" checked={as === d} onChange={() => setAs(d)} /> {d === 'desktop' ? 'Desktop' : 'Mobile'}
            </label>
          ))}
        </fieldset>
        <p className="adm-stage__small">{deviceNote}</p>
        <p className="adm-stage__small">
          {reduced
            ? 'This device asks for reduced motion, so you see the reduced-motion behaviour (as visitors with this setting would).'
            : 'Reduced-motion behaviour is not simulated here; turn on reduced motion in your system settings to see it.'}
        </p>
        {problem && (
          <p className="adm-stage__small" role="alert">
            {problem}
          </p>
        )}
      </div>
    </div>,
    document.body,
  )
}
