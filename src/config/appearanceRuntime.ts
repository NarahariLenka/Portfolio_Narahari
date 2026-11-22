/**
 * The validated site_settings.appearance values the public site uses today:
 *   defaultTheme      theme a visit opens in (applied in main.tsx before the app renders)
 *   allowThemeToggle  whether the theme toggle is shown (Navigation)
 * Everything else in AppearanceSettings has no implementation yet and is ignored.
 * With no stored settings both equal today's behaviour (dark, toggle shown).
 *
 * Read only after the published content has been loaded (main.tsx sets it first).
 */
import { remoteContent } from '../data/remote'
import { parseAppearance, type AppearanceSettings } from './portfolioSettings'

let cached: AppearanceSettings | null = null

export function siteAppearance(): AppearanceSettings {
  if (!cached) cached = parseAppearance((remoteContent()?.settings as { appearance?: unknown } | null | undefined)?.appearance)
  return cached
}
