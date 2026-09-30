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

type RosterFixture = { id: string; student_id: string }
type GroupFixture = { id: string; name: string }

async function createRosterMember(label: string, active = true): Promise<RosterFixture> {
  const studentId = `T${label}${suffix}`.replace(/[^A-Za-z0-9_-]/g, '').toUpperCase()
  const { data, error } = await service
    .from('committee_roster')
    .insert({
      name: `Test ${label}`,
      student_id: studentId,
      position: 'facilitator',
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
    .insert({ name: `${label} ${suffix}`, capacity, status, created_by: adminProfileId })
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
  })

  it('matches student ID and derived university email without case sensitivity', async () => {
    const member = await createRosterMember('Case')
    const group = await createGroup('Case Group')
    const { data, error } = await service.rpc('public_practice_lookup', {
      p_student_id: ` ${member.student_id.toLowerCase()} `,
      p_email: `${member.student_id}@XMU.EDU.MY`,
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({
      state: 'available',
      groups: [{ id: group.id, name: group.name, seats_left: 4 }],
    })
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
    const booked = await service.rpc('public_book_practice_group', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
      p_group: group.id,
    })
    expect(booked.error).toBeNull()

    const lookup = await service.rpc('public_practice_lookup', {
      p_student_id: member.student_id,
      p_email: `${member.student_id}@xmu.edu.my`,
    })
    expect(lookup.error).toBeNull()
    expect(lookup.data).toMatchObject({
      state: 'booked',
      booking: { group_id: group.id, group_name: group.name, sessions: [] },
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

  it('denies anonymous direct table access', async () => {
    const result = await anon.from('committee_roster').select('id').limit(1)
    expect(result.error).not.toBeNull()
  })

  it('allows admins but rejects HOF/HOG for every admin practice RPC', async () => {
    const member = await createRosterMember('AdminOnly')
    const group = await createGroup('Admin Group', 3)
    const calls = [
      ['admin_assign_practice_member', { p_roster_member: member.id, p_group: group.id }],
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
})
