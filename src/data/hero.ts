import home from '../../content/home.json'
import { blockText, image, text } from './content'
import { mediaUrl, remoteContent, sectionBlock } from './remote'

export interface HeroContent {
  greeting: string
  /** Rendered one word per line on wide screens. */
  name: string
  portrait: {
    src: string
    alt: string
  }
}

const fallbackPortrait = image('portrait-placeholder.webp', 'portrait')!
const greetingBlock = sectionBlock('home', 'greeting')
const portraitBlock = sectionBlock('home', 'portrait')

/** CMS (site_settings.owner_name, home blocks) with content/home.json as fallback. */
export const hero: HeroContent = {
  greeting: blockText(greetingBlock?.body, text(home.greeting)),
  name: text(remoteContent()?.settings?.owner_name, text(home.name, 'Your Name')),
  portrait: {
    src: mediaUrl(portraitBlock?.image_path) ?? image(home.portraitImage, 'portrait') ?? fallbackPortrait,
    alt: text(portraitBlock?.image_alt, text(home.portraitDescription, text(home.name))),
  },
}
