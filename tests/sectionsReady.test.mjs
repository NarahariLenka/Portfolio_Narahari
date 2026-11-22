/** The "sections below the hero are in the page" signal (Phase H). Run: npm test */
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let R
before(async () => {
  ;[R] = await loadModules(['/src/data/sectionsReady.ts'])
})
after(closeModules)

test('starts not ready; marking resolves waiters once and stays ready', async () => {
  assert.equal(R.sectionsReady(), false)
  let resolved = 0
  const waiting = R.whenSectionsReady().then(() => resolved++)
  await Promise.resolve()
  assert.equal(resolved, 0, 'an early menu click waits')
  R.markSectionsReady()
  R.markSectionsReady()
  await waiting
  assert.equal(resolved, 1)
  assert.equal(R.sectionsReady(), true)
  await R.whenSectionsReady() // later callers continue at once
})
