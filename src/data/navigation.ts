import { siteText } from './content'
import type { SectionSlug } from './remote'
import { isSectionVisible } from './sections'

export interface NavItem {
  /** Section element id the link scrolls to. */
  id: SectionSlug
  label: string
}

/** Labels from the CMS (sections.nav_label) or content/site.json. Hidden sections are left out. */
export const navItems: NavItem[] = (
  [
    { id: 'home', label: siteText.menu.home },
    { id: 'about', label: siteText.menu.about },
    { id: 'skills', label: siteText.menu.skills },
    { id: 'projects', label: siteText.menu.projects },
    { id: 'certificates', label: siteText.menu.certificates },
    { id: 'contact', label: siteText.menu.contact },
  ] satisfies NavItem[]
).filter((item) => isSectionVisible(item.id))
