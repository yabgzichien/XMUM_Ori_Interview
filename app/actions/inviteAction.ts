'use server'

import { createClient } from '@/lib/supabase/server'
import { getSiteUrl } from '@/lib/site'
import { sendInvitationEmail } from '@/lib/email'
import type { StaffRole, StaffInvite } from '@/lib/admin'
import type { Orientation } from '@/lib/orientation'

export async function addInviteAction(input: {
  name: string
  studentId: string
  email: string
  position: string | null
  orientation: Orientation | null
  orientationYear: number | null
  grantAdmin: boolean
}): Promise<{ data: StaffInvite | null; error: string | null }> {
  if (!input.studentId.trim()) {
    return { data: null, error: 'Student ID is required.' }
  }

  // Access level is derived, never taken directly from the client: HOF/HOGM
  // titles grant the matching head role, the admin toggle grants admin, and
  // everyone else is a plain committee member. Mirrors how
  // head_set_committee_position promotes an existing member (0022).
  let role: StaffRole
  if (input.grantAdmin) {
    role = 'admin'
  } else if (input.position === 'hof') {
    role = 'head_facilitator'
  } else if (input.position === 'hog') {
    role = 'head_gm'
  } else {
    role = 'committee'
  }

  if (!input.grantAdmin && !input.orientation) {
    return { data: null, error: 'Orientation is required.' }
  }

  const supabase = await createClient()

  // 1. Insert into staff_invites table (database auto-generates code column default value)
  const { data, error } = await supabase
    .from('staff_invites')
    .insert({
      name: input.name.trim(),
      student_id: input.studentId.trim() || null,
      email: input.email.trim().toLowerCase(),
      role,
      position: input.position || null,
      orientation: input.grantAdmin ? null : input.orientation,
      orientation_year: input.grantAdmin ? null : (input.orientationYear ?? 2026),
    })
    .select('*')
    .single()

  if (error || !data) {
    return { data: null, error: error?.message || 'Database invite failed.' }
  }

  const invite = data as StaffInvite

  // 2. Build the activation link against the deployed site, not wherever
  // this action happens to be running.
  const siteUrl = await getSiteUrl()
  const activationLink = `${siteUrl}/register?email=${encodeURIComponent(invite.email)}&code=${encodeURIComponent(invite.code)}`

  // 3. Dispatch invitation email asynchronously
  sendInvitationEmail({
    name: invite.name,
    email: invite.email,
    code: invite.code,
    activationLink,
  }).then((res) => {
    if (res.success) {
      console.log(`Invitation email sent to ${invite.email}. MessageId: ${res.messageId}`)
    } else {
      console.warn(`Invitation email failed: ${res.error}`)
    }
  })

  return { data: invite, error: null }
}
