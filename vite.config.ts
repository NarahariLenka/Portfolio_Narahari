import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv } from 'vite'
import bootPreload from './boot-preload.ts'
import contentGuard from './content-guard.ts'

export default defineConfig(({ mode }) => {
  // Only the public (VITE_) Supabase settings are read here: the URL (preconnect) and the
  // publishable key for the early published-content requests (never a secret key).
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [contentGuard(), react(), tailwindcss(), bootPreload(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY)],
    // Reachable at http://localhost:5174 and http://127.0.0.1:5174 (IPv4 and IPv6).
    server: { host: true, port: 5174, open: true },
    preview: { host: true, port: 4174 },
  }
})
