/**
 * Theme ink transition — behaviour of transitionToTheme() with a minimal fake DOM
 * (no browser): disabled state, reduced motion, missing View Transitions, ignored clicks
 * and the error fallback. The visual ink itself is checked in a real browser.
 * Runs in its own process (node --test), so the global stubs can't leak into other files.
 */
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { closeModules, loadModules } from './load-modules.mjs'

// ---------------------------------------------------------------------------- fake DOM

const env = { reduced: false, vtCalls: 0, createCalls: 0, finish: null }
const classes = new Set()
const root = {
  dataset: {},
  style: { background: '', setProperty() {}, removeProperty() {} },
  classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
}
function startViewTransition(update) {
  env.vtCalls++
  update()
  let finish
  const finished = new Promise((res) => (finish = res))
  env.finish = finish
  return { ready: Promise.resolve(), finished }
}
globalThis.window = globalThis
Object.assign(globalThis, {
  innerWidth: 320,
  innerHeight: 200,
  matchMedia: (q) => ({ matches: q.includes('reduce') ? env.reduced : false, addEventListener() {}, removeEventListener() {} }),
  requestIdleCallback: () => 0, // never prepares ahead on its own
  addEventListener() {},
  document: {
    documentElement: root,
    body: { append() {} },
    querySelector: () => null,
    startViewTransition,
    createElement: () => {
      env.createCalls++
      throw new Error('simulated DOM failure')
    },
    createElementNS: () => {
      throw new Error('simulated DOM failure')
    },
  },
})

let A, T, Store
before(async () => {
  ;[A, T, Store] = await loadModules(['/src/animations/index.ts', '/src/lib/themeTransition.ts', '/src/theme/themeStore.ts'])
})
after(closeModules)

const ID = 'themeInkTransition'
const FADE = 'theme-transition'

describe('transitionToTheme()', () => {
  test('switched off in the CMS → the existing colour fade, no View Transition', async () => {
    A.setAnimationConfig({ animations: { [ID]: { enabled: false } } })
    assert.equal(Store.getTheme(), 'dark')
    await T.transitionToTheme('light')
    assert.equal(Store.getTheme(), 'light')
    assert.ok(classes.has(FADE))
    assert.equal(env.vtCalls, 0)
    // Clicks during the fade are ignored.
    await T.transitionToTheme('dark')
    assert.equal(Store.getTheme(), 'light')
    await sleep(750)
    assert.ok(!classes.has(FADE))
  })

  test('no View Transitions → the existing fallback, whatever the settings', async () => {
    // (Removed first: replacing the settings while the ink would run prepares a pattern
    // ahead of time, which this fake DOM makes fail on purpose — tested last.)
    const vt = document.startViewTransition
    delete document.startViewTransition
    A.setAnimationConfig(undefined)
    await T.transitionToTheme('dark')
    assert.equal(Store.getTheme(), 'dark')
    assert.ok(classes.has(FADE))
    document.startViewTransition = vt
    await sleep(750)
  })

  test('reduced motion → 150 ms crossfade; clicks during it are ignored', async () => {
    env.reduced = true
    await T.transitionToTheme('light')
    assert.equal(env.vtCalls, 1)
    assert.equal(Store.getTheme(), 'light')
    assert.ok(classes.has('theme-vt-fade'))
    await T.transitionToTheme('dark') // still running → ignored
    assert.equal(env.vtCalls, 1)
    assert.equal(Store.getTheme(), 'light')
    env.finish()
    await sleep(10)
    assert.ok(!classes.has('theme-vt-fade'))
  })

  test('reduced motion set to "off" → instant switch, no animation', async () => {
    A.setAnimationConfig({ animations: { [ID]: { reducedMotion: 'off' } } })
    await T.transitionToTheme('dark')
    assert.equal(Store.getTheme(), 'dark')
    assert.equal(env.vtCalls, 1)
    assert.ok(!classes.has(FADE) && !classes.has('theme-vt-fade'))
    env.reduced = false
  })

  test('an error while preparing the ink → colour fade now, and for the rest of the visit', async () => {
    const errors = []
    const log = console.error
    const warn = console.warn
    console.error = (...a) => errors.push(a.join(' '))
    console.warn = () => {}
    try {
      await T.transitionToTheme('light')
      assert.equal(Store.getTheme(), 'light', 'the theme still switched')
      assert.ok(classes.has(FADE), 'with the colour fade')
      assert.ok(!classes.has('theme-vt-flow'), 'no ink class left behind')
      assert.equal(env.vtCalls, 1, 'no View Transition was started')
      assert.ok(errors.some((e) => e.includes(ID)), 'failure reported')
      assert.equal(A.getAnimationSettings(ID, { device: 'desktop', prefersReduced: false }).active, false)
      const created = env.createCalls
      await sleep(750)
      await T.transitionToTheme('dark')
      assert.equal(Store.getTheme(), 'dark')
      assert.ok(classes.has(FADE))
      assert.equal(env.createCalls, created, 'no new attempt to build the ink')
      await sleep(750)
    } finally {
      console.error = log
      console.warn = warn
    }
  })
})
