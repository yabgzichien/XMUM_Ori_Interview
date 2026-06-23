import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client for trusted server-side operations (creating staff
// accounts, claiming invites). NEVER import this from a client component — the
// 'server-only' guard makes such an import a build error. The service-role key
// bypasses RLS, so all callers must enforce their own authorization.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
