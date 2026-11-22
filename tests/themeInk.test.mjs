/**
 * Theme ink transition — settings (pure logic). Run: npm test
 * The DOM-level fallback behaviour is in themeInkTransition.test.mjs.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let A, S, C
before(async () => {
  ;[A, S, C] = await loadModules(['/src/animations/index.ts', '/src/lib/themeInkSettings.ts', '/src/animations/config.ts'])
})
after(closeModules)

const ID = 'themeInkTransition'
const P = (raw) => A.parseAnimationConfig(raw).config
const resolve = (cfg = A.DEFAULT_ANIMATION_CONFIG, device = 'desktop', reduced = false, failed = false) =>
  C.resolveAnimation(A.getAnimation(ID), cfg, device, reduced, failed)
const mode = (resolved, { vt = true, reduced = false } = {}) => S.chooseInkMode({ viewTransitions: vt, prefersReduced: reduced, resolved })

/** The transition's values before CMS support (must never change by accident). */
const ORIGINAL_FIELD = {
  planar: 0.65, calm: 0.2, lobes: 0.17, lobeScale: 2.6, marbleMix: 0.22, marbleScale: 2.6,
  marbleWarp: 1.2, radialStretch: 1.0, spikes: 0.04, spikeFreq: 10, spikeReach: 0.12,
}
const originalEasing = (t) => Math.min(1, 0.18 * (1 - Math.exp(-20 * t)) + 0.82 * t ** 1.1)

describe('defaults = the transition before CMS support', () => {
  test('registered as a configurable builtin with the approved controls', () => {
    const def = A.getAnimation(ID)
    assert.ok(def)
    assert.equal(def.kind, 'builtin')
    assert.equal(A.isConfigurable(def), true)
    assert.deepEqual(def.sections, [])
    assert.deepEqual(def.reducedMotion, { default: 'static', allowed: ['static', 'off'] })
    assert.deepEqual(Object.fromEntries(Object.entries(def.params).map(([k, s]) => [k, s.default])), {
      durationMs: 2200, openingSplash: 0.18, straightness: 0.65, raggedness: 0.17, edgeWidth: 0.22,
      chunkSize: 2.6, swirl: 1.2, crownSpikes: 0.04, edgeCrispness: 90, fixedPattern: false,
    })
    const ranges = Object.fromEntries(Object.entries(def.params).filter(([, s]) => s.kind === 'number').map(([k, s]) => [k, [s.min, s.max, s.step]]))
    assert.deepEqual(ranges, {
      durationMs: [1200, 3000, 100], openingSplash: [0, 0.3, 0.01], straightness: [0, 1, 0.05], raggedness: [0.05, 0.25, 0.01],
      edgeWidth: [0.1, 0.35, 0.01], chunkSize: [1.5, 4, 0.1], swirl: [0.5, 2.5, 0.1], crownSpikes: [0, 0.08, 0.01], edgeCrispness: [40, 110, 5],
    })
    assert.deepEqual(A.sanitizeDefinition(def).warnings, [])
  })

  test('empty / missing CMS settings give exactly the original values', () => {
    for (const raw of [undefined, null, {}, { animations: {} }, 'garbage', []]) {
      const r = resolve(P(raw))
      assert.equal(r.active, true)
      assert.equal(mode(r), 'ink')
      const ink = S.inkSettingsFrom(r.params)
      assert.deepEqual(ink.field, ORIGINAL_FIELD)
      assert.equal(ink.durationMs, 2200)
      assert.equal(ink.openingSplash, 0.18)
      assert.equal(ink.sharpness, 90)
      assert.equal(ink.fixedPattern, false)
      assert.equal(ink.key, S.DEFAULT_INK_SETTINGS.key)
    }
  })

  test('easing, mask slope and seeds are unchanged', () => {
    // Same curve; (1 − 0.18) vs 0.82 differs only by float rounding (~1e-17).
    for (let t = 0; t <= 1.0001; t += 0.05) assert.ok(Math.abs(S.inkEasing(t, 0.18) - originalEasing(t)) < 1e-12, `t=${t}`)
    const { slope, toStored } = S.inkMath(S.DEFAULT_INK_SETTINGS)
    const spread = 0.17 + 0.22 + 0.04
    assert.equal(slope, 90 * (1 + 2 * spread))
    assert.equal(toStored(0), spread / (1 + 2 * spread))
    for (const runs of [0, 1, 5]) assert.equal(S.inkSeed(runs, false), 17 + (runs + 1) * 101)
    assert.equal(S.inkSeed(7, true), S.inkSeed(0, false), 'fixed pattern = the first switch pattern')
  })
})

describe('invalid values', () => {
  test('CMS values are clamped, rounded or dropped by the registry parser', () => {
    const { config, issues } = A.parseAnimationConfig({ animations: { [ID]: {
      desktop: { durationMs: 99999, straightness: -3, chunkSize: 2.63, swirl: 'x', fixedPattern: 'yes', evil: 'alert(1)', constructor: 1 },
      mobile: { edgeCrispness: Number.NaN, crownSpikes: Infinity },
      reducedMotion: 'full',
    } } })
    assert.deepEqual(config.animations[ID], { desktop: { durationMs: 3000, straightness: 0, chunkSize: 2.6 } })
    assert.ok(issues.some((i) => i.includes('swirl') && i.includes('fixedPattern') && i.includes('evil') && i.includes('constructor')))
    assert.ok(issues.some((i) => i.includes('reduced-motion')))
  })

  test('inkSettingsFrom is safe on its own (unvalidated input never reaches the worker)', () => {
    const ink = S.inkSettingsFrom({ durationMs: Infinity, straightness: -5, raggedness: 9, swirl: '2', fixedPattern: 'yes', edgeCrispness: 1e9 })
    assert.equal(ink.durationMs, 2200)
    assert.equal(ink.field.planar, 0)
    assert.equal(ink.field.lobes, 0.25)
    assert.equal(ink.field.marbleWarp, 1.2)
    assert.equal(ink.fixedPattern, false)
    assert.equal(ink.sharpness, 110)
    for (const bad of [null, undefined, 42, 'x', [], Object.create({ durationMs: 1500 })]) assert.deepEqual(S.inkSettingsFrom(bad), S.DEFAULT_INK_SETTINGS)
  })
})

describe('disabled state and modes', () => {
  test('switched off, wrong device, master switch off or failed → colour fade', () => {
    assert.equal(mode(resolve(P({ animations: { [ID]: { enabled: false } } }))), 'fade')
    assert.equal(mode(resolve(P({ animations: { [ID]: { devices: { mobile: false } } } }), 'mobile')), 'fade')
    assert.equal(mode(resolve(P({ animations: { [ID]: { devices: { mobile: false } } } }), 'desktop')), 'ink')
    assert.equal(mode(resolve(P({ global: { enabled: false } }))), 'fade')
    assert.equal(mode(resolve(undefined, 'desktop', false, true)), 'fade')
    assert.equal(mode(null), 'fade', 'unreadable settings')
  })

  test('reduced motion: crossfade by default, instant when set to off; never the ink', () => {
    assert.equal(mode(resolve(undefined, 'desktop', true), { reduced: true }), 'crossfade')
    assert.equal(mode(resolve(P({ animations: { [ID]: { reducedMotion: 'off' } } }), 'desktop', true), { reduced: true }), 'instant')
    assert.equal(mode(resolve(P({ animations: { [ID]: { enabled: false } } }), 'desktop', true), { reduced: true }), 'instant')
  })

  test('no View Transitions: the existing fallback, whatever the settings', () => {
    assert.equal(mode(resolve(), { vt: false }), 'fade')
    assert.equal(mode(resolve(undefined, 'desktop', true), { vt: false, reduced: true }), 'instant')
  })
})

describe('settings changes', () => {
  test('pattern key changes only with settings that affect the pattern', () => {
    const base = S.DEFAULT_INK_SETTINGS.key
    for (const [k, v] of [['straightness', 0.3], ['raggedness', 0.1], ['edgeWidth', 0.3], ['chunkSize', 3], ['swirl', 2], ['crownSpikes', 0], ['edgeCrispness', 60], ['fixedPattern', true]])
      assert.notEqual(S.inkSettingsFrom({ [k]: v }).key, base, k)
    for (const [k, v] of [['durationMs', 1500], ['openingSplash', 0.05]]) assert.equal(S.inkSettingsFrom({ [k]: v }).key, base, k)
  })

  test('per-device values and the global duration multiplier', () => {
    const cfg = P({ global: { duration: 2 }, animations: { [ID]: { desktop: { swirl: 2 }, mobile: { swirl: 0.8 } } } })
    assert.equal(S.inkSettingsFrom(resolve(cfg, 'desktop').params).field.marbleWarp, 2)
    assert.equal(S.inkSettingsFrom(resolve(cfg, 'mobile').params).field.marbleWarp, 0.8)
    assert.equal(resolve(cfg).params.durationMs, 3000, '2200 × 2 clamped to the 3000 ms maximum')
    assert.equal(resolve(P({ global: { duration: 0.5 } })).params.durationMs, 1200, 'clamped to the minimum')
  })

  test('non-React interface follows setAnimationConfig and notifies subscribers', () => {
    let calls = 0
    const off = A.subscribeAnimationConfig(() => calls++)
    const issues = A.setAnimationConfig({ animations: { [ID]: { desktop: { durationMs: 1500, bogus: 1 } } } })
    assert.equal(calls, 1)
    assert.ok(issues.some((i) => i.includes('bogus')))
    const r = A.getAnimationSettings(ID, { device: 'desktop', prefersReduced: false })
    assert.equal(r.params.durationMs, 1500)
    assert.equal(A.getAnimationSettings(ID, { device: 'mobile', prefersReduced: false }).params.durationMs, 2200)
    A.setAnimationConfig({ animations: { [ID]: { enabled: false } } })
    assert.equal(A.getAnimationSettings(ID, { device: 'desktop', prefersReduced: false }).active, false)
    off()
    A.setAnimationConfig(undefined)
    assert.equal(calls, 2, 'unsubscribed')
    assert.equal(A.getAnimationSettings(ID, { device: 'desktop', prefersReduced: false }).params.durationMs, 2200)
    assert.equal(A.getAnimationSettings('noSuchAnimation', { device: 'desktop', prefersReduced: false }).active, false)
  })

  test('a reported failure switches the transition to the fade for the rest of the visit', () => {
    A.reportAnimationError(ID, new Error('test failure'))
    const r = A.getAnimationSettings(ID, { device: 'desktop', prefersReduced: false })
    assert.equal(r.active, false)
    assert.equal(mode(r), 'fade')
  })
})
