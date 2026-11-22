/** Input validation shared by the admin controls (pure; never corrects a value). */

const decimals = (step: number) => (String(step).split('.')[1] ?? '').length

/** Why `raw` isn't an acceptable value, or null. Never corrects the value. */
export function numberProblem(raw: string, min: number, max: number, step: number): string | null {
  const t = raw.trim()
  if (!t) return 'Enter a number.'
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(t)) return 'Enter a number (digits and an optional decimal point).'
  const v = Number(t)
  if (!Number.isFinite(v)) return 'Enter a number.'
  if (v < min || v > max) return `Must be between ${min} and ${max}.`
  const k = (v - min) / step
  if (Math.abs(k - Math.round(k)) > 1e-6) return `Must be in steps of ${step} (e.g. ${Number((min + Math.round(k) * step).toFixed(decimals(step)))}).`
  return null
}
