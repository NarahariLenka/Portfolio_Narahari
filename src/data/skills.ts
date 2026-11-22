import content from '../../content/skills.json'
import { items, list, slug, text } from './content'
import { publishedSection, remoteContent, sectionList } from './remote'

export interface Skill {
  id: string
  name: string
  /** One short line shown when the skill is active. */
  summary: string
  related: string[]
}

const section = publishedSection('skills')
const remoteRows = sectionList('skills', remoteContent()?.skills)

/** CMS when the Skills section is published, otherwise content/skills.json. */
export const skillsSection = {
  index: text(section?.number, text(content.number)),
  label: text(section?.title, text(content.title, 'Skills')),
}

export const skills: Skill[] = remoteRows
  ? remoteRows
      .map((s) => ({ id: s.slug, name: text(s.name), summary: text(s.description), related: list(s.tools) }))
      .filter((s) => s.name)
  : items(content.skills)
      .map((s, i) => ({
        id: slug(text(s.name), i),
        name: text(s.name),
        summary: text(s.description),
        related: list(s.tools),
      }))
      .filter((s) => s.name)

// Local content always needs at least one skill for the spiral. A published, intentionally
// empty list is kept empty and the section hides itself instead (see sections.ts).
if (!remoteRows && skills.length === 0) skills.push({ id: 'skill-1', name: 'Skill', summary: '', related: [] })
