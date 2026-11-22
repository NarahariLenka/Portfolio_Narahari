import { useCallback, useRef, useState, type CSSProperties } from 'react'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { useGSAP } from '@gsap/react'
import { certificates, certificatesSection, type Certificate } from '../../data/certificates'
import { siteText } from '../../data/content'
import './Certificates.css'

gsap.registerPlugin(ScrollTrigger, useGSAP)

const pad = (n: number) => String(n).padStart(2, '0')
const titleOf = (c: Certificate, i: number) => c.title || `${siteText.labels.untitledCertificate} ${pad(i + 1)}`

/**
 * Horizontal accordion on desktop, vertical stack on mobile. Width/height changes are
 * CSS transitions on flex/grid tracks; React state only changes when the active panel does.
 */
export default function Certificates() {
  const section = useRef<HTMLElement>(null)
  const [active, setActive] = useState(0)

  const activate = useCallback((i: number) => setActive(i), [])

  // Panels settle in once as the section enters.
  useGSAP(
    () => {
      const mm = gsap.matchMedia()
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        gsap.from('.cert', {
          autoAlpha: 0,
          y: 40,
          duration: 1.1,
          stagger: 0.08,
          ease: 'power3.out',
          scrollTrigger: { trigger: '.certs__list', start: 'top 82%', once: true },
        })
      })
    },
    { scope: section },
  )

  return (
    <section id="certificates" ref={section} className="certs" aria-labelledby="certs-title">
      <header className="certs__header">
        <p className="section-label">
          <span className="section-label__index">{certificatesSection.index}</span>
          <span aria-hidden="true">•</span>
          {certificatesSection.label}
        </p>
        <h2 id="certs-title" className="sr-only">
          {certificatesSection.label}
        </h2>
      </header>

      <ul className="certs__list" style={{ '--cert-count': certificates.length } as CSSProperties}>
        {certificates.map((cert, i) => {
          const isActive = i === active
          const title = titleOf(cert, i)
          const bodyId = `${cert.id}-panel`
          return (
            <li
              key={cert.id}
              className={`cert${isActive ? ' is-active' : ''}`}
              // Hover opens panels for mice only; touch relies on tap.
              onPointerEnter={(e) => e.pointerType === 'mouse' && activate(i)}
            >
              <button
                type="button"
                className="cert__trigger"
                aria-expanded={isActive}
                aria-controls={bodyId}
                onClick={() => activate(i)}
                onFocus={() => activate(i)}
              >
                <span className="cert__index">{pad(i + 1)}</span>
                <span className={`cert__tab-title${cert.title ? '' : ' is-placeholder'}`}>{title}</span>
              </button>

              <div id={bodyId} className="cert__body" inert={!isActive}>
                <div className="cert__body-inner">
                  <figure className="cert__figure">
                    {cert.image ? (
                      <img
                        src={cert.image}
                        alt={cert.imageAlt ?? `${title}${cert.issuer ? `, issued by ${cert.issuer}` : ''}`}
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div className="cert__placeholder" role="img" aria-label={`${title} image coming soon`}>
                        <span>{siteText.labels.certificatePlaceholder}</span>
                      </div>
                    )}
                  </figure>

                  <div className="cert__caption">
                    <div>
                      <h3 className={`cert__title${cert.title ? '' : ' is-placeholder'}`}>{title}</h3>
                      {(cert.issuer || cert.date) && (
                        <p className="cert__issuer">{[cert.issuer, cert.date].filter(Boolean).join(' · ')}</p>
                      )}
                    </div>
                    {(cert.credentialUrl || cert.pdfUrl) && (
                      <div className="cert__links">
                        {cert.pdfUrl && (
                          // Opens in the browser's own PDF viewer in a new tab (preview, zoom, download).
                          <a className="cert__link" href={cert.pdfUrl} target="_blank" rel="noreferrer" type="application/pdf">
                            {siteText.labels.viewPdfLink} <span aria-hidden="true">↗</span>
                          </a>
                        )}
                        {cert.credentialUrl && (
                          <a className="cert__link" href={cert.credentialUrl} target="_blank" rel="noreferrer">
                            {siteText.labels.viewCredentialLink} <span aria-hidden="true">↗</span>
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
