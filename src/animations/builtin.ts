/**
 * The portfolio's existing effects, registered so the CMS knows about them.
 *
 * Their code stays where it is (Three.js / R3F, GSAP, motion, canvas). Defaults equal
 * today's hard-coded values, so with no CMS settings nothing changes.
 *
 * managed: true  — the component reads useAnimation(id): the admin can switch it off and
 *                  tune the listed parameters.
 * managed: false — registered (listed in the admin as "always on") but the component
 *                  doesn't read settings yet; wiring it later is a component-only change.
 */
import { THEME_INK_ID, THEME_INK_PARAMS } from '../lib/themeInkSettings'
import { defineAnimation } from './registry'

export const contactDotField = defineAnimation({
  id: 'contactDotField',
  name: 'Contact dot field',
  description: 'Dot grid behind the Contact section that bulges around the cursor.',
  kind: 'builtin',
  managed: true,
  sections: ['contact'],
  defaultEnabled: true,
  reducedMotion: { default: 'static', allowed: ['static', 'off'] },
  params: {
    dotSpacing: { kind: 'number', label: 'Dot spacing', min: 8, max: 40, step: 1, default: 14, unit: 'px', help: 'Lower = denser grid.' },
    dotRadius: { kind: 'number', label: 'Dot size', min: 0.5, max: 4, step: 0.1, default: 1.5, unit: 'px' },
    bulgeStrength: { kind: 'number', label: 'Bulge strength', min: 0, max: 150, step: 1, default: 67, scale: 'intensity' },
    cursorRadius: { kind: 'number', label: 'Cursor reach', min: 100, max: 1000, step: 10, default: 500, unit: 'px' },
    glowRadius: { kind: 'number', label: 'Glow size', min: 0, max: 400, step: 10, default: 160, unit: 'px' },
  },
})

export const projectsTilt = defineAnimation({
  id: 'projectsTilt',
  name: 'Project card tilt',
  description: 'Project screenshots tilt toward the pointer (mouse / trackpad only).',
  kind: 'builtin',
  managed: true,
  sections: ['projects'],
  defaultEnabled: true,
  reducedMotion: { default: 'off', allowed: ['off'] },
  params: {
    tilt: { kind: 'number', label: 'Tilt angle', min: 0, max: 6, step: 0.5, default: 4, unit: '°', scale: 'intensity', help: 'Above ~6° the card edge can flicker under the pointer.' },
    depth: { kind: 'number', label: 'Parallax depth', min: 0, max: 30, step: 1, default: 10, unit: 'px', scale: 'intensity' },
    duration: { kind: 'number', label: 'Easing time', min: 0.2, max: 2, step: 0.1, default: 0.8, unit: 's', scale: 'duration' },
  },
})

export const shootingStar = defineAnimation({
  id: 'shootingStar',
  name: 'Shooting-star sling',
  description: 'Bottom-right sling that launches shooting stars.',
  kind: 'builtin',
  managed: true,
  sections: [],
  defaultEnabled: true,
  // Today: the sling stays visible for reduced motion but launches nothing.
  reducedMotion: { default: 'static', allowed: ['static', 'off'] },
  params: {},
})

/**
 * The theme switch's marbled ink transition (src/lib/themeTransition.ts). Its parameter
 * specs live next to the transition (src/lib/themeInkSettings.ts) so the transition and
 * the CMS share one set of defaults and ranges.
 *   off / not on this device / failed → the existing page-wide colour fade
 *   reduced motion "static"           → 150 ms crossfade (as before CMS support)
 *   reduced motion "off"              → instant switch, no animation
 */
export const themeInkTransition = defineAnimation({
  id: THEME_INK_ID,
  name: 'Theme ink transition',
  description: 'Marbled ink that spreads from the theme toggle when the theme is switched.',
  kind: 'builtin',
  managed: true,
  sections: [],
  defaultEnabled: true,
  reducedMotion: { default: 'static', allowed: ['static', 'off'] },
  params: THEME_INK_PARAMS,
})

// Registered, not yet wired (always on, controls hidden in the admin).
const fixed = (id: string, name: string, description: string, sections: ('home' | 'about' | 'skills' | 'projects' | 'certificates' | 'contact')[]) =>
  defineAnimation({
    id, name, description, sections, kind: 'builtin', managed: false, defaultEnabled: true,
    reducedMotion: { default: 'static', allowed: ['static'] }, params: {},
  })

export const BUILTIN_ANIMATIONS = [
  fixed('heroScrollTravel', 'Hero scroll travel', 'Portrait and name travel left → centre → right on scroll.', ['home']),
  fixed('aboutReveal', 'About word reveal', 'About text reveals word by word on scroll.', ['about']),
  fixed('skillsSpiral', 'Skills particle spiral', 'Three.js particle helix that turns through the skills.', ['skills']),
  fixed('projectsReveal', 'Project entrance', 'Project cards and titles reveal as they enter.', ['projects']),
  projectsTilt,
  fixed('certificatesReveal', 'Certificates entrance', 'Certificate panels reveal as the gallery enters.', ['certificates']),
  fixed('contactSplitFlap', 'Contact split-flap', 'Split-flap headline in the Contact section.', ['contact']),
  contactDotField,
  shootingStar,
  themeInkTransition,
] as const
