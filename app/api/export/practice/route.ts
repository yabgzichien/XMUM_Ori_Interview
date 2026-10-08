import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { getPracticeCapacityCategory } from '@/lib/practice-capacity'
import {
  generatePracticeExportFilename,
  generatePracticePerformanceWorkbook,
  type PracticeExportGroup,
  type PracticeExportMember,
} from '@/lib/excel-export'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  if (profile.role !== 'admin') {
    return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const orientation = searchParams.get('orientation') || 'december'
  const yearParam = searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) || 2026 : 2026

  const database = await createClient()

  // 1. Fetch practice groups for this cycle
  const { data: rawGroups, error: groupsError } = await database
    .from('practice_groups')
    .select('id, name, committee_capacity, faci_gm_capacity, songs, description, performance_video_url, song_url, practice_group_leaders(roster_member_id)')
    .eq('orientation', orientation)
    .eq('orientation_year', year)
    .order('name')

  if (groupsError) {
    return NextResponse.json({ error: groupsError.message }, { status: 500 })
  }

  // 2. Fetch roster members for this cycle
  const { data: rawRoster, error: rosterError } = await database
    .from('committee_roster')
    .select('id, name, student_id, position')
    .eq('orientation', orientation)
    .eq('orientation_year', year)

  if (rosterError) {
    return NextResponse.json({ error: rosterError.message }, { status: 500 })
  }

  const rosterById = new Map<string, { id: string; name: string; position: string; student_id: string }>()
  for (const member of rawRoster ?? []) {
    rosterById.set(member.id, member)
  }

  // 3. Fetch bookings for this cycle's groups
  const groupIds = (rawGroups ?? []).map((g) => g.id)
  let rawBookings: Array<{ id: string; group_id: string; roster_member_id: string }> = []
  if (groupIds.length > 0) {
    const { data: bookingsData, error: bookingsError } = await database
      .from('practice_group_bookings')
      .select('id, group_id, roster_member_id')
      .in('group_id', groupIds)

    if (bookingsError) {
      return NextResponse.json({ error: bookingsError.message }, { status: 500 })
    }
    rawBookings = bookingsData ?? []
  }

  // 4. Assemble export groups with sorted members
  const exportGroups: PracticeExportGroup[] = (rawGroups ?? []).map((group) => {
    // Leaders
    const rawLeaderIds = (Array.isArray(group.practice_group_leaders)
      ? group.practice_group_leaders as Array<{ roster_member_id: string }>
      : []
    ).map((l) => l.roster_member_id)

    const leaders: Array<{ id: string; name: string; student_id: string }> = rawLeaderIds
      .map((id) => {
        const m = rosterById.get(id)
        return m ? { id: m.id, name: m.name, student_id: m.student_id } : null
      })
      .filter((l): l is { id: string; name: string; student_id: string } => Boolean(l))
      .sort((a, b) => a.name.localeCompare(b.name))

    // Members from bookings
    const groupBookings = rawBookings.filter((b) => b.group_id === group.id)
    const committeeMembers: PracticeExportMember[] = []
    const faciGmMembers: PracticeExportMember[] = []

    for (const booking of groupBookings) {
      const member = rosterById.get(booking.roster_member_id)
      if (!member) continue

      const category = getPracticeCapacityCategory(member.position)
      const exportMember: PracticeExportMember = {
        id: member.id,
        name: member.name,
        student_id: member.student_id,
        position: member.position,
      }

      if (category === 'faci_gm') {
        faciGmMembers.push(exportMember)
      } else {
        committeeMembers.push(exportMember)
      }
    }

    // Sort members alphabetically A-Z
    committeeMembers.sort((a, b) => a.name.localeCompare(b.name))
    faciGmMembers.sort((a, b) => a.name.localeCompare(b.name))

    return {
      id: group.id,
      name: group.name,
      songs: (group as { songs?: string | null }).songs,
      description: group.description,
      performance_video_url: group.performance_video_url,
      song_url: group.song_url,
      committee_capacity: group.committee_capacity ?? 1,
      faci_gm_capacity: group.faci_gm_capacity ?? 1,
      leaders,
      committee_members: committeeMembers,
      faci_gm_members: faciGmMembers,
    }
  })

  // 5. Generate workbook
  const workbook = await generatePracticePerformanceWorkbook({
    orientation,
    orientationYear: year,
    groups: exportGroups,
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const filename = generatePracticeExportFilename({ orientation, orientationYear: year })

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'no-store',
    },
  })
}
