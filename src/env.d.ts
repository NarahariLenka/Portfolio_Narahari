/// <reference types="vite/client" />

/** Public (browser-safe) environment variables. Never put secret keys in VITE_ variables. */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
