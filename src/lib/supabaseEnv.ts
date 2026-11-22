/**
 * Supabase configuration check (no Supabase library here, so the public site can read the
 * settings without downloading the client). Re-exported by supabase.ts.
 *
 * Only the publishable (public) key belongs in VITE_ variables: they are bundled into the
 * website and visible to every visitor, so secret / service-role keys are refused.
 */
/** Decodes a legacy JWT-style key's payload (no verification; only used to reject secrets). */
function jwtRole(key: string): string | undefined {
  const part = key.split('.')[1]
  if (!part) return undefined
  try {
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'))
    return (JSON.parse(json) as { role?: string }).role
  } catch {
    return undefined
  }
}

// Read the two variables by name: referencing `import.meta.env` as a whole would make Vite
// inline EVERY VITE_* variable (including host-injected ones such as Vercel's system
// variables) into the public bundle.
const BUILD_ENV = {
  VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
} as ImportMetaEnv

export function validateSupabaseEnv(env: ImportMetaEnv = BUILD_ENV) {
  const url = env.VITE_SUPABASE_URL?.trim() ?? ''
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
  const problems: string[] = []

  if (!url) {
    problems.push('VITE_SUPABASE_URL is missing (e.g. https://<project-ref>.supabase.co).')
  } else {
    try {
      const parsed = new URL(url)
      if (!/^https?:$/.test(parsed.protocol)) problems.push('VITE_SUPABASE_URL must start with https://.')
    } catch {
      problems.push(`VITE_SUPABASE_URL is not a valid URL: "${url}".`)
    }
  }

  if (!key) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY is missing (Supabase dashboard → Project Settings → API Keys → publishable key).')
  } else if (key.startsWith('sb_secret_') || jwtRole(key) === 'service_role') {
    problems.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY contains a SECRET / service-role key. Never use it in the browser — replace it with the publishable key and rotate the secret key in the Supabase dashboard.',
    )
  } else if (!key.startsWith('sb_publishable_') && jwtRole(key) !== 'anon') {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY does not look like a publishable key (expected it to start with "sb_publishable_").')
  }

  return { ok: problems.length === 0, url, key, problems }
}

/** True when both variables are present and valid — handy for optional features. */
export const isSupabaseConfigured = validateSupabaseEnv().ok
