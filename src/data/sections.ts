import { publishedSection, type SectionSlug } from './remote'
import { skills } from './skills'

/**
 * Whether a page section is rendered (and listed in the menu).
 * Only a published section can be hidden (sections.is_visible = false); drafts and local
 * content are always shown. Home always stays: the hero carries the background, water
 * and the scroll-driven opening. Skills also hides itself when its published list is
 * intentionally empty, because the spiral needs at least one skill.
 * The order of sections stays fixed in App.tsx (scroll animations depend on it).
 */
export function isSectionVisible(slug: SectionSlug): boolean {
  if (slug === 'home') return true
  if (slug === 'skills' && skills.length === 0) return false
  return publishedSection(slug)?.is_visible ?? true
}
