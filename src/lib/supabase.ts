/**
 * Shared, typed Supabase client for the browser.
 *
 * Reads VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY from .env.local. Only the
 * publishable (public) key belongs here: anything prefixed VITE_ is bundled into the
 * website and visible to every visitor, so secret / service-role keys are refused.
 *
 * Auth sessions are tab-scoped (src/lib/authStorage.ts); the public site never signs in.
 *
 * The client is created lazily on first use, so a missing or invalid configuration never
 * affects the rest of the portfolio until a feature actually needs Supabase.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { removeLegacyPersistentSession, tabScopedStorage } from './authStorage'
import type { Database } from './database.types'
import { validateSupabaseEnv } from './supabaseEnv'

export { isSupabaseConfigured, validateSupabaseEnv } from './supabaseEnv'

export type TypedSupabaseClient = SupabaseClient<Database>

export class SupabaseConfigError extends Error {
  constructor(problems: string[]) {
    super(
      `Supabase is not configured correctly:\n` +
        problems.map((p) => `  • ${p}`).join('\n') +
        `\n\nAdd the values to .env.local in the project root (see .env.example), then restart the dev server.`,
    )
    this.name = 'SupabaseConfigError'
  }
}

let client: TypedSupabaseClient | null = null

/** Returns the shared client, creating it on first use. Throws SupabaseConfigError if misconfigured. */
export function getSupabase(): TypedSupabaseClient {
  if (client) return client
  const { ok, url, key, problems } = validateSupabaseEnv()
  if (!ok) throw new SupabaseConfigError(problems)
  // The session is tab-scoped (sessionStorage, see authStorage.ts): a refresh keeps it, a
  // new tab must sign in again. Any old persistent copy in localStorage is removed first.
  removeLegacyPersistentSession()
  client = createClient<Database>(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storage: tabScopedStorage() },
  })
  return client
}
