// Data-access for the admin staff-invite UI. Browser client (anon key + session);
// RLS restricts every staff_invites operation to admins. Client is constructed at
// call time so this file is safe to import even when env vars are unset at build.

import { createClient } from '@/lib/supabase/client'
import type { Orientation } from '@/lib/orientation'

export type StaffRole = 'head_facilitator' | 'head_gm' | 'admin' | 'committee'

// Active (already-claimed) committee-tier accounts — the same set
// head_committee_roster treats as "on the committee" (0022_position_grants_head_access.sql).
// Excludes 'admin' and 'applicant': admins are managed separately, applicants
// were never invited onto the committee.
export type CommitteeMemberRole = 'committee' | 'performance_lead' | 'head_facilitator' | 'head_gm'

export type CommitteeMember = {
  id: string
  name: string
  email: string
  student_id: string | null
  role: CommitteeMemberRole
  position: string | null
  orientation: Orientation | null
  orientation_year: number | null
  avatar_url: string | null
}

export type StaffInvite = {
  id: string
  email: string
  name: string
  student_id: string | null
  role: StaffRole
  position: string | null
  code: string
  claimed_at: string | null
  created_at: string
}

export type NewInvite = {
  name: string
  studentId: string
  email: string
  role: StaffRole
  position: string | null
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
      position: input.position || null,
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

// Every already-activated committee-tier account, across every orientation —
// admin bypasses the RLS scoping that limits a head to their own orientation
// (profiles_select_own_or_admin), so this is a plain table read.
export async function listCommitteeMembers() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, email, student_id, role, position, orientation, orientation_year, avatar_url')
    .in('role', ['committee', 'performance_lead', 'head_facilitator', 'head_gm'])
    .order('name')
  return { data: (data as CommitteeMember[] | null) ?? null, error }
}

export async function renameCommitteeMember(id: string, name: string) {
  const supabase = createClient()
  const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', id)
  return { error }
}

// Revokes committee access without deleting the account: role drops to
// 'applicant' (no dashboard access) and the title is cleared, but the
// profile — and anything tied to it elsewhere (past interview notes,
// bookings) — is left intact. Blocked if they're currently leading a
// practice group, since that group would be left with an applicant as lead.
export async function revokeCommitteeMember(id: string) {
  const supabase = createClient()

  // The two permanent seed head accounts (orientation is null — see
  // 0022_position_grants_head_access.sql) have no committee-roster path back
  // to head_facilitator/head_gm once demoted, so revoking them here would be
  // a one-way trip. Keep this screen scoped to orientation-cycle members.
  const { data: target, error: fetchErr } = await supabase
    .from('profiles')
    .select('orientation')
    .eq('id', id)
    .single()
  if (fetchErr) return { error: fetchErr }
  if (!target?.orientation) {
    return { error: { message: 'This is a permanent account and can\'t be revoked from here.' } }
  }

  const { data: leading, error: leadErr } = await supabase
    .from('practice_groups')
    .select('id')
    .eq('lead_id', id)
    .limit(1)
  if (leadErr) return { error: leadErr }
  if (leading && leading.length > 0) {
    return { error: { message: 'This person is leading a practice group — reassign the group lead first.' } }
  }
  const { error } = await supabase.from('profiles').update({ role: 'applicant', position: null }).eq('id', id)
  return { error }
}
