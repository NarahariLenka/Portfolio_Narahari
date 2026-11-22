import type { ContactLink } from './contactLinks'

/**
 * React Bits-style dock, CSS only: the hovered item lifts and scales, its neighbours
 * follow slightly. Labels show on hover and keyboard focus; touch just taps the link.
 */
export default function Dock({ links }: { links: ContactLink[] }) {
  if (links.length === 0) return null
  return (
    <nav className="dock" aria-label="Contact links">
      <ul className="dock__list">
        {links.map((link) => (
          <li key={link.id} className="dock__item">
            <a
              className="dock__link"
              href={link.href}
              aria-label={link.label}
              {...(link.external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
            >
              {link.icon}
              <span className="dock__label" aria-hidden="true">
                {link.label}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
