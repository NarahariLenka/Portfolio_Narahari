/**
 * Phase E — public fallback rules the CMS relies on (unchanged public code): a draft
 * section shows the built-in content; a published section shows the database list, even
 * when empty; Skills hides itself when its published list is empty. Each scenario uses a
 * fresh module graph because the data modules read the content once, at import.
 * Runs in its own process (minimal document stub for data/content.ts).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

globalThis.document = { title: '', querySelector: () => null }

const local = JSON.parse(readFileSync(new URL('../content/skills.json', import.meta.url), 'utf8')).skills
const row = (slug, name) => ({ id: slug, slug, name, description: null, tools: ['T'], sort_order: 10, is_visible: true, status: 'published', created_at: '', updated_at: '' })
const content = (sections, skills) => ({ settings: null, sections, blocks: {}, skills, projects: null, certificates: null, social: null, mediaBase: 'https://x.test/m' })
const published = (slug) => ({ id: `s-${slug}`, slug, number: '03', title: 'Skills (db)', nav_label: null, sort_order: 30, is_visible: true, status: 'published', created_at: '', updated_at: '' })

async function scenario(remote) {
  const [R] = await loadModules(['/src/data/remote.ts'])
  R.setRemoteContent(remote)
  const [S, V] = await loadModules(['/src/data/skills.ts', '/src/data/sections.ts'])
  const out = { names: S.skills.map((s) => s.name), label: S.skillsSection.label, visible: V.isSectionVisible('skills') }
  await closeModules()
  return out
}

describe('public fallback (draft vs published sections)', () => {
  test('Supabase unavailable → built-in content', async () => {
    const r = await scenario(null)
    assert.deepEqual(r.names, local.map((s) => s.name.trim()))
    assert.equal(r.visible, true)
  })

  test('draft section (not published) → built-in content, even if published rows exist', async () => {
    const r = await scenario(content({}, [row('db-only', 'DB only')]))
    assert.deepEqual(r.names, local.map((s) => s.name.trim()))
  })

  test('published section → the database list and heading', async () => {
    const r = await scenario(content({ skills: published('skills') }, [row('py', 'Python'), row('go', 'Go')]))
    assert.deepEqual(r.names, ['Python', 'Go'])
    assert.equal(r.label, 'Skills (db)')
  })

  test('published but empty → empty list and the Skills section hides itself (why publishing is blocked without skills)', async () => {
    const r = await scenario(content({ skills: published('skills') }, []))
    assert.deepEqual(r.names, [])
    assert.equal(r.visible, false)
  })
})
