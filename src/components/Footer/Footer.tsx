import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import { footerText } from '../../data/footer'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import './Footer.css'

gsap.registerPlugin(ScrollToPlugin)

/** Thin closing strip under Contact. All text comes from content/footer.json. */
export default function Footer() {
  const reduced = useReducedMotion()
  const { copyright, signoff, backToTop } = footerText
  if (!copyright && !signoff && !backToTop) return null

  const toTop = () => gsap.to(window, { scrollTo: { y: 0, autoKill: true }, duration: reduced ? 0 : 1.6, ease: 'power2.inOut' })

  return (
    <footer className="site-footer">
      <p className="site-footer__copy">{copyright}</p>
      <p className="site-footer__signoff">{signoff}</p>
      <div className="site-footer__end">
        {backToTop && (
          <button type="button" className="site-footer__top" onClick={toTop}>
            {backToTop} <span aria-hidden="true">↑</span>
          </button>
        )}
      </div>
    </footer>
  )
}
