// Data-access for the admin staff-invite UI. Browser client (anon key + session);
// RLS restricts every staff_invites operation to admins. Client is constructed at
// call time so this file is safe to import even when env vars are unset at build.

import { createClient } from '@/lib/supabase/client'

export type StaffRole = 'head_facilitator' | 'head_gm' | 'admin'

export type StaffInvite = {
  id: string
  email: string
  name: string
  student_id: string | null
  role: StaffRole
  code: string
  claimed_at: string | null
  created_at: string
}

export type NewInvite = {
  name: string
  studentId: string
  email: string
  role: StaffRole
}

export async function listInvites() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('staff_invites')
    .select('*')
    .order('created_at', { ascending: false })
  return { data: (data as StaffInvite[] | null) ?? null, error }
}

export async function addInvite(input: NewInvite) {
  const supabase = createClient()
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
  return { data: (data as StaffInvite | null) ?? null, error }
}

export async function deleteInvite(id: string) {
  const supabase = createClient()
  const { error } = await supabase.from('staff_invites').delete().eq('id', id)
  return { error }
}
