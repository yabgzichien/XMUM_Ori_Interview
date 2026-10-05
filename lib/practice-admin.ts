import 'server-only'

import { getCurrentProfile } from '@/lib/auth'
import { getPracticeCapacityCategory } from '@/lib/practice-capacity'
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
  const [rosterResult, groupResult, bookingResult, sessionResult, positionResult, settingsResult] = await Promise.all([
    database.from('committee_roster').select('id, name, student_id, position, active, practice_group_bookings(id, group_id, practice_groups(name))').order('name'),
    database.from('practice_groups').select('id, name, capacity, committee_capacity, faci_gm_capacity, status, performance_type, description, leader_roster_member_id, performance_video_url, song_source_type, song_url, song_storage_path, practice_group_bookings(id, committee_roster(position)), practice_sessions(id)').order('name'),
    database.from('practice_group_bookings').select('id, group_id, roster_member_id, source, committee_roster(name, student_id)').order('created_at'),
    database.from('practice_sessions').select('id, group_id, starts_at, ends_at, location').order('starts_at'),
    database.from('committee_positions').select('value, label').order('label'),
    database.from('practice_settings').select('booking_opens_at').eq('orientation', 'december').eq('orientation_year', 2026).maybeSingle(),
  ])
  const error = rosterResult.error || groupResult.error || bookingResult.error || sessionResult.error || positionResult.error || settingsResult.error
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

  const rosterById = new Map(roster.map((member) => [member.id, member]))
  const groups = ((groupResult.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => {
    const leaderId = row.leader_roster_member_id as string | null
    const rawBookings = Array.isArray(row.practice_group_bookings)
      ? row.practice_group_bookings as Array<{ committee_roster?: { position?: string } | Array<{ position?: string }> }>
      : []
    const categoryCounts = rawBookings.reduce((counts, booking) => {
      const rawMember = booking.committee_roster
      const member = Array.isArray(rawMember) ? rawMember[0] : rawMember
      const category = getPracticeCapacityCategory(member?.position ?? '')
      counts[category] += 1
      return counts
    }, { committee: 0, faci_gm: 0 })
    return {
      id: row.id as string,
      name: row.name as string,
      capacity: row.capacity as number,
      committee_capacity: row.committee_capacity as number,
      faci_gm_capacity: row.faci_gm_capacity as number,
      status: row.status as 'open' | 'closed',
      booking_count: rawBookings.length,
      committee_booking_count: categoryCounts.committee,
      faci_gm_booking_count: categoryCounts.faci_gm,
      session_count: Array.isArray(row.practice_sessions) ? row.practice_sessions.length : 0,
      performance_type: row.performance_type as string | null,
      description: row.description as string | null,
      leader_roster_member_id: leaderId,
      leader_name: leaderId ? rosterById.get(leaderId)?.name ?? null : null,
      performance_video_url: row.performance_video_url as string | null,
      song_source_type: row.song_source_type as AdminPracticeGroup['song_source_type'],
      song_url: row.song_url as string | null,
      song_storage_path: row.song_storage_path as string | null,
    } satisfies AdminPracticeGroup
  })

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
    booking_opens_at: (settingsResult.data?.booking_opens_at as string | null | undefined) ?? null,
  }
}
