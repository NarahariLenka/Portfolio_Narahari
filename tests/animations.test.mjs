/**
 * Animation Registry tests (M0). Run: npm test
 * Pure logic only — the browser-level checks (error boundaries, loader fallback) are
 * covered by the Playwright checks described in the M0 report.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let A, B, T, C
before(async () => {
  ;[A, B, T, C] = await loadModules([
    '/src/animations/index.ts',
    '/src/animations/builtin.ts',
    '/src/animations/modules/_template/definition.ts',
    '/src/animations/config.ts',
  ])
})
after(closeModules)

const P = (raw) => A.parseAnimationConfig(raw)
const D = () => A.DEFAULT_ANIMATION_CONFIG
const resolve = (id, cfg = D(), device = 'desktop', reduced = false, failed = false) =>
  C.resolveAnimation(A.getAnimation(id), cfg, device, reduced, failed)

describe('registry', () => {
  test('all ten existing effects are registered', () => {
    assert.deepEqual(A.listAnimations().map((d) => d.id).sort(), [
      'aboutReveal', 'certificatesReveal', 'contactDotField', 'contactSplitFlap', 'heroScrollTravel',
      'projectsReveal', 'projectsTilt', 'shootingStar', 'skillsSpiral', 'themeInkTransition',
    ])
  })

  test('registered defaults equal the values hard-coded before the registry', () => {
    const dots = A.getAnimation('contactDotField').params
    const tilt = A.getAnimation('projectsTilt').params
    assert.deepEqual(Object.fromEntries(Object.entries(dots).map(([k, s]) => [k, s.default])),
      { dotSpacing: 14, dotRadius: 1.5, bulgeStrength: 67, cursorRadius: 500, glowRadius: 160 })
    assert.deepEqual(Object.fromEntries(Object.entries(tilt).map(([k, s]) => [k, s.default])), { tilt: 4, depth: 10, duration: 0.8 })
  })

  test('sanitizeDefinition clamps param, per-device and reduced-motion defaults', () => {
    const def = {
      ...T.templateAnimation,
      id: 'sanitizeProbe',
      params: { ...T.templateAnimation.params, speed: { ...T.templateAnimation.params.speed, default: 99 } },
      deviceDefaults: { desktop: { density: 9999 }, mobile: { density: -5, constructor: 'x', bogus: 1 } },
      reducedParams: { speed: -1, style: 'nope' },
      defaultDevices: { desktop: true, mobile: 'yes' },
    }
    const { def: clean, warnings } = A.sanitizeDefinition(def)
    assert.equal(clean.params.speed.default, 3)
    assert.deepEqual(clean.deviceDefaults, { desktop: { density: 400 }, mobile: { density: 10 } })
    assert.deepEqual(clean.reducedParams, { speed: 0.1 })
    assert.deepEqual(clean.defaultDevices, { desktop: true })
    assert.ok(warnings.length >= 6, warnings.join('\n'))
  })

  test('valid builtin defaults pass through sanitizeDefinition unchanged', () => {
    for (const def of B.BUILTIN_ANIMATIONS) assert.deepEqual(A.sanitizeDefinition(def).warnings, [], def.id)
  })
})

describe('parser never crashes and ignores what it cannot use', () => {
  const PROTO_KEYS = ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'prototype']

  test('prototype-named keys anywhere in the config', () => {
    for (const k of PROTO_KEYS) {
      const json = (inner) => JSON.parse(inner.replaceAll('K', k))
      const cases = [
        json('{"K":"x"}'),
        json('{"global":{"K":"x","enabled":"K"}}'),
        json('{"animations":{"K":{"enabled":true}}}'),
        json('{"animations":{"contactDotField":{"desktop":{"K":"x"},"mobile":{"K":1}}}}'),
        json('{"animations":{"contactDotField":{"devices":{"K":true},"reducedMotion":"K"}}}'),
        json('{"animations":{"projectsTilt":{"K":{"K":"K"}}}}'),
      ]
      for (const c of cases) {
        const { config } = P(c)
        assert.equal(Object.getPrototypeOf(config.animations), Object.prototype)
        assert.ok(!Object.hasOwn(config.animations, k) || k === 'contactDotField')
      }
    }
    assert.equal(({}).enabled, undefined, 'Object.prototype was not polluted')
  })

  test('prototype keys are reported, not applied', () => {
    const { config, issues } = P(JSON.parse('{"animations":{"contactDotField":{"desktop":{"constructor":"x","dotSpacing":20}}}}'))
    assert.deepEqual(config.animations.contactDotField, { desktop: { dotSpacing: 20 } })
    assert.ok(issues.some((i) => i.includes('constructor')))
  })

  test('random garbage (fuzz, 2000 inputs)', () => {
    let seed = 42
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
    const atoms = [null, true, false, 0, -1, Infinity, NaN, '', 'x', 'constructor', '__proto__', [], {}, [1, 'a'], 'reduced', 'off', 'page-overlay']
    const keys = ['global', 'animations', 'enabled', 'devices', 'desktop', 'mobile', 'reducedMotion', 'placement', 'sections',
      'contactDotField', 'projectsTilt', 'shootingStar', 'heroScrollTravel', 'speed', 'intensity', 'tilt', 'dotSpacing', 'constructor', '__proto__']
    const gen = (depth) => {
      if (depth > 4 || rnd() < 0.3) return atoms[Math.floor(rnd() * atoms.length)]
      if (rnd() < 0.2) return Array.from({ length: Math.floor(rnd() * 3) }, () => gen(depth + 1))
      const o = {}
      for (let i = Math.floor(rnd() * 4); i >= 0; i--) o[keys[Math.floor(rnd() * keys.length)]] = gen(depth + 1)
      return o
    }
    for (let i = 0; i < 2000; i++) {
      const input = gen(0)
      const { config } = P(input)
      assert.equal(typeof config.global.enabled, 'boolean')
      for (const id of Object.keys(config.animations)) assert.ok(A.getAnimation(id), `kept unknown id ${id}`)
    }
  })

  test('unknown ids and invalid values are dropped; numbers are clamped', () => {
    const { config, issues } = P({ global: { speed: 99, intensity: 'x' }, animations: {
      contactDotField: { desktop: { bulgeStrength: 9999, dotSpacing: 13.6, evil: 'alert(1)' } },
      unknownThing: { enabled: true },
    } })
    assert.equal(config.global.speed, 2)
    assert.equal(config.global.intensity, 1)
    assert.deepEqual(config.animations, { contactDotField: { desktop: { bulgeStrength: 150, dotSpacing: 14 } } })
    assert.ok(issues.some((i) => i.includes('unknownThing')))
  })
})

describe('non-configurable effects', () => {
  const SIX = ['aboutReveal', 'certificatesReveal', 'contactSplitFlap', 'heroScrollTravel', 'projectsReveal', 'skillsSpiral']

  test('admin catalogue marks the six as unavailable with no controls', () => {
    const cat = A.describeAnimations()
    for (const d of cat) {
      const unavailable = SIX.includes(d.id)
      assert.equal(d.status, unavailable ? 'unavailable' : 'available', d.id)
      assert.equal(d.controllable, !unavailable, d.id)
      if (unavailable) {
        assert.deepEqual(d.params, {})
        assert.match(d.unavailableReason, /not available yet/)
      } else assert.equal(d.unavailableReason, null)
      assert.ok(!('load' in d))
    }
  })

  test('their settings are never kept for saving', () => {
    const { config, issues } = A.prepareAnimationConfigForSave({ animations: {
      heroScrollTravel: { enabled: false }, skillsSpiral: { desktop: {} }, projectsTilt: { enabled: false },
    } })
    assert.deepEqual(Object.keys(config.animations), ['projectsTilt'])
    assert.equal(issues.filter((i) => i.includes('not configurable yet')).length, 2)
  })

  test('they always run as coded, even with master switch off', () => {
    const cfg = P({ global: { enabled: false } }).config
    for (const id of SIX) assert.equal(resolve(id, cfg).active, true, id)
    assert.equal(resolve('contactDotField', cfg).active, false)
  })
})

describe('resolution', () => {
  test('no settings = exactly today', () => {
    assert.deepEqual(resolve('contactDotField').params, { dotSpacing: 14, dotRadius: 1.5, bulgeStrength: 67, cursorRadius: 500, glowRadius: 160 })
    assert.deepEqual(resolve('projectsTilt').params, { tilt: 4, depth: 10, duration: 0.8 })
    for (const d of A.listAnimations()) assert.equal(resolve(d.id).active, true, d.id)
  })

  test('per-device values and device switches', () => {
    const cfg = P({ animations: { contactDotField: { desktop: { dotSpacing: 20 }, mobile: { dotSpacing: 30 }, devices: { mobile: false } } } }).config
    assert.equal(resolve('contactDotField', cfg, 'desktop').params.dotSpacing, 20)
    assert.equal(resolve('contactDotField', cfg, 'mobile').params.dotSpacing, 30)
    assert.equal(resolve('contactDotField', cfg, 'mobile').active, false)
  })

  test('global multipliers apply to opted-in params and stay in range', () => {
    assert.deepEqual(resolve('projectsTilt', P({ global: { intensity: 1.5, duration: 2 } }).config).params, { tilt: 6, depth: 15, duration: 1.6 })
    assert.equal(resolve('projectsTilt', P({ global: { intensity: 2 } }).config).params.tilt, 6)
  })

  test('reduced motion is always honoured', () => {
    assert.equal(resolve('projectsTilt', D(), 'desktop', true).active, false)
    assert.equal(resolve('contactDotField', D(), 'desktop', true).mode, 'static')
    assert.equal(resolve('contactDotField', P({ animations: { contactDotField: { reducedMotion: 'off' } } }).config, 'desktop', true).active, false)
    // "full" can never be chosen
    assert.equal(P({ animations: { contactDotField: { reducedMotion: 'full' } } }).config.animations.contactDotField.reducedMotion, undefined)
  })

  test('a failed animation is inactive', () => {
    assert.equal(resolve('contactDotField', D(), 'desktop', false, true).active, false)
  })
})

describe('layer host', () => {
  test('not needed while no layer animation exists or is enabled', () => {
    assert.equal(A.anyLayerEnabled(), false)
  })
})
