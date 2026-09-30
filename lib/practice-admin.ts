import 'server-only'

import { getCurrentProfile } from '@/lib/auth'
import type {
  AdminPracticeBooking,
  AdminPracticeGroup,
  AdminPracticeSnapshot,
  AdminRosterMember,
  PracticeSession,
} from '@/lib/practice-types'
import { createClient } from '@/lib/supabase/server'

export async function getAdminPracticeSnapshot(): Promise<AdminPracticeSnapshot> {
  const profile = await getCurrentProfile()
  if (!profile || profile.role !== 'admin') throw new Error('Not authorized.')
  const database = await createClient()
  const [rosterResult, groupResult, bookingResult, sessionResult, positionResult] = await Promise.all([
    database.from('committee_roster').select('id, name, student_id, position, active, practice_group_bookings(id, group_id, practice_groups(name))').order('name'),
    database.from('practice_groups').select('id, name, capacity, status, practice_group_bookings(id), practice_sessions(id)').order('name'),
    database.from('practice_group_bookings').select('id, group_id, roster_member_id, source, committee_roster(name, student_id)').order('created_at'),
    database.from('practice_sessions').select('id, group_id, starts_at, ends_at, location').order('starts_at'),
    database.from('committee_positions').select('value, label').order('label'),
  ])
  const error = rosterResult.error || groupResult.error || bookingResult.error || sessionResult.error || positionResult.error
  if (error) throw new Error(error.message)

  const roster = ((rosterResult.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const rawBooking = row.practice_group_bookings
    const booking = Array.isArray(rawBooking) ? rawBooking[0] : rawBooking
    const typedBooking = booking as { id?: string; group_id?: string; practice_groups?: { name?: string } | Array<{ name?: string }> } | undefined
    const rawGroup = typedBooking?.practice_groups
    const group = Array.isArray(rawGroup) ? rawGroup[0] : rawGroup
    return {
      id: row.id as string,
      name: row.name as string,
      student_id: row.student_id as string,
      position: row.position as string,
      active: row.active as boolean,
      booking_id: typedBooking?.id ?? null,
      group_id: typedBooking?.group_id ?? null,
      group_name: group?.name ?? null,
    } satisfies AdminRosterMember
  })

  const groups = ((groupResult.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    id: row.id as string,
    name: row.name as string,
    capacity: row.capacity as number,
    status: row.status as 'open' | 'closed',
    booking_count: Array.isArray(row.practice_group_bookings) ? row.practice_group_bookings.length : 0,
    session_count: Array.isArray(row.practice_sessions) ? row.practice_sessions.length : 0,
  } satisfies AdminPracticeGroup))

  const bookings = ((bookingResult.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const rawMember = row.committee_roster
    const member = (Array.isArray(rawMember) ? rawMember[0] : rawMember) as { name?: string; student_id?: string } | undefined
    return {
      id: row.id as string,
      group_id: row.group_id as string,
      roster_member_id: row.roster_member_id as string,
      member_name: member?.name ?? 'Unknown member',
      student_id: member?.student_id ?? '',
      source: row.source as 'self_service' | 'admin',
    } satisfies AdminPracticeBooking
  })

  const sessions = (sessionResult.data ?? []) as unknown as Array<PracticeSession & { group_id: string }>
  return {
    roster,
    groups,
    bookings,
    sessions,
    positions: (positionResult.data ?? []) as Array<{ value: string; label: string }>,
  }
}
