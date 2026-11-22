/**
 * The admin panel lives at /#admin. Kept in its own tiny module so main.tsx can decide
 * which app to load without pulling in any admin (or Supabase) code for visitors.
 */
export const ADMIN_HASH = '#admin'

export function isAdminRoute(hash: string = window.location.hash): boolean {
  return hash.toLowerCase() === ADMIN_HASH
}
