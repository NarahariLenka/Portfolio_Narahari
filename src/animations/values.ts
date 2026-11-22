/**
 * Safe value helpers shared by the registry (developer defaults) and the CMS parser.
 * Every lookup by an outside key goes through an own-property check, so names such as
 * "constructor", "toString" or "__proto__" can never resolve to Object.prototype members.
 */
import type { AnyAnimationDefinition, ParamSpec } from './types'

type Obj = Record<string, unknown>

/** A plain object, or {} for anything else (null, arrays, strings…). */
export const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))

/** Own property of a plain object, else undefined (never an inherited member). */
export const own = (o: unknown, key: string): unknown =>
  o !== null && typeof o === 'object' && Object.hasOwn(o, key) ? (o as Obj)[key] : undefined

const roundTo = (v: number, step: number, min: number) => {
  const decimals = (String(step).split('.')[1] ?? '').length
  return Number((Math.round((v - min) / step) * step + min).toFixed(decimals))
}

/** The definition's spec for a param name, only if it is a real, own entry. */
export function paramSpec(def: AnyAnimationDefinition, key: string): ParamSpec | undefined {
  const spec = own(def.params, key)
  if (!spec || typeof spec !== 'object') return undefined
  const kind = (spec as { kind?: unknown }).kind
  return kind === 'number' || kind === 'boolean' || kind === 'choice' ? (spec as ParamSpec) : undefined
}

/** Validates one value against its spec: clamped + rounded number, boolean, or listed option. */
export function cleanValue(spec: ParamSpec, v: unknown): unknown {
  if (spec.kind === 'number') return isNum(v) ? roundTo(clamp(v, spec.min, spec.max), spec.step, spec.min) : undefined
  if (spec.kind === 'boolean') return typeof v === 'boolean' ? v : undefined
  return typeof v === 'string' && Array.isArray(spec.options) && spec.options.includes(v) ? v : undefined
}

/**
 * Keeps only known params with valid values. `rejected` receives the names of entries
 * that were unknown or invalid.
 */
export function cleanParams(def: AnyAnimationDefinition, input: unknown, rejected?: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(obj(input))) {
    const spec = paramSpec(def, key)
    const clean = spec ? cleanValue(spec, v) : undefined
    if (clean === undefined) rejected?.push(key)
    else out[key] = clean
  }
  return out
}
