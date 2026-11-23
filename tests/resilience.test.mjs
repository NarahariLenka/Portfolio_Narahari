/**
 * Guards for two production fixes that no other test exercises (both need a real browser
 * to observe, so these check the source that produces the behaviour):
 *   • Without WebGL only the 3D spiral is dropped — the Skills text, rail and controls stay.
 *   • The boot CSS preloads use the same CORS mode as Vite's loader, so each stylesheet is
 *     downloaded once (a mismatch makes the browser discard the preload and fetch again).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('Skills: the WebGL scene has its own error boundary inside the section', () => {
  const skills = src('src/components/Skills/Skills.tsx')
  assert.match(skills, /<SafeBoundary name="skills scene">\s*<Suspense fallback=\{null\}>\s*<SkillsScene/)
  // The info panel stays outside that boundary.
  const boundaryEnd = skills.indexOf('</SafeBoundary>')
  assert.ok(boundaryEnd > 0 && boundaryEnd < skills.indexOf('<SkillInfo'))
})

test('boot preloads: stylesheet preloads are requested with crossorigin, like the dynamic loader', () => {
  const boot = src('boot-preload.ts')
  const styleLines = boot.split('\n').filter((l) => /rel: 'preload', as: 'style'/.test(l))
  assert.ok(styleLines.length > 0)
  for (const l of styleLines) assert.match(l, /crossorigin: true/)
})
