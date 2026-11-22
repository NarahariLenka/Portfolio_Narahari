import about from '../../content/about.json'
import contact from '../../content/contact.json'
import home from '../../content/home.json'
import { blockText, link, list, secureLink, siteText, text } from './content'
import { publishedSection, remoteContent, sectionBlock, sectionList } from './remote'

export interface ContactContent {
  index: string
  label: string
  /** One word per line of the closing headline. */
  headline: string[]
}

export interface AboutContent {
  /** Section index shown in the label, e.g. "02". */
  index: string
  label: string
  statement: string
  details: string
}

export interface Profile {
  name: string
  /** Plain address, e.g. 'name@domain.com', used for the email link. */
  email: string
  /** Full profile URLs ('' hides the link). */
  github: string
  linkedin: string
  /** Tooltip text for each contact icon. */
  socialLabels: { email: string; github: string; linkedin: string }
  about: AboutContent
  contact: ContactContent
}

const aboutSection = publishedSection('about')
const contactSection = publishedSection('contact')

// Contact headline: a published `headline` block's JSON word list (or its text, one word
// per line); otherwise content/contact.json.
const headlineBlock = sectionBlock('contact', 'headline')
const headlineWords = list(headlineBlock?.data)
const remoteHeadline = headlineBlock
  ? headlineWords.length
    ? headlineWords
    : text(headlineBlock.body).split(/\s+/).filter(Boolean)
  : null
const localHeadline = list(contact.bigHeadline)
const headline = remoteHeadline?.length ? remoteHeadline : localHeadline.length ? localHeadline : ['Contact']

// Social links: authoritative once Contact is published (a missing platform hides its icon).
const social = sectionList('contact', remoteContent()?.social)
const socialRow = (platform: string) => social?.find((r) => r.platform === platform)
const remoteEmail = socialRow('email')

/** CMS with content/about.json, content/contact.json and content/home.json as fallback. */
export const profile: Profile = {
  name: text(remoteContent()?.settings?.owner_name, text(home.name)),
  email: social
    ? (/^mailto:[^\s@/?]+@[^\s@/?]+\.[^\s@/?]+/i.test(text(remoteEmail?.url)) ? text(remoteEmail?.url).replace(/^mailto:/i, '').split('?')[0] : '')
    : text(contact.email).replace(/^mailto:/i, ''),
  github: social ? (secureLink(socialRow('github')?.url) ?? '') : (link(contact.githubLink) ?? ''),
  linkedin: social ? (secureLink(socialRow('linkedin')?.url) ?? '') : (link(contact.linkedinLink) ?? ''),
  socialLabels: {
    email: text(socialRow('email')?.label, siteText.labels.emailIconTooltip),
    github: text(socialRow('github')?.label, siteText.labels.githubIconTooltip),
    linkedin: text(socialRow('linkedin')?.label, siteText.labels.linkedinIconTooltip),
  },
  about: {
    index: text(aboutSection?.number, text(about.number)),
    label: text(aboutSection?.title, text(about.title, 'About')),
    statement: blockText(sectionBlock('about', 'main_sentence')?.body, text(about.mainSentence)),
    details: blockText(sectionBlock('about', 'paragraph')?.body, text(about.paragraph)),
  },
  contact: {
    index: text(contactSection?.number, text(contact.number)),
    label: text(contactSection?.title, text(contact.title, 'Contact')),
    headline,
  },
}
