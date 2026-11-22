/** Media-path existence check for the content editor (no download, nothing changed). */
import type { TypedSupabaseClient } from '../../lib/supabase'

export type MediaStatus = 'checking' | 'found' | 'missing' | 'unknown'

/** Whether a path exists in the public media bucket (HEAD request, nothing downloaded). */
export async function checkMedia(sb: TypedSupabaseClient, path: string): Promise<MediaStatus> {
  try {
    const url = sb.storage.from('portfolio-media').getPublicUrl(path).data.publicUrl
    const res = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (res.ok) return 'found'
    return res.status === 400 || res.status === 404 ? 'missing' : 'unknown'
  } catch {
    return 'unknown'
  }
}
