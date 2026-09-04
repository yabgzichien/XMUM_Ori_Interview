// Integration tests for the slot-hold reservation RPCs (reserve_slot /
// confirm_reservation / release_hold) plus the updated available_slots.
//
// Talks to a REAL Supabase project, same convention as tests/rpc/booking.test.ts.
// Skipped automatically unless NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
// and SUPABASE_SERVICE_ROLE_KEY are present (see that file for setup instructions).

import { afterAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && anonKey && service)

const admin = hasEnv
  ? createClient(url!, service!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

// Applicants never log in for this flow — every call uses a bare anon client.
function anon() {
  return createClient(url!, anonKey!, { auth: { persistSession: false } })
}

const createdSlotIds: string[] = []

async function makeSlot(opts: { capacity?: number; hoursFromNow?: number } = {}) {
  const start = new Date(Date.now() + (opts.hoursFromNow ?? 72) * 3600_000)
  const end = new Date(start.getTime() + 15 * 60_000)
  const { data, error } = await admin
    .from('slots')
    .insert({
      track: 'facilitator',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      capacity: opts.capacity ?? 1,
      status: 'open',
    })
    .select()
    .single()
  if (error) throw error
  createdSlotIds.push(data.id)
  return data
}

async function expireHold(token: string) {
  // Backdate held_at past the 3-minute TTL instead of waiting in real time.
  const staleTime = new Date(Date.now() - 4 * 60_000).toISOString()
  const { error } = await admin.from('slot_holds').update({ held_at: staleTime }).eq('token', token)
  if (error) throw error
}

afterAll(async () => {
  if (!hasEnv) return
  if (createdSlotIds.length) {
    await admin.from('slot_holds').delete().in('slot_id', createdSlotIds)
    await admin.from('bookings').delete().in('slot_id', createdSlotIds)
    await admin.from('slots').delete().in('id', createdSlotIds)
  }
})

describe.skipIf(!hasEnv)('slot hold RPCs', () => {
  it('reserve then confirm books the slot and releases the hold', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const client = anon()

    const reserved = await client.rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(reserved.error).toBeNull()
    expect(reserved.data?.token).toBeTruthy()

    const confirmed = await client.rpc('confirm_reservation', {
      p_token: reserved.data.token,
      p_name: 'Alice Applicant',
      p_student_id: 'AC220001',
      p_email: `alice_${Date.now()}@test.local`,
      p_experiences: 'Ran orientation games last year.',
    })
    expect(confirmed.error).toBeNull()
    expect(confirmed.data?.status).toBe('booked')

    const { data: hold } = await admin.from('slot_holds').select('released').eq('token', reserved.data.token).single()
    expect(hold?.released).toBe(true)
  })

  it('rejects a reserve once holds alone fill capacity', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const first = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(first.error).toBeNull()

    const second = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(second.error).not.toBeNull()
    expect(second.error?.message).toMatch(/full/i)
  })

  it('rejects confirm once the hold has expired', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const client = anon()
    const reserved = await client.rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(reserved.error).toBeNull()

    await expireHold(reserved.data.token)

    const confirmed = await client.rpc('confirm_reservation', {
      p_token: reserved.data.token,
      p_name: 'Bob Applicant',
      p_student_id: 'AC220002',
      p_email: `bob_${Date.now()}@test.local`,
      p_experiences: 'N/A',
    })
    expect(confirmed.error).not.toBeNull()
    expect(confirmed.error?.message).toMatch(/hold expired/i)
  })

  it('release_hold frees the seat immediately for another caller', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const first = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(first.error).toBeNull()

    const released = await anon().rpc('release_hold', { p_token: first.data.token })
    expect(released.error).toBeNull()

    const second = await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(second.error).toBeNull()
  })

  it('reserving with a previous token swaps instead of stacking holds', async () => {
    const slotA = await makeSlot({ capacity: 1 })
    const slotB = await makeSlot({ capacity: 1 })
    const client = anon()

    const first = await client.rpc('reserve_slot', { p_slot: slotA.id, p_prev_token: null })
    expect(first.error).toBeNull()

    const second = await client.rpc('reserve_slot', { p_slot: slotB.id, p_prev_token: first.data.token })
    expect(second.error).toBeNull()

    const { data: oldHold } = await admin.from('slot_holds').select('released').eq('token', first.data.token).single()
    expect(oldHold?.released).toBe(true)

    // slotA's seat is free again since the old hold was released by the swap.
    const rebook = await anon().rpc('reserve_slot', { p_slot: slotA.id, p_prev_token: null })
    expect(rebook.error).toBeNull()
  })

  it('available_slots subtracts an active hold from seats_left', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const before = await admin.rpc('available_slots', { p_track: 'facilitator', p_orientation: 'december', p_year: 2026 })
    const beforeRow = before.data?.find((s: { id: string }) => s.id === slot.id)
    expect(beforeRow?.seats_left).toBe(1)

    await anon().rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })

    const after = await admin.rpc('available_slots', { p_track: 'facilitator', p_orientation: 'december', p_year: 2026 })
    const afterRow = after.data?.find((s: { id: string }) => s.id === slot.id)
    expect(afterRow?.seats_left).toBe(0)
  })

  it('a duplicate-email rejection at confirm does not consume the hold, so a retry can succeed', async () => {
    const slotA = await makeSlot({ capacity: 1 })
    const slotB = await makeSlot({ capacity: 1 })
    const client = anon()
    const sharedEmail = `carol_${Date.now()}@test.local`

    // Book slotA outright so sharedEmail already has an active booking in this track/orientation/year.
    const firstHold = await client.rpc('reserve_slot', { p_slot: slotA.id, p_prev_token: null })
    expect(firstHold.error).toBeNull()
    const firstBooking = await client.rpc('confirm_reservation', {
      p_token: firstHold.data.token,
      p_name: 'Carol Applicant',
      p_student_id: 'AC220003',
      p_email: sharedEmail,
      p_experiences: 'N/A',
    })
    expect(firstBooking.error).toBeNull()

    // Hold slotB, then try to confirm it with the same email — should be
    // rejected for the duplicate, but the hold itself must survive.
    const secondHold = await client.rpc('reserve_slot', { p_slot: slotB.id, p_prev_token: null })
    expect(secondHold.error).toBeNull()

    const rejected = await client.rpc('confirm_reservation', {
      p_token: secondHold.data.token,
      p_name: 'Carol Applicant',
      p_student_id: 'AC220004',
      p_email: sharedEmail,
      p_experiences: 'N/A',
    })
    expect(rejected.error).not.toBeNull()
    expect(rejected.error?.message).toMatch(/already has an active booking/i)

    const { data: hold } = await admin.from('slot_holds').select('released').eq('token', secondHold.data.token).single()
    expect(hold?.released).toBe(false)

    // Retry with a different email on the SAME still-live hold — succeeds.
    const retried = await client.rpc('confirm_reservation', {
      p_token: secondHold.data.token,
      p_name: 'Carol Applicant',
      p_student_id: 'AC220004',
      p_email: `carol2_${Date.now()}@test.local`,
      p_experiences: 'N/A',
    })
    expect(retried.error).toBeNull()
    expect(retried.data?.status).toBe('booked')
  })

  it('confirm_reservation refuses to overbook if capacity is lowered after the hold was taken', async () => {
    const slot = await makeSlot({ capacity: 2 })
    const client = anon()

    const first = await client.rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(first.error).toBeNull()
    const firstBooking = await client.rpc('confirm_reservation', {
      p_token: first.data.token,
      p_name: 'Overbook A',
      p_student_id: 'AC220005',
      p_email: `overbook_a_${Date.now()}@test.local`,
      p_experiences: 'N/A',
    })
    expect(firstBooking.error).toBeNull()

    const second = await client.rpc('reserve_slot', { p_slot: slot.id, p_prev_token: null })
    expect(second.error).toBeNull()

    // Simulate an admin lowering capacity while the second hold is still live.
    await admin.from('slots').update({ capacity: 1 }).eq('id', slot.id)

    const rejected = await client.rpc('confirm_reservation', {
      p_token: second.data.token,
      p_name: 'Overbook B',
      p_student_id: 'AC220006',
      p_email: `overbook_b_${Date.now()}@test.local`,
      p_experiences: 'N/A',
    })
    expect(rejected.error).not.toBeNull()
    expect(rejected.error?.message).toMatch(/full/i)
  })
})
