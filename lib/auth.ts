import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * The signed-in user's profile row, or null when signed out.
 *
 * Wrapped in React `cache()` so the Nav (rendered in the root layout) and the
 * page body below it share a single lookup per request, rather than each
 * paying for its own pair of round trips.
 */
export const getCurrentProfile = cache(async () => {
  const supabase = await createClient()

  // `getClaims` verifies the access token locally against the project's
  // asymmetric (ES256) signing key, so the common case costs no network call.
  // `getUser` always hits the Auth server — ~140ms on every single render.
  // An expired token still refreshes: `getClaims` reads it via `getSession`.
  const { data: claims } = await supabase.auth.getClaims()
  const userId = claims?.claims.sub
  if (!userId) return null

  const { data } = await supabase
    .from('profiles')
    .select('id, role, name, email, position, orientation, orientation_year')
    .eq('id', userId)
    .single()
  return data
})
