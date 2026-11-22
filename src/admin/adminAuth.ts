/**
 * Admin sign-in and the "is this user an admin?" check.
 *
 * The check only decides what the admin UI shows. Real authorisation is enforced by
 * Supabase RLS: every write policy calls public.is_admin(), so a non-admin who got past
 * this screen still could not change anything.
 *
 * Errors are classified by shape (name / status / code) rather than by class, so the logic
 * is testable with plain objects. Raw server messages and tokens are never shown or logged.
 */
import { removeSessionKeys } from '../lib/authStorage'
import type { TypedSupabaseClient } from '../lib/supabase'

/** Longest a sign-in or verification may take before it counts as a network failure. */
export const REQUEST_TIMEOUT_MS = 10_000

export type SignInProblem = 'missing' | 'invalid' | 'unconfirmed' | 'rateLimited' | 'network' | 'unknown'

export type VerifyResult =
  | { kind: 'signedOut' }
  | { kind: 'expired' }
  | { kind: 'unauthorized' }
  | { kind: 'admin'; userId: string; email: string }
  | { kind: 'failed'; reason: 'network' | 'unknown' }

interface ErrorLike {
  name?: string
  status?: number
  code?: string
  message?: string
}

const asError = (e: unknown): ErrorLike => (e && typeof e === 'object' ? (e as ErrorLike) : {})

/** Network failures: unreachable server, offline, CORS, our own timeout. */
export function isNetworkError(e: unknown): boolean {
  const err = asError(e)
  if (err.name === 'AuthRetryableFetchError' || err.name === 'TimeoutError' || err.name === 'AbortError') return true
  if (err.name === 'TypeError' && /fetch|network|load failed/i.test(err.message ?? '')) return true
  // PostgREST reports a failed fetch as { message: 'TypeError: Failed to fetch', code: '' }.
  return !err.code && /failed to fetch|networkerror|network request failed|load failed|timed out/i.test(err.message ?? '')
}

export function classifySignInError(e: unknown): SignInProblem {
  if (isNetworkError(e)) return 'network'
  const { status, code, message = '' } = asError(e)
  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) return 'invalid'
  if (code === 'email_not_confirmed') return 'unconfirmed'
  if (status === 429 || code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'rateLimited'
  if (code === 'validation_failed' || code === 'email_address_invalid') return 'invalid'
  return 'unknown'
}

export const SIGN_IN_MESSAGES: Record<SignInProblem, string> = {
  missing: 'Enter your email and password.',
  invalid: 'Email or password is incorrect.',
  unconfirmed: 'This account’s email address has not been confirmed yet.',
  rateLimited: 'Too many sign-in attempts. Wait a few minutes and try again.',
  network: 'Can’t reach Supabase. Check your connection and try again.',
  unknown: 'Sign-in failed. Please try again.',
}

/** PostgREST rejected the access token itself (expired / invalid JWT). */
export function isJwtError(e: unknown): boolean {
  const { code, status, message = '' } = asError(e)
  return (typeof code === 'string' && code.startsWith('PGRST30')) || status === 401 || /jwt/i.test(message)
}

/** Rejects with a TimeoutError if the promise takes longer than `ms`. */
export function withTimeout<T>(promise: PromiseLike<T>, ms = REQUEST_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })), ms)
  })
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer))
}

/** Logs only the error's kind and code — never tokens, emails or full server responses. */
function logProblem(step: string, e: unknown) {
  const { name, status, code } = asError(e)
  console.warn(`[admin] ${step} failed`, { name, status, code })
}

/**
 * Who is signed in, and are they an admin?
 *  1. a local session must exist;
 *  2. the server must accept it (getUser, not just the locally stored session);
 *  3. RLS lets a signed-in user read only their own row in public.admins, so the row
 *     being returned is the server's own answer.
 */
export async function verifyAdmin(sb: TypedSupabaseClient, ms = REQUEST_TIMEOUT_MS): Promise<VerifyResult> {
  try {
    const { data: s, error: sessionError } = await withTimeout(sb.auth.getSession(), ms)
    if (sessionError) {
      logProblem('session', sessionError)
      return isNetworkError(sessionError) ? { kind: 'failed', reason: 'network' } : { kind: 'expired' }
    }
    if (!s.session) return { kind: 'signedOut' }

    const { data: u, error: userError } = await withTimeout(sb.auth.getUser(), ms)
    if (userError || !u.user) {
      logProblem('user', userError)
      return isNetworkError(userError) ? { kind: 'failed', reason: 'network' } : { kind: 'expired' }
    }

    const { data: row, error: rowError } = await withTimeout(
      sb.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle().retry(false),
      ms,
    )
    if (rowError) {
      logProblem('admin check', rowError)
      if (isNetworkError(rowError)) return { kind: 'failed', reason: 'network' }
      return isJwtError(rowError) ? { kind: 'expired' } : { kind: 'failed', reason: 'unknown' }
    }
    if (!row || row.user_id !== u.user.id) return { kind: 'unauthorized' }
    return { kind: 'admin', userId: u.user.id, email: u.user.email ?? '' }
  } catch (e) {
    logProblem('verification', e)
    return { kind: 'failed', reason: isNetworkError(e) ? 'network' : 'unknown' }
  }
}

export async function signIn(
  sb: TypedSupabaseClient,
  email: string,
  password: string,
  ms = REQUEST_TIMEOUT_MS,
): Promise<{ ok: true } | { ok: false; problem: SignInProblem }> {
  const trimmed = email.trim()
  if (!trimmed || !password) return { ok: false, problem: 'missing' }
  try {
    const { error } = await withTimeout(sb.auth.signInWithPassword({ email: trimmed, password }), ms)
    if (error) {
      logProblem('sign-in', error)
      return { ok: false, problem: classifySignInError(error) }
    }
    return { ok: true }
  } catch (e) {
    logProblem('sign-in', e)
    return { ok: false, problem: classifySignInError(e) }
  }
}

/**
 * Ends this browser's session: Supabase revokes it on the server (its refresh token can no
 * longer be used) and supabase-js deletes the stored copy.
 *
 * Returns 'server' when Supabase confirmed the sign-out, 'localOnly' when it couldn't be
 * reached: supabase-js still deletes the stored session, so this browser is signed out
 * either way, but the server-side session then lives on until it expires.
 */
export async function signOut(sb: TypedSupabaseClient): Promise<'server' | 'localOnly'> {
  try {
    const { error } = await withTimeout(sb.auth.signOut({ scope: 'local' }))
    if (!error) return 'server'
    logProblem('sign-out', error)
  } catch (e) {
    logProblem('sign-out', e)
  }
  // supabase-js already deletes the stored session after a failed request, but not if our
  // timeout fired first. Make sure nothing is left behind either way.
  clearStoredSession()
  return 'localOnly'
}

/**
 * Deletes any stored Supabase session in this browser without contacting the server: the
 * tab's sessionStorage and any old persistent copy in localStorage. `storages` is for tests.
 */
export function clearStoredSession(...storages: (Pick<Storage, 'length' | 'key' | 'removeItem'> | undefined)[]) {
  const targets = storages.length ? storages : [safeStorage('sessionStorage'), safeStorage('localStorage')]
  for (const s of targets) removeSessionKeys(s)
}

function safeStorage(name: 'sessionStorage' | 'localStorage'): Storage | undefined {
  try {
    return typeof window !== 'undefined' ? window[name] : undefined
  } catch {
    return undefined
  }
}
