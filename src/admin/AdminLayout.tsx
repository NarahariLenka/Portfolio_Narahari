/**
 * Admin shell: header, section navigation and the open editor. Only rendered after the
 * admin check passed. Switching sections or signing out with unsaved changes asks first.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import type { TypedSupabaseClient } from '../lib/supabase'
import ContentEditor from './content/ContentEditor'
import AnimationsEditor from './editors/AnimationsEditor'
import AppearanceEditor from './editors/AppearanceEditor'
import BackgroundsEditor from './editors/BackgroundsEditor'
import GeneralEditor from './editors/GeneralEditor'
import MediaLibrary from './media/MediaLibrary'
import { AdminSessionContext, type AdminSession } from './settings/AdminSession'
import { stopPreview } from './settings/preview'

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'animations', label: 'Animations' },
  { id: 'backgrounds', label: 'Backgrounds' },
  { id: 'content', label: 'Content' },
  { id: 'media', label: 'Media' },
] as const

type SectionId = (typeof SECTIONS)[number]['id']

const LEAVE_PROMPT = 'You have unsaved changes in this section. Leave and discard them?'

interface Props {
  email: string
  sb: TypedSupabaseClient
  onSignOut: () => void
  onSessionExpired: () => void
  onAccessRefused: () => void
}

export default function AdminLayout({ email, sb, onSignOut, onSessionExpired, onAccessRefused }: Props) {
  const [active, setActive] = useState<SectionId>('general')
  const dirty = useRef(false)
  const setDirty = useCallback((d: boolean) => {
    dirty.current = d
  }, [])
  const session = useMemo<AdminSession>(() => ({ sb, onSessionExpired, onAccessRefused, setDirty }), [sb, onSessionExpired, onAccessRefused, setDirty])

  const canLeave = () => !dirty.current || window.confirm(LEAVE_PROMPT)
  const go = (id: SectionId) => {
    if (id === active || !canLeave()) return
    stopPreview()
    setActive(id)
  }
  const signOut = () => {
    if (!canLeave()) return
    stopPreview()
    onSignOut()
  }

  return (
    <AdminSessionContext.Provider value={session}>
      <div className="adm-shell">
        <header className="adm-header">
          <div className="adm-brand">
            <span className="adm-eyebrow">Portfolio CMS</span>
            <span className="adm-brand__name">Admin</span>
          </div>
          <div className="adm-account">
            {email && (
              <span className="adm-account__email" title={email}>
                {email}
              </span>
            )}
            <a className="adm-link" href="/" target="_blank" rel="noopener">
              View site
            </a>
            <button className="adm-button adm-button--quiet" onClick={signOut}>
              Sign out
            </button>
          </div>
        </header>

        <nav className="adm-nav" aria-label="Admin sections">
          <ul>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button className="adm-nav__item" aria-current={s.id === active ? 'page' : undefined} onClick={() => go(s.id)}>
                  {s.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className="adm-main" aria-labelledby="adm-section-title">
          {active === 'general' && <GeneralEditor />}
          {active === 'appearance' && <AppearanceEditor />}
          {active === 'animations' && <AnimationsEditor />}
          {active === 'backgrounds' && <BackgroundsEditor />}
          {active === 'content' && <ContentEditor />}
          {active === 'media' && <MediaLibrary />}
        </main>
      </div>
    </AdminSessionContext.Provider>
  )
}
