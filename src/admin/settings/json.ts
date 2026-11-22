/**
 * Plain-JSON helpers for the settings editors: safe path edits (own properties only, no
 * prototype keys), structural equality, leaf diffs, and the size PostgreSQL measures for
 * the JSONB size constraints.
 *
 * Editors never rebuild a JSON column from what they understand. They start from a copy
 * of the stored value and change single paths, so keys they don't know survive a save.
 */

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
export type JsonObject = { [key: string]: Json }
export type Path = readonly string[]

/** Keys that could reach Object.prototype through assignment; never written or followed. */
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor'])

export const isObject = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v)

export const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => deepEqual(v, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a)
    if (ka.length !== Object.keys(b).length) return false
    return ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
  }
  return false
}

function assertPath(path: Path) {
  for (const k of path) if (FORBIDDEN.has(k)) throw new Error(`forbidden key "${k}"`)
}

/** Value at path (own properties only), or undefined. */
export function getPath(root: unknown, path: Path): unknown {
  let cur: unknown = root
  for (const k of path) {
    if (!isObject(cur) || !Object.hasOwn(cur, k)) return undefined
    cur = cur[k]
  }
  return cur
}

/**
 * Returns a copy of `root` with `value` at `path`. Missing (or non-object) containers on
 * the way are created as objects. `root` itself is never mutated.
 */
export function setPath(root: Json, path: Path, value: Json): Json {
  assertPath(path)
  if (!path.length) return clone(value)
  const out: JsonObject = isObject(root) ? clone(root) : {}
  let cur = out
  for (let i = 0; i < path.length - 1; i++) {
    const k = path[i]
    if (!isObject(cur[k])) cur[k] = {}
    cur = cur[k] as JsonObject
  }
  cur[path[path.length - 1]] = clone(value)
  return out
}

/**
 * Returns a copy of `root` without the key at `path`. Containers left empty by the
 * removal are removed as well (so setting then resetting a value gives back the original
 * JSON), but never the root itself.
 */
export function deletePath(root: Json, path: Path): Json {
  assertPath(path)
  if (!path.length || !isObject(root) || getPath(root, path) === undefined) return root
  const out = clone(root)
  const chain: JsonObject[] = [out]
  for (let i = 0; i < path.length - 1; i++) chain.push(chain[i][path[i]] as JsonObject)
  delete chain[path.length - 1][path[path.length - 1]]
  for (let i = path.length - 1; i > 0; i--) {
    if (Object.keys(chain[i]).length) break
    delete chain[i - 1][path[i - 1]]
  }
  return out
}

export type LeafChange = { path: string[]; value: Json } | { path: string[]; remove: true }

/** Leaf-level differences that turn `from` into `to` (arrays count as single values). */
export function diffLeaves(from: unknown, to: unknown, base: string[] = []): LeafChange[] {
  if (deepEqual(from, to)) return []
  // A new (or replaced) non-empty object is described by its leaves too, so every value
  // in it can be checked and re-applied on its own.
  if (isObject(to) && Object.keys(to).length && (isObject(from) || from === undefined || from === null || typeof from !== 'object')) {
    const prev: JsonObject = isObject(from) ? from : {}
    const out: LeafChange[] = []
    for (const k of new Set([...Object.keys(prev), ...Object.keys(to)])) {
      if (!Object.hasOwn(to, k)) out.push({ path: [...base, k], remove: true })
      else out.push(...diffLeaves(Object.hasOwn(prev, k) ? prev[k] : undefined, to[k], [...base, k]))
    }
    return out
  }
  if (isObject(from) && isObject(to)) {
    // `to` is empty here: every key of `from` was removed.
    return Object.keys(from).map((k) => ({ path: [...base, k], remove: true as const }))
  }
  return to === undefined ? [{ path: base, remove: true }] : [{ path: base, value: to as Json }]
}

/** Applies leaf changes (from diffLeaves) to another value. */
export function applyLeaves(root: Json, changes: LeafChange[]): Json {
  let out = root
  for (const c of changes) out = 'remove' in c ? deletePath(out, c.path) : setPath(out, c.path, c.value)
  return out
}

// ---------------------------------------------------------------------------- JSONB size

const utf8 = new TextEncoder()

/** Length of PostgreSQL's numeric text output for a JS number (expands exponent notation). */
function numericTextLength(n: number): number {
  const s = String(n)
  const m = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(s)
  if (!m) return s.length
  const [, sign, int, frac = '', expRaw] = m
  const digits = int + frac
  const exp = Number(expRaw)
  const pointPos = int.length + exp // digits before the decimal point
  const body = pointPos <= 0 ? 2 + -pointPos + digits.length : pointPos >= digits.length ? pointPos : digits.length + 1
  return sign.length + body
}

/** Length of a string as PostgreSQL prints it inside JSON (escape_json). */
function jsonStringBytes(s: string): number {
  let extra = 2 // quotes
  for (const ch of s) {
    const c = ch.codePointAt(0)!
    if (ch === '"' || ch === '\\' || c === 8 || c === 9 || c === 10 || c === 12 || c === 13) extra += 1
    else if (c < 0x20) extra += 5 // \u00XX
  }
  return utf8.encode(s).length + extra
}

/**
 * Bytes of `value::text` for a jsonb value — what the database's
 * octet_length(column::text) size checks measure. jsonb prints ", " between items and
 * ": " after keys, which JSON.stringify does not, so JSON.stringify().length undercounts.
 */
export function jsonbTextBytes(value: unknown): number {
  if (value === null || value === undefined) return 4
  if (typeof value === 'boolean') return value ? 4 : 5
  if (typeof value === 'number') return Number.isFinite(value) ? numericTextLength(value) : 4
  if (typeof value === 'string') return jsonStringBytes(value)
  if (Array.isArray(value)) {
    if (!value.length) return 2
    return 2 + value.reduce<number>((n, v) => n + jsonbTextBytes(v), 0) + 2 * (value.length - 1)
  }
  if (isObject(value)) {
    const entries = Object.entries(value)
    if (!entries.length) return 2
    return 2 + entries.reduce((n, [k, v]) => n + jsonStringBytes(k) + 2 + jsonbTextBytes(v), 0) + 2 * (entries.length - 1)
  }
  return 4
}
