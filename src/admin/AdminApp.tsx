/**
 * CMS admin panel (Phase A: sign-in and the admin check only, no editing).
 * Loaded lazily from main.tsx when the address is /#admin, so none of this code, nor its
 * CSS, reaches ordinary visitors.
 *
 * Nothing admin-only renders until verifyAdmin() returns 'admin'. That gate is for the
 * UI; the database enforces access on its own through RLS.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { getSupabase, isSupabaseConfigured, type TypedSupabaseClient } from '../lib/supabase'
import { SIGN_IN_MESSAGES, signIn, signOut, verifyAdmin, type SignInProblem } from './adminAuth'
import AdminLayout from './AdminLayout'
import './admin.css'
import './editors.css'
import './content.css'
import './media.css'

/** A background re-check runs when the tab becomes visible, at most this often. */
const RECHECK_MS = 60_000

type Notice = 'expired' | 'signedOut' | 'signedOutLocal'

type State =
  | { kind: 'config' }
  | { kind: 'loading' }
  | { kind: 'signedOut'; notice?: Notice }
  | { kind: 'unauthorized' }
  | { kind: 'failed'; reason: 'network' | 'unknown' }
  | { kind: 'admin'; email: string }

const NOTICES: Record<Notice, string> = {
  expired: 'Your session has expired. Please sign in again.',
  signedOut: 'You have been signed out.',
  signedOutLocal:
    'You have been signed out on this device, but Supabase couldn’t be reached to end the session on the server. Sign in and out again once you’re back online.',
}

function createClient(): TypedSupabaseClient | null {
  if (!isSupabaseConfigured) return null
  try {
    return getSupabase()
  } catch {
    return null
  }
}

export default function AdminApp() {
  const [sb] = useState(createClient)
  const [state, setState] = useState<State>(() => (sb ? { kind: 'loading' } : { kind: 'config' }))
  const stateRef = useRef(state)
  useEffect(() => {
    stateRef.current = state
  }, [state])
  // Set while this tab itself signs in or out, so the auth listener doesn't react to it.
  const ownAction = useRef(false)
  const lastCheck = useRef(0)
  // Only the latest check (or sign-out) may update the screen; older results are dropped.
  const seq = useRef(0)
  // Bumped on every sign-out so the sign-in form always starts again from empty fields.
  const [formKey, setFormKey] = useState(0)

  /**
   * mode: 'show' replaces the screen with the loading state first; 'initial' is the first
   * check (already showing loading); 'background' re-checks an open panel silently and
   * keeps it open if the server can't be reached.
   */
  const verify = useCallback(
    async (mode: 'show' | 'initial' | 'background' = 'show') => {
      if (!sb) return
      const id = ++seq.current
      if (mode === 'show') setState({ kind: 'loading' })
      const result = await verifyAdmin(sb)
      if (id !== seq.current) return
      lastCheck.current = Date.now()
      switch (result.kind) {
        case 'admin':
          setState({ kind: 'admin', email: result.email })
          return
        case 'signedOut':
          setState({ kind: 'signedOut' })
          return
        case 'expired':
        case 'unauthorized':
          // Expired, or not an admin: end the session so it doesn't linger in this browser.
          ownAction.current = true
          await signOut(sb)
          ownAction.current = false
          if (id !== seq.current) return
          setState(result.kind === 'expired' ? { kind: 'signedOut', notice: 'expired' } : { kind: 'unauthorized' })
          return
        case 'failed':
          if (mode !== 'background') setState({ kind: 'failed', reason: result.reason })
      }
    },
    [sb],
  )

  useEffect(() => {
    document.title = 'Admin · Narahari Lenka'
    const robots = document.createElement('meta')
    robots.name = 'robots'
    robots.content = 'noindex, nofollow'
    document.head.append(robots)
    return () => robots.remove()
  }, [])

  // Initial check + react to sessions ending or starting in another tab.
  useEffect(() => {
    if (!sb) return
    // 'initial' sets no state synchronously: every update comes after the awaited check.
    // oxlint-disable-next-line react/set-state-in-effect
    void verify('initial')
    // Sessions are tab-scoped (src/lib/authStorage.ts). Auth events from OTHER tabs arrive
    // here too, but never carry a session into this tab: SIGNED_IN elsewhere is ignored, and
    // SIGNED_OUT only closes the panel if THIS tab's own session is really gone.
    const { data } = sb.auth.onAuthStateChange((event) => {
      if (ownAction.current) return
      // Deferred: supabase-js runs these callbacks while holding its auth lock.
      if (event === 'SIGNED_OUT' && stateRef.current.kind === 'admin') {
        setTimeout(async () => {
          const { data: own } = await sb.auth.getSession()
          if (!own.session && stateRef.current.kind === 'admin') setState({ kind: 'signedOut', notice: 'expired' })
        }, 0)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [sb, verify])

  // While the panel is open, re-check the session and admin row when the tab is shown again.
  useEffect(() => {
    if (state.kind !== 'admin') return
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastCheck.current > RECHECK_MS) void verify('background')
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [state.kind, verify])

  const handleSignOut = useCallback(async () => {
    if (!sb) return
    seq.current++
    ownAction.current = true
    setState({ kind: 'loading' })
    const confirmed = await signOut(sb)
    ownAction.current = false
    setFormKey((k) => k + 1)
    setState({ kind: 'signedOut', notice: confirmed === 'server' ? 'signedOut' : 'signedOutLocal' })
  }, [sb])

  // An editor found the session expired: sign out and ask to sign in again.
  const handleSessionExpired = useCallback(async () => {
    if (!sb) return
    seq.current++
    ownAction.current = true
    await signOut(sb)
    ownAction.current = false
    setFormKey((k) => k + 1)
    setState({ kind: 'signedOut', notice: 'expired' })
  }, [sb])

  // The database refused a write: re-check this account quietly. If it is no longer an
  // admin the panel closes; otherwise the editor keeps its draft and shows the error.
  const handleAccessRefused = useCallback(() => void verify('background'), [verify])
  const onSessionExpired = useCallback(() => void handleSessionExpired(), [handleSessionExpired])

  if (state.kind === 'admin' && sb)
    return (
      <AdminLayout
        email={state.email}
        sb={sb}
        onSignOut={handleSignOut}
        onSessionExpired={onSessionExpired}
        onAccessRefused={handleAccessRefused}
      />
    )

  return (
    <div className="adm-gate">
      <div className="adm-card">
        <p className="adm-eyebrow">Portfolio CMS</p>
        {state.kind === 'config' && (
          <Message title="Supabase isn’t configured">
            The admin panel needs <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> in{' '}
            <code>.env.local</code>. Add them (see <code>.env.example</code>) and restart the dev server or rebuild the site.
          </Message>
        )}
        {state.kind === 'loading' && (
          <div className="adm-loading" role="status" aria-live="polite">
            <span className="adm-spinner" aria-hidden="true" />
            Checking your session…
          </div>
        )}
        {state.kind === 'failed' && (
          <Message
            title={state.reason === 'network' ? 'Can’t reach Supabase' : 'Something went wrong'}
            action={<button className="adm-button" onClick={() => void verify()}>Try again</button>}
          >
            {state.reason === 'network'
              ? 'Your session couldn’t be checked. Check your connection and try again.'
              : 'Your session couldn’t be checked. Try again, or sign in again if this keeps happening.'}
          </Message>
        )}
        {state.kind === 'unauthorized' && (
          <Message
            title="Not an administrator"
            action={
              <button className="adm-button" onClick={() => setState({ kind: 'signedOut' })}>
                Sign in with another account
              </button>
            }
          >
            This account doesn’t have access to the admin panel, so it has been signed out.
          </Message>
        )}
        {state.kind === 'signedOut' && sb && (
          <SignInForm
            key={formKey}
            sb={sb}
            notice={state.notice}
            onSignedIn={() => verify()}
            setOwnAction={(on) => (ownAction.current = on)}
          />
        )}
        <a className="adm-back" href="/">
          ← Back to the portfolio
        </a>
      </div>
    </div>
  )
}

function Message({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div role="alert">
      <h1 className="adm-title">{title}</h1>
      <p className="adm-text">{children}</p>
      {action}
    </div>
  )
}

function SignInForm({
  sb,
  notice,
  onSignedIn,
  setOwnAction,
}: {
  sb: TypedSupabaseClient
  notice?: Notice
  onSignedIn: () => Promise<void>
  setOwnAction: (on: boolean) => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<SignInProblem | null>(null)

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (pending) return
    // Values filled in by the browser's password manager don't always reach React state
    // before submit (Chrome withholds them until the page is interacted with), so fall
    // back to what the fields actually contain.
    const form = new FormData(e.currentTarget)
    const typedEmail = email || String(form.get('email') ?? '')
    const typedPassword = password || String(form.get('password') ?? '')
    setPending(true)
    setProblem(null)
    setOwnAction(true)
    const result = await signIn(sb, typedEmail, typedPassword)
    setOwnAction(false)
    // The password is never kept: cleared after every attempt, successful or not.
    setPassword('')
    if (!result.ok) setEmail(typedEmail)
    if (result.ok) {
      await onSignedIn()
      return
    }
    setPending(false)
    setProblem(result.problem)
  }

  // Standard login markup (method=post, username + current-password) so password managers
  // work as intended; method=post also keeps the values out of the URL if the form were
  // ever submitted without this handler.
  return (
    <form className="adm-form" method="post" onSubmit={submit} noValidate>
      <h1 className="adm-title">Sign in</h1>
      {notice && !problem && (
        <p className="adm-notice" role="status">
          {NOTICES[notice]}
        </p>
      )}
      {problem && (
        <p className="adm-error" role="alert">
          {SIGN_IN_MESSAGES[problem]}
        </p>
      )}
      <label className="adm-field">
        <span>Email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={pending}
        />
      </label>
      <label className="adm-field">
        <span>Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={pending}
        />
      </label>
      <button className="adm-button adm-button--wide" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
