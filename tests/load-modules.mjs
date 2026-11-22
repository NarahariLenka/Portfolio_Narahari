/**
 * Loads the app's TypeScript modules in Node through the project's own Vite (no extra
 * test dependencies). Used by the *.test.mjs files, run with `npm test`.
 */
import { createServer } from 'vite'

let server

export async function loadModules(paths) {
  server ??= await createServer({
    configFile: false,
    root: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false, watch: null },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  return Promise.all(paths.map((p) => server.ssrLoadModule(p)))
}

export async function closeModules() {
  await server?.close()
  server = undefined
}
