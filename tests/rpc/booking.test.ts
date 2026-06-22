// Integration tests for the booking RPCs (book_slot / cancel_booking / reschedule_booking).
//
// These talk to a REAL Supabase project and are SKIPPED automatically unless the
// env vars below are present. They verify the guarantees that cannot be unit-tested:
// no overbooking, one active booking per track, and the reschedule cutoff.
//
// To run them once a Supabase project exists:
//   1. Apply all migrations (supabase db push) to that project.
//   2. Put NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
//      SUPABASE_SERVICE_ROLE_KEY in .env.local (or the shell env).
//   3. npm test
//
// Until then `npm test` stays green because the suite is skipped.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && anon && service)

const admin = hasEnv
  ? createClient(url!, service!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

const createdUserIds: string[] = []
const createdSlotIds: string[] = []

async function makeApplicant(email: string) {
  const password = 'Passw0rd!1'
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw error
  const id = data.user!.id
  createdUserIds.push(id)
  await admin.from('profiles').insert({ id, name: email, email, role: 'applicant' })
  const client = createClient(url!, anon!, { auth: { persistSession: false } })
  const signIn = await client.auth.signInWithPassword({ email, password })
  if (signIn.error) throw signIn.error
  return { id, client }
}

async function makeSlot(opts: { capacity?: number; hoursFromNow?: number } = {}) {
  const start = new Date(Date.now() + (opts.hoursFromNow ?? 72) * 3600_000)
  const end = new Date(start.getTime() + 15 * 60_000)
  const { data, error } = await admin
    .from('slots')
    .insert({
      track: 'facilitator',
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

afterAll(async () => {
  if (!hasEnv) return
  if (createdSlotIds.length) {
    await admin.from('bookings').delete().in('slot_id', createdSlotIds)
    await admin.from('slots').delete().in('id', createdSlotIds)
  }
  for (const id of createdUserIds) {
    await admin.from('profiles').delete().eq('id', id)
    await admin.auth.admin.deleteUser(id)
  }
})

describe.skipIf(!hasEnv)('booking RPCs', () => {
  let a1: Awaited<ReturnType<typeof makeApplicant>>
  let a2: Awaited<ReturnType<typeof makeApplicant>>

  beforeAll(async () => {
    a1 = await makeApplicant(`rpc_a1_${Date.now()}@test.local`)
    a2 = await makeApplicant(`rpc_a2_${Date.now()}@test.local`)
  })

  it('books an open slot', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const { data, error } = await a1.client.rpc('book_slot', { p_slot: slot.id })
    expect(error).toBeNull()
    expect(data?.slot_id).toBe(slot.id)
    expect(data?.status).toBe('booked')
  })

  it('rejects a booking that would exceed capacity', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const first = await a1.client.rpc('book_slot', { p_slot: slot.id })
    expect(first.error).toBeNull()
    const second = await a2.client.rpc('book_slot', { p_slot: slot.id })
    expect(second.error).not.toBeNull()
    expect(second.error?.message).toMatch(/full/i)
  })

  it('rejects a second active booking in the same track', async () => {
    const s1 = await makeSlot({ capacity: 1 })
    const s2 = await makeSlot({ capacity: 1 })
    const first = await a1.client.rpc('book_slot', { p_slot: s1.id })
    expect(first.error).toBeNull()
    const dup = await a1.client.rpc('book_slot', { p_slot: s2.id })
    expect(dup.error).not.toBeNull()
    expect(dup.error?.message).toMatch(/already have an active booking/i)
  })

  it('cancel frees the seat', async () => {
    const slot = await makeSlot({ capacity: 1 })
    const booked = await a1.client.rpc('book_slot', { p_slot: slot.id })
    expect(booked.error).toBeNull()
    const cancelled = await a1.client.rpc('cancel_booking', { p_booking: booked.data!.id })
    expect(cancelled.error).toBeNull()
    expect(cancelled.data?.status).toBe('cancelled')
    // seat is free again for another applicant
    const rebook = await a2.client.rpc('book_slot', { p_slot: slot.id })
    expect(rebook.error).toBeNull()
  })

  it('rejects cancel after the cutoff', async () => {
    // default cutoff is 2h; a slot 1h away is past the cutoff
    const slot = await makeSlot({ capacity: 1, hoursFromNow: 1 })
    const booked = await a1.client.rpc('book_slot', { p_slot: slot.id })
    expect(booked.error).toBeNull()
    const cancelled = await a1.client.rpc('cancel_booking', { p_booking: booked.data!.id })
    expect(cancelled.error).not.toBeNull()
    expect(cancelled.error?.message).toMatch(/too late/i)
  })

  it('reschedules within the same track', async () => {
    const s1 = await makeSlot({ capacity: 1 })
    const s2 = await makeSlot({ capacity: 1 })
    const booked = await a1.client.rpc('book_slot', { p_slot: s1.id })
    expect(booked.error).toBeNull()
    const moved = await a1.client.rpc('reschedule_booking', {
      p_booking: booked.data!.id,
      p_new_slot: s2.id,
    })
    expect(moved.error).toBeNull()
    expect(moved.data?.slot_id).toBe(s2.id)
  })
})
