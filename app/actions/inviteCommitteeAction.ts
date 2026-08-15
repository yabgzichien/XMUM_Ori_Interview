'use server'

import { headers } from 'next/headers'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvitationEmail } from '@/lib/email'
import type { Track, Orientation } from '@/lib/head'

/** The subset of a `head_bookings` row this action actually reads. */
type ApprovedBookingRow = {
  applicant_name: string
  applicant_email: string
  student_id: string | null
  interview_status: string | null
}

type BulkInviteResult = {
  invited: number
  alreadyInvited: number
  alreadyClaimed: number
  failed: number
  error: string | null
}

// Bulk-invites every approved interviewee for a track+orientation onto the
// committee, reusing the staff_invites/register flow. Takes only track +
// orientation (not client-supplied booking data) and re-derives the
// authorized applicant list itself via the head_bookings RPC, since the
// service-role client below bypasses RLS and must not trust the caller.
export async function bulkInviteApprovedAction(
  track: Track,
  orientation: Orientation,
  orientationYear: number = 2026,
): Promise<BulkInviteResult> {
  const empty = { invited: 0, alreadyInvited: 0, alreadyClaimed: 0, failed: 0 }

  const profile = await getCurrentProfile()
  if (!profile) {
    return { ...empty, error: 'Not signed in.' }
  }
  const authorized =
    profile.role === 'admin' ||
    (profile.role === 'head_facilitator' && track === 'facilitator') ||
    (profile.role === 'head_gm' && track === 'game_master')
  if (!authorized) {
    return { ...empty, error: 'Not authorized for this track.' }
  }

  const supabase = await createClient()
  const { data: bookings, error: bookingsErr } = await supabase.rpc('head_bookings', {
    p_track: track,
    p_orientation: orientation,
    p_year: orientationYear,
  })
  if (bookingsErr) {
    return { ...empty, error: bookingsErr.message }
  }

  const approved = ((bookings ?? []) as ApprovedBookingRow[]).filter((b) => b.interview_status === 'approved')

  const admin = createAdminClient()
  const requestHeaders = await headers()
  const host = requestHeaders.get('host') || 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'

  let invited = 0
  let alreadyInvited = 0
  let alreadyClaimed = 0
  let failed = 0

  for (const b of approved) {
    const email = b.applicant_email?.trim().toLowerCase()
    if (!email) {
      failed++
      continue
    }

    const { data: existing } = await admin
      .from('staff_invites')
      .select('id, claimed_at')
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      if (existing.claimed_at) alreadyClaimed++
      else alreadyInvited++
      continue
    }

    const { data: created, error: insertErr } = await admin
      .from('staff_invites')
      .insert({
        name: b.applicant_name,
        student_id: b.student_id,
        email,
        role: 'committee',
        track,
        orientation,
        orientation_year: orientationYear,
      })
      .select('*')
      .single()

    if (insertErr || !created) {
      failed++
      continue
    }

    const activationLink = `${protocol}://${host}/register?email=${encodeURIComponent(email)}&code=${encodeURIComponent(created.code)}`

    const res = await sendInvitationEmail({
      name: created.name,
      email,
      code: created.code,
      activationLink,
    })

    if (res.success) {
      invited++
    } else {
      failed++
    }
  }

  return { invited, alreadyInvited, alreadyClaimed, failed, error: null }
}
