import content from '../../content/projects.json'
import { image, items, link, list, pad, secureLink, slug, text } from './content'
import { mediaUrl, publishedSection, remoteContent, sectionList, type ProjectRow } from './remote'

export interface Project {
  id: string
  /** Display index, e.g. "01" (numbered automatically by order). */
  number: string
  title: string
  description: string
  technologies: string[]
  /** Screenshot URL, or null for the empty preview frame. Any aspect ratio works. */
  image: string | null
  imageAlt?: string
  /** CSS object-position for the screenshot crop; defaults to the top of the image. */
  imagePosition?: string
  github: string | null
  live: string | null
  featured: boolean
}

const section = publishedSection('projects')
const remoteRows = sectionList('projects', remoteContent()?.projects)

/** CMS when the Projects section is published, otherwise content/projects.json. */
export const projectsSection = {
  index: text(section?.number, text(content.number)),
  label: text(section?.title, text(content.title, 'Projects')),
}

/**
 * Accepts only simple CSS object-position values ("50% 0%", "center top", "20% center").
 * Read defensively: the column exists only after migration 002 is applied.
 */
function imagePosition(row: ProjectRow): string | undefined {
  const v = text((row as ProjectRow & { image_position?: unknown }).image_position)
  const token = '(?:\\d{1,3}%|left|right|center|top|bottom)'
  return new RegExp(`^${token}(?: ${token})?$`).test(v) ? v : undefined
}

function fromRemote(rows: ProjectRow[]): Project[] {
  // projects.is_featured decides; if none is featured, the first by sort_order is.
  const featuredId = (rows.find((r) => r.is_featured) ?? rows[0])?.id
  return rows
    .filter((p) => text(p.title))
    .map((p, i) => ({
      id: p.slug,
      number: pad(i + 1),
      title: text(p.title),
      description: text(p.description),
      technologies: list(p.technologies),
      image: mediaUrl(p.image_path),
      imageAlt: text(p.image_alt) || undefined,
      imagePosition: imagePosition(p),
      github: secureLink(p.github_url),
      live: secureLink(p.live_url),
      featured: p.id === featuredId,
    }))
}

export const projects: Project[] = remoteRows
  ? fromRemote(remoteRows)
  : items(content.projects)
      .filter((p) => text(p.title))
      .map((p, i) => ({
        id: slug(text(p.title), i),
        number: pad(i + 1),
        title: text(p.title),
        description: text(p.description),
        technologies: list(p.technologies),
        image: image(p.image, 'projects'),
        github: link(p.githubLink),
        live: link(p.liveLink),
        featured: i === 0,
      }))
