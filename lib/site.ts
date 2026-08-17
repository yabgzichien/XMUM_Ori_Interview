import { headers } from 'next/headers'

/**
 * Base URL (no trailing slash) for links embedded in outbound emails —
 * invite activation links, etc. Prefers SITE_URL so links are correct
 * regardless of where the server action actually runs (e.g. an admin
 * triggering an invite from a local `next dev` server against the
 * production Supabase project would otherwise mail out a localhost link).
 * Falls back to the incoming request's Host header when SITE_URL isn't set,
 * which keeps local development working without any extra config.
 */
export async function getSiteUrl(): Promise<string> {
  const configured = process.env.SITE_URL?.trim()
  if (configured) {
    return configured.replace(/\/+$/, '')
  }

  const requestHeaders = await headers()
  const host = requestHeaders.get('host') || 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  return `${protocol}://${host}`
}
