import footer from '../../content/footer.json'
import { text } from './content'
import { remoteContent } from './remote'

const s = remoteContent()?.settings ?? null
/** site_settings value when set ('' hides it); null/missing falls back to content/footer.json. */
const pick = (remote: string | null | undefined, local: unknown) => (remote === null || remote === undefined ? text(local) : text(remote))

export const footerText = {
  copyright: pick(s?.footer_copyright, footer.copyright),
  signoff: pick(s?.footer_signoff, footer.signoff),
  backToTop: pick(s?.footer_back_to_top, footer.backToTop),
}
