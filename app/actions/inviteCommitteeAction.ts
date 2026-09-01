'use server'

import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendInvitationEmail } from '@/lib/email'
import { getSiteUrl } from '@/lib/site'
import type { Track, Orientation } from '@/lib/head'

/** The subset of a `head_bookings` row this action actually reads. */
type ApprovedBookingRow = {
  booking_id: string
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

type SingleInviteResult = {
  status: 'invited' | 'resent' | 'already_claimed'
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

  // Attributed to the head/admin who triggered the bulk invite, so the activity
  // log names them rather than the anonymous service role.
  const admin = createAdminClient(profile.id)
  const siteUrl = await getSiteUrl()

  const emails = approved
    .map((b) => b.applicant_email?.trim().toLowerCase())
    .filter((e): e is string => Boolean(e))

  if (emails.length === 0) {
    return { ...empty, error: null }
  }

  // 1. Batch lookup existing invites for all candidates in a single query
  const { data: existingRows } = await admin
    .from('staff_invites')
    .select('id, email, claimed_at')
    .in('email', emails)

  const existingMap = new Map((existingRows ?? []).map((r) => [r.email.toLowerCase(), r]))

  let invited = 0
  let alreadyInvited = 0
  let alreadyClaimed = 0
  let failed = 0

  const toCreate: {
    booking: ApprovedBookingRow
    email: string
  }[] = []

  for (const b of approved) {
    const email = b.applicant_email?.trim().toLowerCase()
    if (!email) {
      failed++
      continue
    }

    const existing = existingMap.get(email)
    if (existing) {
      if (existing.claimed_at) alreadyClaimed++
      else alreadyInvited++
      continue
    }

    toCreate.push({ booking: b, email })
  }

  if (toCreate.length > 0) {
    // 2. Batch insert new staff invites in a single round-trip
    const newRows = toCreate.map(({ booking: b, email }) => ({
      name: b.applicant_name,
      student_id: b.student_id,
      email,
      role: 'committee' as const,
      track,
      position: track,
      orientation,
      orientation_year: orientationYear,
    }))

    const { data: createdRows, error: insertErr } = await admin
      .from('staff_invites')
      .insert(newRows)
      .select('*')

    if (insertErr || !createdRows) {
      console.error('Batch invite insert failed:', insertErr)
      failed += toCreate.length
      return { invited, alreadyInvited, alreadyClaimed, failed, error: insertErr?.message ?? 'Failed to create invites' }
    }

    // 3. Dispatch invitation emails concurrently
    const emailPromises = createdRows.map(async (created) => {
      const email = created.email
      const activationLink = `${siteUrl}/register?email=${encodeURIComponent(email)}&code=${encodeURIComponent(created.code)}`
      const res = await sendInvitationEmail({
        name: created.name,
        email,
        code: created.code,
        activationLink,
        position: created.position,
      })
      return res.success
    })

    const results = await Promise.allSettled(emailPromises)
    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        invited++
      } else {
        failed++
      }
    }
  }

  return { invited, alreadyInvited, alreadyClaimed, failed, error: null }
}

// Invites a single approved interviewee onto the committee, or re-sends the
// existing invite email (same code) if one was already sent and not yet
// claimed. Same auth + staff_invites flow as bulkInviteApprovedAction, but
// re-derives just the one booking (by id) from the head_bookings RPC rather
// than trusting client-supplied applicant data.
export async function inviteApprovedBookingAction(
  bookingId: string,
  track: Track,
  orientation: Orientation,
  orientationYear: number = 2026,
): Promise<SingleInviteResult> {
  const profile = await getCurrentProfile()
  if (!profile) {
    return { status: 'invited', error: 'Not signed in.' }
  }
  const authorized =
    profile.role === 'admin' ||
    (profile.role === 'head_facilitator' && track === 'facilitator') ||
    (profile.role === 'head_gm' && track === 'game_master')
  if (!authorized) {
    return { status: 'invited', error: 'Not authorized for this track.' }
  }

  const supabase = await createClient()
  const { data: bookings, error: bookingsErr } = await supabase.rpc('head_bookings', {
    p_track: track,
    p_orientation: orientation,
    p_year: orientationYear,
  })
  if (bookingsErr) {
    return { status: 'invited', error: bookingsErr.message }
  }

  const b = ((bookings ?? []) as ApprovedBookingRow[]).find((row) => row.booking_id === bookingId)
  if (!b) {
    return { status: 'invited', error: 'Booking not found.' }
  }
  if (b.interview_status !== 'approved') {
    return { status: 'invited', error: 'Applicant is not approved.' }
  }

  const email = b.applicant_email?.trim().toLowerCase()
  if (!email) {
    return { status: 'invited', error: 'Applicant has no email on file.' }
  }

  const admin = createAdminClient(profile.id)
  const siteUrl = await getSiteUrl()

  const { data: existing } = await admin
    .from('staff_invites')
    .select('id, name, code, claimed_at, position')
    .eq('email', email)
    .maybeSingle()

  if (existing) {
    if (existing.claimed_at) {
      return { status: 'already_claimed', error: null }
    }

    // Re-send with the same code rather than minting a new one — the
    // applicant may have the original email around, and either one still
    // works to claim the same invite row.
    const resendLink = `${siteUrl}/register?email=${encodeURIComponent(email)}&code=${encodeURIComponent(existing.code)}`
    const resendRes = await sendInvitationEmail({
      name: existing.name,
      email,
      code: existing.code,
      activationLink: resendLink,
      position: existing.position,
    })

    if (!resendRes.success) {
      return { status: 'resent', error: resendRes.error || 'Failed to resend invitation email.' }
    }
    return { status: 'resent', error: null }
  }

  const { data: created, error: insertErr } = await admin
    .from('staff_invites')
    .insert({
      name: b.applicant_name,
      student_id: b.student_id,
      email,
      role: 'committee',
      track,
      // 'facilitator' / 'game_master' are pre-seeded committee_positions
      // values (0028) whose labels are exactly "Facilitator" / "Game
      // Master" — the title matches the track they were approved for.
      position: track,
      orientation,
      orientation_year: orientationYear,
    })
    .select('*')
    .single()

  if (insertErr || !created) {
    return { status: 'invited', error: insertErr?.message || 'Failed to create invite.' }
  }

  const activationLink = `${siteUrl}/register?email=${encodeURIComponent(email)}&code=${encodeURIComponent(created.code)}`

  const res = await sendInvitationEmail({
    name: created.name,
    email,
    code: created.code,
    activationLink,
    position: created.position,
  })

  if (!res.success) {
    return { status: 'invited', error: res.error || 'Failed to send invitation email.' }
  }

  return { status: 'invited', error: null }
}
