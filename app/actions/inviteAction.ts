'use server'

import { createClient } from '@/lib/supabase/server'
import { headers } from 'next/headers'
import { sendInvitationEmail } from '@/lib/email'
import type { StaffRole, StaffInvite } from '@/lib/admin'

export async function addInviteAction(input: {
  name: string
  studentId: string
  email: string
  role: StaffRole
}): Promise<{ data: StaffInvite | null; error: string | null }> {
  const supabase = await createClient()

  // 1. Insert into staff_invites table (database auto-generates code column default value)
  const { data, error } = await supabase
    .from('staff_invites')
    .insert({
      name: input.name.trim(),
      student_id: input.studentId.trim() || null,
      email: input.email.trim().toLowerCase(),
      role: input.role,
    })
    .select('*')
    .single()

  if (error || !data) {
    return { data: null, error: error?.message || 'Database invite failed.' }
  }

  const invite = data as StaffInvite

  // 2. Fetch host for direct link construction
  const requestHeaders = await headers()
  const host = requestHeaders.get('host') || 'localhost:3000'
  const protocol = host.startsWith('localhost') ? 'http' : 'https'
  const activationLink = `${protocol}://${host}/register?email=${encodeURIComponent(invite.email)}&code=${encodeURIComponent(invite.code)}`

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
