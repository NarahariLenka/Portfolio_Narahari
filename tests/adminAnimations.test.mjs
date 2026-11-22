/**
 * Phase C — Animations editor model: registry-driven catalogue, effective values,
 * validation of edits (no silent clamping), resets that keep unknown keys, preview config,
 * and that saved edits resolve to the intended runtime values. Run: npm test
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let M, A, D, S, Ink, V
before(async () => {
  ;[M, A, D, S, Ink, V] = await loadModules([
    '/src/admin/editors/animationModel.ts',
    '/src/animations/index.ts',
    '/src/admin/settings/draft.ts',
    '/src/admin/settings/schema.ts',
    '/src/lib/themeInkSettings.ts',
    '/src/admin/editor/validation.ts',
  ])
})
after(closeModules)

const ID = 'themeInkTransition'
const record = (animation = {}) => S.parseRecord({
  id: 1, site_title: 'T', meta_description: null, owner_name: 'O', location: null, footer_copyright: null, footer_signoff: null,
  footer_back_to_top: null, ui_labels: {}, appearance: {}, animation, backgrounds: {}, updated_at: '2026-11-22T10:00:00+00:00',
})
const edit = (r, path, value) => D.editDraft(D.draftFrom(r, ['animation']), 'animation', path, value)
const def = () => A.getAnimation(ID)

describe('catalogue', () => {
  test('adjustable = exactly the effects whose code reads settings; the rest are read-only', () => {
    const cat = A.describeAnimations()
    assert.deepEqual(cat.filter((d) => d.controllable).map((d) => d.id).sort(), ['contactDotField', 'projectsTilt', 'shootingStar', 'themeInkTransition'])
    for (const d of cat.filter((x) => !x.controllable)) assert.deepEqual(d.params, {}, `${d.id} offers no controls`)
  })

  test('theme ink controls come from the registry with the agreed names, ranges and defaults', () => {
    const p = def().params
    assert.deepEqual(Object.keys(p), ['durationMs', 'openingSplash', 'straightness', 'raggedness', 'edgeWidth', 'chunkSize', 'swirl', 'crownSpikes', 'edgeCrispness', 'fixedPattern'])
    assert.deepEqual([p.durationMs.min, p.durationMs.max, p.durationMs.default], [1200, 3000, 2200])
    assert.equal(p.fixedPattern.kind, 'boolean')
    assert.deepEqual(def().reducedMotion, { default: 'static', allowed: ['static', 'off'] })
  })

  test('only multipliers some parameter uses are offered (intensity, duration)', () => {
    assert.deepEqual(M.usedGlobalScales().sort(), ['duration', 'intensity'])
  })
})

describe('effective values', () => {
  test('no settings = registry defaults, marked default', () => {
    for (const d of M.DEVICES)
      for (const key of Object.keys(def().params)) {
        const s = M.paramState(def(), {}, d, key)
        assert.equal(s.value, def().params[key].default)
        assert.equal(s.isDefault, true)
      }
    assert.deepEqual(M.boolState({}, M.enabledPath(ID), true), { value: true, isDefault: true, storedInvalid: false })
    assert.equal(M.reducedState(def(), {}).value, 'static')
    assert.equal(M.globalNumberState({}, 'intensity').value, 1)
  })

  test('stored valid values are shown; stored invalid ones are flagged and shown as default', () => {
    const cfg = { animations: { [ID]: { desktop: { durationMs: 1500, swirl: 99, edgeWidth: 'x' }, reducedMotion: 'full', enabled: 'yes' } }, global: { intensity: 7 } }
    assert.deepEqual(M.paramState(def(), cfg, 'desktop', 'durationMs'), { value: 1500, isDefault: false, storedInvalid: false })
    assert.deepEqual(M.paramState(def(), cfg, 'desktop', 'swirl'), { value: 1.2, isDefault: true, storedInvalid: true })
    assert.equal(M.paramState(def(), cfg, 'desktop', 'edgeWidth').storedInvalid, true)
    assert.equal(M.paramState(def(), cfg, 'mobile', 'durationMs').value, 2200, 'devices are independent')
    assert.equal(M.reducedState(def(), cfg).storedInvalid, true)
    assert.equal(M.boolState(cfg, M.enabledPath(ID), true).storedInvalid, true)
    assert.equal(M.globalNumberState(cfg, 'intensity').storedInvalid, true)
  })
})

describe('validation never corrects what the admin entered', () => {
  const v = (path, value, base = {}) => M.validateAnimationDraft(edit(record(base), path, value), record(base))

  test('boundaries are accepted', () => {
    for (const [key, val] of [['durationMs', 1200], ['durationMs', 3000], ['openingSplash', 0], ['openingSplash', 0.3], ['raggedness', 0.05], ['raggedness', 0.25], ['edgeCrispness', 40], ['edgeCrispness', 110], ['chunkSize', 2.7]])
      assert.deepEqual(v(M.paramPath(ID, 'desktop', key), val), [], `${key}=${val}`)
    assert.deepEqual(v(M.paramPath(ID, 'mobile', 'fixedPattern'), true), [])
    assert.deepEqual(v(M.globalPath('intensity'), 2), [])
    assert.deepEqual(v(M.globalPath('enabled'), false), [])
    assert.deepEqual(v(M.reducedPath(ID), 'off'), [])
    assert.deepEqual(v(M.devicePath(ID, 'mobile'), false), [])
  })

  test('out-of-range, off-step and wrong-type values are rejected (not clamped)', () => {
    for (const [key, val] of [['durationMs', 1199], ['durationMs', 3001], ['durationMs', 2250], ['chunkSize', 2.63], ['swirl', '2'], ['fixedPattern', 'yes'], ['raggedness', Number.NaN]])
      assert.equal(v(M.paramPath(ID, 'desktop', key), val).length, 1, `${key}=${val}`)
    assert.equal(v(M.reducedPath(ID), 'full').length, 1, '"full" motion is never allowed')
    assert.equal(v(M.globalPath('intensity'), 2.5).length, 1)
    assert.equal(v(M.paramPath(ID, 'desktop', 'bogus'), 1).length, 1)
    assert.equal(v(['animations', 'heroScrollTravel', 'enabled'], false).length, 1, 'read-only effects cannot be changed')
    assert.equal(v(['animations', 'notRegistered', 'enabled'], false).length, 1)
    assert.equal(v(['animations', ID, 'placement'], 'page-overlay').length, 1, 'unexpected path')
  })

  test('removals (reset to default) are always valid; untouched invalid stored keys are not judged', () => {
    const base = { animations: { [ID]: { desktop: { swirl: 99 }, futureKey: 1 } } }
    const r = record(base)
    let d = D.draftFrom(r, ['animation'])
    d = D.editDraft(d, 'animation', M.paramPath(ID, 'desktop', 'durationMs'), 1500)
    assert.deepEqual(M.validateAnimationDraft(d, r), [], 'pre-existing swirl:99 does not block an unrelated save')
    d = D.removeFromDraft(d, 'animation', M.paramPath(ID, 'desktop', 'swirl'))
    assert.deepEqual(M.validateAnimationDraft(d, r), [])
  })

  test('number box rules match (text, range, step)', () => {
    assert.equal(V.numberProblem('2200', 1200, 3000, 100), null)
    assert.match(V.numberProblem('2250', 1200, 3000, 100), /steps of 100/)
    assert.match(V.numberProblem('9999', 1200, 3000, 100), /between/)
    assert.match(V.numberProblem('abc', 1200, 3000, 100), /number/)
    assert.match(V.numberProblem('', 0, 1, 0.05), /number/)
    assert.equal(V.numberProblem('0.65', 0, 1, 0.05), null)
    assert.equal(V.numberProblem('2.6', 1.5, 4, 0.1), null)
    assert.match(V.numberProblem('2.63', 1.5, 4, 0.1), /steps/)
    assert.match(V.numberProblem('1e3', 1200, 3000, 100), /digits/)
  })
})

describe('resets keep what the editor doesn’t manage', () => {
  test('device reset and reset-all remove only managed keys', () => {
    const base = {
      global: { enabled: true, speed: 1.5 },
      animations: {
        [ID]: { enabled: false, devices: { mobile: false }, reducedMotion: 'off', desktop: { swirl: 2, futureParam: 3 }, mobile: { swirl: 1 }, futureFlag: 'x' },
        contactDotField: { enabled: false },
      },
      futureTopLevel: 1,
    }
    const r = record(base)
    let d = D.draftFrom(r, ['animation'])
    for (const p of M.managedParamPaths(def(), 'desktop')) d = D.removeFromDraft(d, 'animation', p)
    assert.deepEqual(d.animation.animations[ID].desktop, { futureParam: 3 })
    for (const p of M.managedEntryPaths(def())) d = D.removeFromDraft(d, 'animation', p)
    assert.deepEqual(d.animation.animations[ID], { desktop: { futureParam: 3 }, futureFlag: 'x' })
    assert.deepEqual(d.animation.animations.contactDotField, { enabled: false }, 'other animations untouched')
    assert.deepEqual(d.animation.global, { enabled: true, speed: 1.5 })
    assert.equal(d.animation.futureTopLevel, 1)
  })
})

describe('saved settings → runtime', () => {
  const resolveWith = (cfg, device = 'desktop', reduced = false) => {
    A.setAnimationConfig(cfg)
    try { return A.getAnimationSettings(ID, { device, prefersReduced: reduced }) } finally { A.setAnimationConfig(undefined) }
  }

  test('original behaviour when nothing is stored', () => {
    const r = resolveWith({})
    assert.equal(r.active, true)
    assert.deepEqual(Ink.inkSettingsFrom(r.params), Ink.DEFAULT_INK_SETTINGS)
  })

  test('edited values reach the transition exactly (per device), disabled → colour fade', () => {
    let d = D.draftFrom(record({}), ['animation'])
    d = D.editDraft(d, 'animation', M.paramPath(ID, 'desktop', 'durationMs'), 1500)
    d = D.editDraft(d, 'animation', M.paramPath(ID, 'mobile', 'swirl'), 2.4)
    assert.equal(Ink.inkSettingsFrom(resolveWith(d.animation, 'desktop').params).durationMs, 1500)
    assert.equal(Ink.inkSettingsFrom(resolveWith(d.animation, 'mobile').params).durationMs, 2200)
    assert.equal(Ink.inkSettingsFrom(resolveWith(d.animation, 'mobile').params).field.marbleWarp, 2.4)
    const off = D.editDraft(d, 'animation', M.enabledPath(ID), false)
    assert.equal(Ink.chooseInkMode({ viewTransitions: true, prefersReduced: false, resolved: resolveWith(off.animation) }), 'fade')
    const reducedOff = D.editDraft(d, 'animation', M.reducedPath(ID), 'off')
    assert.equal(Ink.chooseInkMode({ viewTransitions: true, prefersReduced: true, resolved: resolveWith(reducedOff.animation, 'desktop', true) }), 'instant')
  })

  test('preview config: simulated device copies that device’s values; same device is unchanged', () => {
    const cfg = { animations: { [ID]: { desktop: { swirl: 2 }, mobile: { swirl: 0.8 }, devices: { mobile: false } } } }
    assert.equal(M.previewConfig(cfg, ID, 'desktop', 'desktop'), cfg)
    const sim = M.previewConfig(cfg, ID, 'mobile', 'desktop')
    assert.deepEqual(sim.animations[ID].desktop, { swirl: 0.8 })
    assert.equal(sim.animations[ID].devices.desktop, false, 'mobile switched off → simulated desktop off too')
    assert.deepEqual(cfg.animations[ID].desktop, { swirl: 2 }, 'input not mutated')
  })
})
