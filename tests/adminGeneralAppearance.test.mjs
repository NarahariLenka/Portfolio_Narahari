/**
 * Phase D — General labels and Appearance: the shared label list resolves exactly like the
 * previous code, appearance validation only accepts the two connected settings, and the
 * public runtime keeps today's behaviour when nothing is stored. Run: npm test
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { closeModules, loadModules } from './load-modules.mjs'

let L, M, D, S, R, PS
before(async () => {
  ;[L, M, D, S, R, PS] = await loadModules([
    '/src/data/uiLabels.ts',
    '/src/admin/editors/appearanceModel.ts',
    '/src/admin/settings/draft.ts',
    '/src/admin/settings/schema.ts',
    '/src/data/remote.ts',
    '/src/config/portfolioSettings.ts',
  ])
})
after(closeModules)

const site = JSON.parse(readFileSync(new URL('../content/site.json', import.meta.url), 'utf8'))

/** The label logic exactly as it was in data/content.ts before this change. */
function previousLabels(remoteLabels) {
  const text = (value, fallback = '') => (typeof value === 'string' ? value.trim() || fallback : typeof value === 'number' ? String(value) : fallback)
  const small = { ...(site.smallLabels ?? {}), ...Object.fromEntries(Object.entries(remoteLabels).filter(([, v]) => text(v))) }
  return {
    projectPreviewPlaceholder: text(small.projectPreviewPlaceholder, 'Project preview'),
    certificatePlaceholder: text(small.certificatePlaceholder, 'Certificate'),
    untitledCertificate: text(small.untitledCertificate, 'Certificate'),
    githubLink: text(small.githubLink, 'GitHub'),
    liveSiteLink: text(small.liveSiteLink, 'Live site'),
    viewCredentialLink: text(small.viewCredentialLink, 'View credential'),
    viewPdfLink: text(small.viewPdfLink, 'View PDF'),
    emailIconTooltip: text(small.emailIconTooltip, 'Email'),
    linkedinIconTooltip: text(small.linkedinIconTooltip, 'LinkedIn'),
    githubIconTooltip: text(small.githubIconTooltip, 'GitHub'),
  }
}

const record = (appearance = {}) => S.parseRecord({
  id: 1, site_title: 'T', meta_description: null, owner_name: 'O', location: null, footer_copyright: null, footer_signoff: null,
  footer_back_to_top: null, ui_labels: {}, appearance, animation: {}, backgrounds: {}, updated_at: '2026-11-22T10:00:00+00:00',
})

describe('interface labels (shared list)', () => {
  test('same ten keys and the same result as the previous code for many inputs', () => {
    assert.deepEqual(L.UI_LABEL_KEYS, Object.keys(previousLabels({})))
    const inputs = [
      {},
      { githubLink: 'Code' },
      { githubLink: '  Code  ', viewPdfLink: 'PDF' },
      { githubLink: '', liveSiteLink: '   ' },
      { githubLink: 42, emailIconTooltip: 0 },
      { githubLink: null, certificatePlaceholder: true, untitledCertificate: ['x'], liveSiteLink: { a: 1 } },
      { futureLabel: 'kept but unused', projectPreviewPlaceholder: 'Preview' },
      JSON.parse('{"constructor":"x","__proto__":"y","githubLink":"Git"}'),
    ]
    for (const input of inputs) {
      const now = Object.fromEntries(L.UI_LABEL_KEYS.map((k) => [k, L.resolveLabel(k, input)]))
      assert.deepEqual(now, previousLabels(input), JSON.stringify(input))
    }
  })

  test('localLabel = content/site.json, else the coded fallback', () => {
    assert.equal(L.localLabel('githubLink'), site.smallLabels.githubLink)
    assert.equal(L.localLabel('viewPdfLink'), 'View PDF', 'not in site.json → fallback')
  })
})

describe('appearance', () => {
  test('defaults reproduce today: dark, toggle shown', () => {
    assert.deepEqual(M.themeState({}), { value: 'dark', isDefault: true, storedInvalid: false })
    assert.deepEqual(M.toggleState({}), { value: true, isDefault: true, storedInvalid: false })
    assert.equal(PS.parseAppearance(undefined).defaultTheme, 'dark')
    assert.equal(PS.parseAppearance('garbage').allowThemeToggle, true)
  })

  test('stored invalid values are flagged and shown as the default', () => {
    assert.deepEqual(M.themeState({ defaultTheme: 'neon' }), { value: 'dark', isDefault: true, storedInvalid: true })
    assert.deepEqual(M.toggleState({ allowThemeToggle: 'no' }), { value: true, isDefault: true, storedInvalid: true })
  })

  test('only the two connected settings can be changed, with valid values', () => {
    const r = record({ fontScale: 1.1, future: { a: 1 } })
    const draft = (path, value) => D.editDraft(D.draftFrom(r, ['appearance']), 'appearance', path, value)
    assert.deepEqual(M.validateAppearanceDraft(draft(['defaultTheme'], 'light'), r), [])
    assert.deepEqual(M.validateAppearanceDraft(draft(['allowThemeToggle'], false), r), [])
    assert.equal(M.validateAppearanceDraft(draft(['defaultTheme'], 'neon'), r).length, 1)
    assert.equal(M.validateAppearanceDraft(draft(['allowThemeToggle'], 'no'), r).length, 1)
    assert.equal(M.validateAppearanceDraft(draft(['typography'], 'compact'), r).length, 1, 'unconnected setting')
    assert.equal(M.validateAppearanceDraft(draft(['palette', 'dark'], 'x'), r).length, 1)
    // Unknown stored keys are kept and not judged.
    const d = draft(['defaultTheme'], 'light')
    assert.deepEqual(D.buildPatch(r, d), { appearance: { fontScale: 1.1, future: { a: 1 }, defaultTheme: 'light' } })
  })

  test('public runtime reads the published appearance (and falls back to defaults)', async () => {
    R.setRemoteContent({ settings: { appearance: { defaultTheme: 'light', allowThemeToggle: false } }, sections: {}, blocks: {}, skills: null, projects: null, certificates: null, social: null, mediaBase: '' })
    // Fresh module instance so the cached value reflects the content set above.
    const [{ siteAppearance }] = await loadModules(['/src/config/appearanceRuntime.ts'])
    const a = siteAppearance()
    assert.equal(a.defaultTheme, 'light')
    assert.equal(a.allowThemeToggle, false)
    R.setRemoteContent(null)
  })
})
