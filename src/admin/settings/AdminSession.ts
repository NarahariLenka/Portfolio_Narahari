/**
 * What every editor needs from the signed-in admin panel: the Supabase client, a way to
 * report that the session ended or that the database refused the account, and a way to
 * tell the layout that there are unsaved changes.
 */
import { createContext, useContext } from 'react'
import type { TypedSupabaseClient } from '../../lib/supabase'

export interface AdminSession {
  sb: TypedSupabaseClient
  /** The session is no longer valid: the panel signs out and shows the sign-in form. */
  onSessionExpired: () => void
  /** The database refused a write: the panel re-checks whether this account is still an admin. */
  onAccessRefused: () => void
  /** The open editor reports whether it has unsaved changes. */
  setDirty: (dirty: boolean) => void
}

export const AdminSessionContext = createContext<AdminSession | null>(null)

export function useAdminSession(): AdminSession {
  const s = useContext(AdminSessionContext)
  if (!s) throw new Error('useAdminSession() outside the admin panel')
  return s
}
