/**
 * Safety net for the editable /content files.
 *
 * If a content file has a typing mistake (missing comma, quote…), the site keeps using the
 * last version that worked, and a clear message names the file, line and problem — in the
 * terminal and as a red bar at the top of the page (development only). Fix the file, save,
 * and the message disappears.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// Vite module ids use forward slashes on every platform.
const CONTENT_DIR = path.join(ROOT, 'content').split(path.sep).join('/')
const BACKUP_DIR = path.join(ROOT, 'node_modules', '.content-backup')

function explain(file: string, code: string, error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  let where = ''
  const pos = /position (\d+)/.exec(raw)
  if (pos) {
    const before = code.slice(0, Number(pos[1]))
    where = `line ${before.split('\n').length}`
  }
  const lineCol = /line (\d+) column (\d+)/.exec(raw)
  if (lineCol) where = `line ${lineCol[1]}`
  return `content/${file}${where ? ` (${where})` : ''}: there is a typing mistake near here — usually a missing comma, a missing quote mark ", or a missing { } [ ]. The site is showing the last version that worked until you fix it.`
}

export default function contentGuard(): Plugin {
  const errors = new Map<string, string>()
  let server: ViteDevServer | undefined

  const broadcast = () => server?.ws.send({ type: 'custom', event: 'content-errors', data: [...errors.values()] })

  return {
    name: 'content-guard',
    enforce: 'pre',
    configureServer(s) {
      server = s
      s.middlewares.use('/__content-errors', (_req, res) => {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify([...errors.values()]))
      })
    },
    transform(code, id) {
      const file = id.split('?')[0]
      if (!file.startsWith(CONTENT_DIR) || !file.endsWith('.json')) return null
      const name = path.basename(file)
      const backup = path.join(BACKUP_DIR, name)
      try {
        JSON.parse(code)
        fs.mkdirSync(BACKUP_DIR, { recursive: true })
        fs.writeFileSync(backup, code)
        if (errors.delete(name)) broadcast()
        return null
      } catch (error) {
        const message = explain(name, code, error)
        errors.set(name, message)
        broadcast()
        this.warn(message)
        if (fs.existsSync(backup)) return { code: fs.readFileSync(backup, 'utf8'), map: null }
        // No working version saved yet: stop with the clear message.
        this.error(message)
      }
    },
  }
}
