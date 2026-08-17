import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

// Staff claim flow: a pre-invited staff member sets their password to activate
// their account. Runs with the service-role key (server-only) and authorizes via
// the invite's email + code, then assigns the invited role.
export async function POST(request: Request) {
  let body: { email?: string; code?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  const code = body.code?.trim().toUpperCase() ?? ''
  const password = body.password ?? ''

  if (!email || !code || !password) {
    return NextResponse.json({ error: 'Email, code, and password are required.' }, { status: 400 })
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: invite, error: inviteErr } = await admin
    .from('staff_invites')
    .select('*')
    .eq('email', email)
    .maybeSingle()

  // A misconfigured SUPABASE_SERVICE_ROLE_KEY/NEXT_PUBLIC_SUPABASE_URL on this
  // deployment would otherwise fail silently here — the query would error out,
  // `invite` would end up null, and the code below would report the generic
  // "no matching invite" message even though a real invite exists. Surface the
  // underlying error instead so a deploy/env issue is distinguishable from an
  // actually-wrong email/code.
  if (inviteErr) {
    return NextResponse.json(
      { error: `Could not look up the invite (${inviteErr.message}). This looks like a server configuration issue, not a wrong code — contact an admin.` },
      { status: 500 },
    )
  }

  if (!invite || invite.code !== code || invite.claimed_at) {
    return NextResponse.json(
      { error: 'No matching unused invite for that email and code.' },
      { status: 400 },
    )
  }

  // Every non-admin role is scoped to an orientation cycle; an invite missing
  // one would activate into a profile that can't load any orientation-scoped
  // page (practice groups, bookings, etc). The invite form always sets this,
  // but guard here too in case a row was inserted outside that form.
  if (invite.role !== 'admin' && !invite.orientation) {
    return NextResponse.json(
      { error: 'This invite is missing an orientation and cannot be activated. Ask an admin to recreate it.' },
      { status: 400 },
    )
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: invite.name },
  })

  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: createErr?.message ?? 'Could not create the account (it may already exist).' },
      { status: 400 },
    )
  }

  // handle_new_user created a profile as 'applicant'; set the invited role/details.
  const { error: profileErr } = await admin.from('profiles').upsert(
    {
      id: created.user.id,
      name: invite.name,
      student_id: invite.student_id,
      email,
      role: invite.role,
      position: invite.position ?? null,
      track: invite.track ?? null,
      orientation: invite.orientation ?? null,
      orientation_year: invite.orientation_year ?? 2026,
    },
    { onConflict: 'id' },
  )
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 400 })
  }

  await admin
    .from('staff_invites')
    .update({ claimed_at: new Date().toISOString() })
    .eq('id', invite.id)

  return NextResponse.json({ ok: true, role: invite.role })
}
