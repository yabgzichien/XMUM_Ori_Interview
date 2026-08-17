import 'server-only'
import { createClient } from '@supabase/supabase-js'

// Service-role client for trusted server-side operations (creating staff
// accounts, claiming invites). NEVER import this from a client component — the
// 'server-only' guard makes such an import a build error. The service-role key
// bypasses RLS, so all callers must enforce their own authorization.
//
// Pass `actorId` (the profile id of the signed-in person on whose behalf the
// write is happening) so the activity log attributes the change to them instead
// of an anonymous "Server task". The audit trigger honours this header only for
// service-role requests — see audit_actor() in 0029_audit_log.sql.
export function createAdminClient(actorId?: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      ...(actorId ? { global: { headers: { 'x-actor-id': actorId } } } : {}),
    },
  )
}
