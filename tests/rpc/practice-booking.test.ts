import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && anonKey && serviceKey)

const service = hasEnv
  ? createClient(url!, serviceKey!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

const anon = hasEnv
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2)}`
const rosterIds: string[] = []
const groupIds: string[] = []
const authUserIds: string[] = []
let adminProfileId = ''
let originalBookingOpensAt: string | null = null

type RosterFixture = { id: string; student_id: string }
type GroupFixture = { id: string; name: string }

async function createRosterMember(label: string, active = true, position = 'facilitator'): Promise<RosterFixture> {
  const studentId = `T${label}${suffix}`.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase()
  const { data, error } = await service
    .from('committee_roster')
    .insert({
      name: `Test ${label}`,
      student_id: studentId,
      position,
      active,
    })
    .select('id, student_id')
    .single()
  if (error) throw error
  rosterIds.push(data.id)
  return data
}

async function createGroup(label: string, capacity = 4, status: 'open' | 'closed' = 'open'): Promise<GroupFixture> {
  const { data, error } = await service
    .from('practice_groups')
    .insert({
      name: `${label} ${suffix}`,
      capacity: capacity * 2,
      committee_capacity: capacity,
      faci_gm_capacity: capacity,
      status,
      created_by: adminProfileId,
    })
    .select('id, name')
    .single()
  if (error) throw error
  groupIds.push(data.id)
  return data
}

async function makeSignedInStaff(role: 'admin' | 'head_facilitator') {
  const email = `${role}_${suffix}@test.local`
  const password = 'Passw0rd!1'
  const { data, error } = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (error || !data.user) throw error ?? new Error('User creation failed')
  authUserIds.push(data.user.id)
  const { error: profileError } = await service.from('profiles').upsert({
    id: data.user.id,
    name: role,
    email,
    role,
    orientation: 'december',
    orientation_year: 2026,
  })
  if (profileError) throw profileError
  const client = createClient(url!, anonKey!, { auth: { persistSession: false } })
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { client, id: data.user.id }
}

afterAll(async () => {
  if (!hasEnv) return
  await service.from('practice_settings').update({ booking_opens_at: originalBookingOpensAt }).eq('orientation', 'december').eq('orientation_year', 2026)
  if (rosterIds.length) await service.from('practice_group_bookings').delete().in('roster_member_id', rosterIds)
  if (groupIds.length) await service.from('practice_sessions').delete().in('group_id', groupIds)
  if (rosterIds.length) await service.from('committee_roster').delete().in('id', rosterIds)
  if (groupIds.length) await service.from('practice_groups').delete().in('id', groupIds)
  for (const id of authUserIds) {
    await service.from('profiles').delete().eq('id', id)
    await service.auth.admin.deleteUser(id)
  }
})

describe.skipIf(!hasEnv)('account-free practice booking RPCs', () => {
  let adminClient: SupabaseClient
  let headClient: SupabaseClient

  beforeAll(async () => {
    const admin = await makeSignedInStaff('admin')
    const head = await makeSignedInStaff('head_facilitator')
    adminClient = admin.client
    adminProfileId = admin.id
    headClient = head.client
    const settings = await service.from('practice_settings').select('booking_opens_at').eq('orientation', 'december').eq('orientation_year', 2026).maybeSingle()
    if (settings.error) throw settings.error
    originalBookingOpensAt = settings.data?.booking_opens_at ?? null
    const release = await service.from('practice_settings').upsert({
      orientation: 'december', orientation_year: 2026,
      booking_opens_at: '2026-01-01T00:00:00.000Z', updated_by: admin.id,
    }, { onConflict: 'orientation,orientation_year' })
    if (release.error) throw release.error
  })

  it('publishes preview metadata but rejects booking before the shared opening time', async () => {
    const leader = await createRosterMember('PreviewLeader')
    const coLeader = await createRosterMember('PreviewCoLeader')
    const visitor = await createRosterMember('PreviewVisitor')
    const group = await createGroup('Preview Group')
    const details = await service.from('practice_groups').update({
      performance_type: 'K-pop dance',
      description: 'Preview description',
      performance_video_url: 'https://youtu.be/dQw4w9WgXcQ',
      song_source_type: 'external',
      song_url: 'https://example.test/song.mp3',
    }).eq('id', group.id)
    expect(details.error).toBeNull()
    const leaderLinks = await service.from('practice_group_leaders').insert([
      { group_id: group.id, roster_member_id: leader.id },
      { group_id: group.id, roster_member_id: coLeader.id },
    ])
    expect(leaderLinks.error).toBeNull()

    const future = await service.from('practice_settings').update({
      booking_opens_at: '2099-12-01T00:00:00.000Z',
    }).eq('orientation', 'december').eq('orientation_year', 2026)
    expect(future.error).toBeNull()
    try {
      const catalog = await service.rpc('public_practice_catalog')
      expect(catalog.error).toBeNull()
      expect(catalog.data).toMatchObject({ booking_open: false })
      expect(catalog.data.groups).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: group.id,
          performance_type: 'K-pop dance',
          leaders: expect.arrayContaining([
            expect.objectContaining({ id: leader.id }),
            expect.objectContaining({ id: coLeader.id }),
          ]),
        }),
      ]))

      const booking = await service.rpc('public_book_practice_group', {
        p_student_id: visitor.student_id,
        p_email: `${visitor.student_id}@xmu.edu.my`,
        p_group: group.id,
      })
      expect(booking.error?.message).toContain('booking_not_open')
    } finally {
      await service.from('practice_settings').update({
        booking_opens_at: '2026-01-01T00:00:00.000Z',
      }).eq('orientation', 'december').eq('orientation_year', 2026)
    }
  })

  it('matches student ID and derived university email without case sensitivity', async () => {
    const member = await createRosterMember('Case')
    const group = await createGroup('Case Group')
    const { data, error } = await service.rpc('public_practice_lookup', {
      p_student_id: ` ${member.student_id.toLowerCase()} `,
      p_email: `${member.student_id}@XMU.EDU.MY`,
    })
    expect(error).toBeNull()
    expect(data.state).toBe('available')
    expect(data.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: group.id, name: group.name, seats_left: 4 }),
    ]))
  })

  it('separates Committee and Faci/GM capacity for non-Faci/GM positions', async () => {
    const hof = await createRosterMember('SplitDesigner', true, 'designer')
    const hog = await createRosterMember('SplitTreasurer', true, 'treasurer')
    const facilitator = await createRosterMember('SplitFaci', true, 'facilitator')
    const gameMaster = await createRosterMember('SplitGm', true, 'game_master')
    const facilitatorOverflow = await createRosterMember('SplitFaciOverflow', true, 'facilitator')
    const group = await createGroup('Split Capacity', 2)
    const capacityUpdate = await service.from('practice_groups').update({
      capacity: 3,
      committee_capacity: 1,
      faci_gm_capacity: 2,
    }).eq('id', group.id)
    expect(capacityUpdate.error).toBeNull()

    const [committeeLookup, faciGmLookup] = await Promise.all([
      service.rpc('public_practice_lookup', {
        p_student_id: hof.student_id,
        p_email: `${hof.student_id}@xmu.edu.my`,
      }),
      service.rpc('public_practice_lookup', {
        p_student_id: facilitator.student_id,
        p_email: `${facilitator.student_id}@xmu.edu.my`,
      }),
    ])
    expect(committeeLookup.error).toBeNull()
    expect(faciGmLookup.error).toBeNull()
    expect(committeeLookup.data.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: group.id, seats_left: 1 }),
    ]))
    expect(faciGmLookup.data.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: group.id, seats_left: 2 }),
    ]))

    const book = (member: RosterFixture) => service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: group.id,
    })

    expect((await book(hof)).error).toBeNull()
    expect((await book(facilitator)).error).toBeNull()
    expect((await book(hog)).error?.message).toContain('group_full')
    expect((await book(gameMaster)).error).toBeNull()
    expect((await book(facilitatorOverflow)).error?.message).toContain('group_full')

    const catalog = await service.rpc('public_practice_catalog')
    expect(catalog.error).toBeNull()
    expect(catalog.data.groups).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: group.id,
        committee_seats_left: 0,
        faci_gm_seats_left: 0,
      }),
    ]))
  })

  it.each([
    ['unknown ID', 'NOTONTHEROSTER', 'notontheroster@xmu.edu.my'],
    ['wrong local part', 'ID_PLACEHOLDER', 'someoneelse@xmu.edu.my'],
    ['wrong domain', 'ID_PLACEHOLDER', 'ID_PLACEHOLDER@gmail.com'],
  ])('returns one generic identity error for %s', async (_case, requestedId, requestedEmail) => {
    const member = await createRosterMember(`Invalid${Math.random().toString(36).slice(2)}`)
    const studentId = requestedId === 'ID_PLACEHOLDER' ? member.student_id : requestedId
    const email = requestedEmail.replaceAll('ID_PLACEHOLDER', member.student_id)
    const { error } = await service.rpc('public_practice_lookup', {
      p_student_id: studentId,
      p_email: email,
    })
    expect(error?.message).toContain('identity_not_verified')
  })

  it('rejects an inactive roster member with the same generic error', async () => {
    const member = await createRosterMember('Inactive', false)
    const { error } = await service.rpc('public_practice_lookup', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
    })
    expect(error?.message).toContain('identity_not_verified')
  })

  it('returns a booked group and its sessions on repeat verification', async () => {
    const member = await createRosterMember('Repeat')
    const group = await createGroup('Repeat Group')
    const { data: session, error: sessionError } = await service.from('practice_sessions').insert({
      group_id: group.id,
      starts_at: '2026-12-05T02:00:00.000Z',
      ends_at: '2026-12-05T03:00:00.000Z',
      location: 'D5-101',
      created_by: adminProfileId,
    }).select('id, starts_at, ends_at, location').single()
    expect(sessionError).toBeNull()
    if (!session) throw new Error('Session fixture was not created')
    const booked = await service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: group.id,
    })
    expect(booked.error).toBeNull()
    expect(booked.data).toMatchObject({
      group_id: group.id,
      sessions: [{ id: session.id, location: 'D5-101' }],
    })

    const lookup = await service.rpc('public_practice_lookup', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
    })
    expect(lookup.error).toBeNull()
    expect(lookup.data).toMatchObject({
      state: 'booked',
      booking: { group_id: group.id, group_name: group.name, sessions: [{ id: session.id, location: 'D5-101' }] },
    })
  })

  it('rejects closed groups and a second booking', async () => {
    const member = await createRosterMember('Duplicate')
    const closed = await createGroup('Closed Group', 2, 'closed')
    const open = await createGroup('Open Group', 2)
    const closedAttempt = await service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: closed.id,
    })
    expect(closedAttempt.error?.message).toContain('group_unavailable')

    const first = await service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: open.id,
    })
    expect(first.error).toBeNull()
    const duplicate = await service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: closed.id,
    })
    expect(duplicate.error?.message).toContain('already_booked')
  })

  it('allows only one winner for the final group space', async () => {
    const first = await createRosterMember('RaceA')
    const second = await createRosterMember('RaceB')
    const group = await createGroup('Race Group', 1)
    const results = await Promise.all([
      service.rpc('public_book_practice_group', {
        p_student_id: first.student_id,
        p_email: `${first.student_id}@xmu.edu.my`,
        p_group: group.id,
      }),
      service.rpc('public_book_practice_group', {
        p_student_id: second.student_id,
        p_email: `${second.student_id}@xmu.edu.my`,
        p_group: group.id,
      }),
    ])
    expect(results.filter((result) => !result.error)).toHaveLength(1)
    expect(results.filter((result) => result.error)[0].error?.message).toContain('group_full')
  })

  it('atomically reserves at most ten concurrent verification attempts per fingerprint', async () => {
    const fingerprint = `a${suffix}`.replace(/[^a-f0-9]/g, 'a').slice(0, 64).padEnd(64, 'a')
    const results = await Promise.all(Array.from({ length: 30 }, () => service.rpc(
      'reserve_practice_verification_attempt',
      { p_address_fingerprint: fingerprint },
    )))
    expect(results.every((result) => !result.error)).toBe(true)
    const reservations = results.map((result) => result.data as number | null).filter((id): id is number => id !== null)
    expect(reservations).toHaveLength(10)
    await Promise.all(reservations.map((id) => service.rpc('release_practice_verification_attempt', { p_attempt: id })))
  })

  it('denies anonymous direct table access', async () => {
    const result = await anon.from('committee_roster').select('id').limit(1)
    expect(result.error).not.toBeNull()
  })

  it('allows admins but rejects HOF/HOG for every admin practice RPC', async () => {
    const member = await createRosterMember('AdminOnly')
    const group = await createGroup('Admin Group', 3)
    const calls = [
      ['admin_assign_practice_member', { p_roster_member: member.id, p_group: group.id }],
      ['admin_update_practice_group', {
        p_group: group.id,
        p_name: group.name,
        p_committee_capacity: 3,
        p_faci_gm_capacity: 3,
        p_status: 'open',
      }],
      ['admin_apply_practice_roster', { p_rows: [] }],
    ] as const
    for (const [rpc, args] of calls) {
      const denied = await headClient.rpc(rpc, args)
      expect(denied.error?.message).toContain('not_authorized')
    }

    const allowed = await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: member.id,
      p_group: group.id,
    })
    expect(allowed.error).toBeNull()
  })

  it('keeps the legacy group update RPC compatible with split capacity', async () => {
    const group = await createGroup('Legacy RPC', 2)
    const updated = await adminClient.rpc('admin_update_practice_group', {
      p_group: group.id,
      p_name: group.name,
      p_capacity: 5,
      p_status: 'open',
    })

    expect(updated.error).toBeNull()
    expect(updated.data).toMatchObject({
      committee_capacity: 5,
      faci_gm_capacity: 5,
    })
  })

  it('maps a legacy direct-insert capacity into both split quotas', async () => {
    const { data, error } = await service
      .from('practice_groups')
      .insert({
        name: `Legacy Insert ${suffix}`,
        capacity: 6,
        status: 'open',
        created_by: adminProfileId,
      })
      .select('id, committee_capacity, faci_gm_capacity')
      .single()

    expect(error).toBeNull()
    if (!data) throw new Error('Legacy group fixture was not created')
    groupIds.push(data.id)
    expect(data).toMatchObject({
      committee_capacity: 6,
      faci_gm_capacity: 6,
    })
  })

  it('prevents admins from lowering either category below its current bookings', async () => {
    const committee = await createRosterMember('CapacityCommittee', true, 'designer')
    const faciGm = await createRosterMember('CapacityFaciGm', true, 'game_master')
    const group = await createGroup('Capacity Guard', 2)
    expect((await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: committee.id, p_group: group.id,
    })).error).toBeNull()
    expect((await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: faciGm.id, p_group: group.id,
    })).error).toBeNull()

    const update = (committeeCapacity: number, faciGmCapacity: number) => adminClient.rpc(
      'admin_update_practice_group',
      {
        p_group: group.id,
        p_name: group.name,
        p_committee_capacity: committeeCapacity,
        p_faci_gm_capacity: faciGmCapacity,
        p_status: 'open',
      },
    )
    expect((await update(0, 2)).error?.message).toContain('committee_capacity_below_booking_count')
    expect((await update(2, 0)).error?.message).toContain('faci_gm_capacity_below_booking_count')
    expect((await update(1, 1)).error).toBeNull()
  })

  it('prevents a roster position edit from moving a booked member into a full category', async () => {
    const committee = await createRosterMember('PositionCommittee', true, 'treasurer')
    const faciGm = await createRosterMember('PositionFaciGm', true, 'facilitator')
    const group = await createGroup('Position Guard', 1)
    expect((await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: committee.id, p_group: group.id,
    })).error).toBeNull()
    expect((await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: faciGm.id, p_group: group.id,
    })).error).toBeNull()

    const changed = await service.from('committee_roster').update({ position: 'designer' }).eq('id', faciGm.id)
    expect(changed.error?.message).toContain('member_category_capacity_full')
  })

  it('attributes an admin removal of a self-service booking to the admin', async () => {
    const member = await createRosterMember('AuditRemoval')
    const group = await createGroup('Audit Removal Group')
    const booked = await service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: group.id,
    })
    expect(booked.error).toBeNull()

    const removed = await adminClient.rpc('admin_remove_practice_booking', {
      p_booking: booked.data.id,
    })
    expect(removed.error).toBeNull()

    const { data: audit, error } = await service
      .from('audit_log')
      .select('actor_type, actor_id, action')
      .eq('table_name', 'practice_group_bookings')
      .eq('record_id', booked.data.id)
      .eq('action', 'delete')
      .single()
    expect(error).toBeNull()
    expect(audit).toMatchObject({ actor_type: 'user', actor_id: adminProfileId, action: 'delete' })
  })

  it('keeps the original booking when two admin moves race for one destination space', async () => {
    const first = await createRosterMember('MoveA')
    const second = await createRosterMember('MoveB')
    const occupant = await createRosterMember('MoveOccupant')
    const origin = await createGroup('Move Origin', 2)
    const destination = await createGroup('Move Destination', 2)

    const firstBooking = await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: first.id,
      p_group: origin.id,
    })
    const secondBooking = await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: second.id,
      p_group: origin.id,
    })
    await adminClient.rpc('admin_assign_practice_member', {
      p_roster_member: occupant.id,
      p_group: destination.id,
    })

    const bookingIds = [firstBooking.data.id as string, secondBooking.data.id as string]
    const results = await Promise.all(bookingIds.map((bookingId) => adminClient.rpc(
      'admin_move_practice_member',
      { p_booking: bookingId, p_group: destination.id },
    )))
    expect(results.filter((result) => !result.error)).toHaveLength(1)

    const failedIndex = results.findIndex((result) => result.error)
    const { data: unchanged, error } = await service
      .from('practice_group_bookings')
      .select('group_id')
      .eq('id', bookingIds[failedIndex])
      .single()
    expect(error).toBeNull()
    expect(unchanged?.group_id).toBe(origin.id)
  })
})
