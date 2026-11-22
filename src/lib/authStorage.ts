/**
 * Where the Supabase Auth session is kept: TAB-SCOPED (sessionStorage).
 *
 *   • A refresh of the same tab keeps the session.
 *   • A new, independent tab starts signed out, so the CMS asks to sign in again.
 *   • Closing the tab discards it (no unload handler involved: the browser drops the tab's
 *     sessionStorage itself).
 * Browser behaviour this can't override (sessionStorage is defined that way):
 *   • "Duplicate tab", and tabs opened by script from the admin without noopener, start
 *     with a COPY of the tab's sessionStorage, so they are signed in too.
 *   • Reopening a closed tab (Ctrl/Cmd+Shift+T) or a restored browser session may bring
 *     the tab's sessionStorage back.
 * If sessionStorage is unavailable (blocked storage), the session lives in memory only and
 * a refresh signs out — never falling back to persistent storage.
 *
 * Earlier versions kept the session in localStorage (persistent, shared by all tabs);
 * removeLegacyPersistentSession() deletes that copy so it can't linger or be reused.
 */

export interface AuthStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Supabase's own session keys: sb-<project>-auth-token (and its PKCE helper key). */
export const SESSION_KEY = /^sb-.+-auth-token(-code-verifier|-user)?$/

function memoryStorage(): AuthStorage {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

/** sessionStorage if it works here, else memory. Never localStorage. */
export function tabScopedStorage(session: Storage | undefined = typeof window !== 'undefined' ? safe(() => window.sessionStorage) : undefined): AuthStorage {
  try {
    if (!session) return memoryStorage()
    const probe = '__sb_probe__'
    session.setItem(probe, '1')
    session.removeItem(probe)
  } catch {
    return memoryStorage()
  }
  const fallback = memoryStorage()
  // Each call guarded: storage can become unavailable later (quota, privacy settings).
  return {
    getItem: (k) => safe(() => session.getItem(k)) ?? fallback.getItem(k),
    setItem: (k, v) => {
      try {
        session.setItem(k, v)
      } catch {
        fallback.setItem(k, v)
      }
    },
    removeItem: (k) => {
      safe(() => session.removeItem(k))
      fallback.removeItem(k)
    },
  }
}

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn()
  } catch {
    return undefined
  }
}

/** Deletes Supabase session keys from a Storage (used for the old localStorage copy and on sign-out). */
export function removeSessionKeys(storage: Pick<Storage, 'length' | 'key' | 'removeItem'> | undefined): number {
  if (!storage) return 0
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && SESSION_KEY.test(k)) keys.push(k)
    }
    keys.forEach((k) => storage.removeItem(k))
    return keys.length
  } catch {
    return 0 // storage blocked: nothing could have been stored there either
  }
}

/** Removes a persistent session left in localStorage by earlier versions. */
export const removeLegacyPersistentSession = () => removeSessionKeys(typeof window !== 'undefined' ? safe(() => window.localStorage) : undefined)
