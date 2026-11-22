/**
 * Local previews: temporary changes applied in THIS browser tab only, never written to
 * Supabase. One preview at a time; each one registers how to undo itself, and
 * stopPreview() is called when the preview is closed, the draft is discarded or saved,
 * the editor is left, and on sign-out, so nothing temporary stays active.
 */

type Restore = () => void

let active: { id: string; restore: Restore } | null = null
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((l) => l())

/** Starts a preview (stopping any other first). `apply` runs now; `restore` undoes it. */
export function startPreview(id: string, apply: () => void, restore: Restore) {
  stopPreview()
  try {
    apply()
    active = { id, restore }
  } catch (error) {
    // A preview that can't be applied is undone at once and reported to the caller.
    try {
      restore()
    } catch {
      // ignore
    }
    throw error
  } finally {
    notify()
  }
}

/** Stops the running preview (or the one with this id). Safe to call any time. */
export function stopPreview(id?: string) {
  if (!active || (id && active.id !== id)) return
  const { restore } = active
  active = null
  try {
    restore()
  } finally {
    notify()
  }
}

export const activePreview = () => active?.id ?? null

export function subscribePreview(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
