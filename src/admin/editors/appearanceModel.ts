/**
 * Appearance editor model (pure). Only the settings the public site actually uses are
 * editable (see src/config/appearanceRuntime.ts); validation rejects anything else.
 */
import { DEFAULT_APPEARANCE, THEMES } from '../../config/portfolioSettings'
import type { Draft } from '../settings/draft'
import { diffLeaves, getPath, isObject } from '../settings/json'
import type { SettingsRecord } from '../settings/schema'

export const EDITABLE_APPEARANCE = ['defaultTheme', 'allowThemeToggle'] as const

export function themeState(cfg: unknown) {
  const stored = getPath(cfg, ['defaultTheme'])
  const valid = typeof stored === 'string' && (THEMES as readonly string[]).includes(stored)
  const value = (valid ? stored : DEFAULT_APPEARANCE.defaultTheme) as (typeof THEMES)[number]
  return { value, isDefault: value === DEFAULT_APPEARANCE.defaultTheme, storedInvalid: stored !== undefined && !valid }
}

export function toggleState(cfg: unknown) {
  const stored = getPath(cfg, ['allowThemeToggle'])
  const valid = typeof stored === 'boolean'
  const value = valid ? stored : DEFAULT_APPEARANCE.allowThemeToggle
  return { value, isDefault: value === DEFAULT_APPEARANCE.allowThemeToggle, storedInvalid: stored !== undefined && !valid }
}

export function validateAppearanceDraft(draft: Draft, record: SettingsRecord): string[] {
  if (!isObject(draft.appearance)) return ['Appearance settings must be a JSON object.']
  const problems: string[] = []
  for (const c of diffLeaves(record.appearance, draft.appearance)) {
    if ('remove' in c) continue
    const [key] = c.path
    if (c.path.length !== 1 || !(EDITABLE_APPEARANCE as readonly string[]).includes(key)) problems.push(`Unexpected appearance change at "${c.path.join('.')}".`)
    else if (key === 'defaultTheme' && !(THEMES as readonly unknown[]).includes(c.value)) problems.push('Default theme must be Dark or Light.')
    else if (key === 'allowThemeToggle' && typeof c.value !== 'boolean') problems.push('Theme toggle must be on or off.')
  }
  return problems
}
