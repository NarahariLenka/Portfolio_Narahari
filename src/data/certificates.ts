import content from '../../content/certificates.json'
import { image, items, link, secureLink, text } from './content'
import { mediaUrl, publishedSection, remoteContent, sectionList, type CertificateRow } from './remote'

export interface Certificate {
  id: string
  /** Empty shows a neutral "Certificate 01" style title. */
  title: string
  issuer: string
  /** Image URL, or null for an empty frame. Any aspect ratio works; never cropped. */
  image: string | null
  imageAlt?: string
  date?: string
  credentialUrl?: string
  /** Public URL of the original PDF, if any. */
  pdfUrl?: string
}

const section = publishedSection('certificates')
const remoteRows = sectionList('certificates', remoteContent()?.certificates)

/** CMS when the Certificates section is published, otherwise content/certificates.json. */
export const certificatesSection = {
  index: text(section?.number, text(content.number)),
  label: text(section?.title, text(content.title, 'Certificates')),
}

/** issued_label as written; otherwise issued_on (YYYY-MM-DD) shown as e.g. "Mar 2026". */
function dateLabel(c: CertificateRow): string | undefined {
  const label = text(c.issued_label)
  if (label) return label
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text(c.issued_on))
  if (!m) return undefined
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export const certificates: Certificate[] = remoteRows
  ? remoteRows.map((c) => ({
      id: c.slug,
      title: text(c.title),
      issuer: text(c.issuer),
      image: mediaUrl(c.image_path),
      imageAlt: text(c.image_alt) || undefined,
      date: dateLabel(c),
      credentialUrl: secureLink(c.credential_url) ?? undefined,
      pdfUrl: mediaUrl(c.pdf_path) ?? undefined,
    }))
  : items(content.certificates).map((c, i) => {
      // Local JSON may also name a PDF in public/images/certificates/ ("pdf": "name.pdf").
      const pdf = text(c.pdf)
      return {
        id: `certificate-${i + 1}`,
        title: text(c.title),
        issuer: text(c.issuer),
        image: image(c.image, 'certificates'),
        date: text(c.date) || undefined,
        credentialUrl: link(c.credentialLink) ?? undefined,
        pdfUrl: /\.pdf$/i.test(pdf) ? (image(pdf, 'certificates') ?? undefined) : undefined,
      }
    })
