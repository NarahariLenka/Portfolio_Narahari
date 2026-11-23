/**
 * Build-time loading hints for the public site (index.html):
 *   • An inline script that starts the 7 published-content requests while the page's
 *     JavaScript is still downloading (remoteLoader.ts picks up the in-flight answers, so
 *     nothing is requested twice). Same published-only queries as the loader
 *     (src/data/publishedQueries.ts), sent anonymously with the publishable key that is
 *     already public in the bundle. Skipped on /#admin and ?content=local.
 *   • <link rel="modulepreload"> for the chunks the first render needs after boot: the
 *     content loader and the App with its static imports, plus <link rel="preload"
 *     as="style"> for their CSS — downloaded in parallel instead of one after another.
 *     A preload only downloads; modules still run in the original order.
 *   • <link rel="preconnect"> to the Supabase project.
 *   • <link rel="preload" as="font"> for the Latin Space Grotesk file (the first screen's font).
 * Build only; the dev server is unchanged.
 */
import { existsSync, readFileSync } from 'node:fs'
import type { Plugin } from 'vite'
import { PREFETCH_GLOBAL, PUBLISHED_QUERIES } from './src/data/publishedQueries.ts'

/**
 * The hero portrait from the local content (content/home.json), or the placeholder: the
 * largest image on the first screen (the LCP element). Without a hint it is only requested
 * once the app has booted and rendered the hero. Same file name rules as image() in
 * src/data/content.ts. A portrait published from the CMS replaces it at runtime; this small
 * file is then fetched without being used.
 */
export function localPortraitHref(root = process.cwd()): string | null {
  let name = 'portrait-placeholder.webp'
  try {
    const v = (JSON.parse(readFileSync(`${root}/content/home.json`, 'utf8')) as { portraitImage?: unknown }).portraitImage
    if (typeof v === 'string' && /^[\w.-]+\.(webp|avif|png|jpe?g)$/i.test(v.trim())) name = v.trim()
  } catch {
    // no local content: fall back to the placeholder
  }
  return existsSync(`${root}/public/images/portrait/${name}`) ? `/images/portrait/${encodeURIComponent(name)}` : null
}

const ENTRY_HINTS = ['src/App.tsx', 'src/data/remoteLoader.ts']

type Tag = { tag: string; attrs?: Record<string, string | boolean>; children?: string; injectTo: 'head' | 'head-prepend' }

/** True for keys that must never reach a browser (secret / service-role). */
export function isSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true
  const part = key.split('.')[1]
  if (!part) return false
  try {
    return (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { role?: string }).role === 'service_role'
  } catch {
    return false
  }
}

/** The inline early-request script (plain ES5-style JS, no dependencies). */
export function prefetchScript(origin: string, key: string): string {
  const urls = Object.fromEntries(Object.entries(PUBLISHED_QUERIES).map(([t, q]) => [t, `${origin}/rest/v1/${t}?select=*&${q}`]))
  return `;(function () {
  try {
    if (location.hash.toLowerCase() === '#admin' || /[?&]content=local\\b/.test(location.search) || !window.fetch) return
    var k = ${JSON.stringify(key)}
    var h = { apikey: k, Authorization: 'Bearer ' + k, Accept: 'application/json' }
    var urls = ${JSON.stringify(urls)}
    var out = {}
    for (var t in urls) {
      out[t] = fetch(urls[t], { headers: h }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)) })
      out[t].catch(function () {}) // handled by the app; avoids an unhandled-rejection report
    }
    window[${JSON.stringify(PREFETCH_GLOBAL)}] = out
  } catch (e) {}
})()`
}

export default function bootPreload(supabaseUrl: string | undefined, publishableKey?: string): Plugin {
  return {
    name: 'boot-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const tags: Tag[] = []
        let script = ''
        let origin: string | null = null
        try {
          if (supabaseUrl) {
            const o = new URL(supabaseUrl).origin
            if (o.startsWith('https://')) origin = o
          }
        } catch {
          // invalid URL: no hints (the app reports configuration problems itself)
        }
        if (origin) {
          tags.push({ tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: true }, injectTo: 'head-prepend' })
          // Placed at the marker right after <meta charset>/<viewport> and before any stylesheet
          // (an inline script after a stylesheet would wait for it to load).
          if (publishableKey && !isSecretKey(publishableKey)) script = `<script>${prefetchScript(origin, publishableKey)}</script>`
        }
        const out = (t: Tag[]) => ({ html: html.replace(/<!-- cms-prefetch:[^>]*-->/, script), tags: t })
        const bundle = ctx.bundle
        if (!bundle) return out(tags)
        const chunks = Object.values(bundle).filter((c) => c.type === 'chunk')
        const files = new Set<string>()
        const add = (fileName: string) => {
          if (files.has(fileName)) return
          files.add(fileName)
          const c = chunks.find((x) => x.fileName === fileName)
          if (c && c.type === 'chunk') c.imports.forEach(add)
        }
        for (const entry of ENTRY_HINTS) {
          const c = chunks.find((x) => x.type === 'chunk' && x.facadeModuleId?.replace(/\\/g, '/').endsWith(entry))
          if (c) add(c.fileName)
        }
        // Already loaded by index.html itself.
        const entries = new Set(chunks.filter((c) => c.type === 'chunk' && c.isEntry).map((c) => c.fileName))
        const css = new Set<string>()
        for (const f of files) {
          const c = chunks.find((x) => x.fileName === f)
          const meta = c && c.type === 'chunk' ? (c as unknown as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata : undefined
          if (!entries.has(f)) meta?.importedCss?.forEach((x) => css.add(x))
        }
        for (const f of entries) files.delete(f)
        // crossorigin must match Vite's dynamic-import loader, which requests these stylesheets
        // in CORS mode; without it the browser can't reuse the preload and downloads each twice.
        for (const f of css) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'style', crossorigin: true, href: `/${f}` }, injectTo: 'head' })
        // The Latin Space Grotesk file — the only face the first screen uses — fetched right away.
        for (const a of Object.values(bundle))
          if (a.type === 'asset' && /(^|\/)space-grotesk-latin-(?!ext-)[\w-]+\.woff2$/.test(a.fileName))
            tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: true, href: `/${a.fileName}` }, injectTo: 'head' })
        const portrait = localPortraitHref()
        if (portrait) tags.push({ tag: 'link', attrs: { rel: 'preload', as: 'image', href: portrait, fetchpriority: 'high' }, injectTo: 'head' })
        for (const f of files) tags.push({ tag: 'link', attrs: { rel: 'modulepreload', crossorigin: true, href: `/${f}` }, injectTo: 'head' })
        return out(tags)
      },
    },
  }
}
