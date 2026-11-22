/**
 * TEMPLATE — not registered. Copy this folder to modules/<yourId>/, rename, then add the
 * definition to modules/index.ts. Delete nothing else; no other file needs changes.
 */
import { defineAnimation } from '../../registry'
import { params } from './params'

export const templateAnimation = defineAnimation({
  id: 'templateAnimation', // unique, camelCase, never renamed once used in the CMS
  name: 'Template animation',
  description: 'What it looks like, in one sentence (shown in the admin).',
  kind: 'layer',
  sections: ['contact'], // where it may appear ([] for page-level only)
  placements: ['section-overlay', 'page-overlay'], // first = default
  defaultEnabled: false, // new animations start off until switched on in the CMS
  defaultDevices: { desktop: true, mobile: false },
  reducedMotion: { default: 'off', allowed: ['off', 'static', 'reduced'] },
  params,
  deviceDefaults: { mobile: { density: 60 } },
  reducedParams: { speed: 0.3, density: 40 },
  load: () => import('./Component'),
})
