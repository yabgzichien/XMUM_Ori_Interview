// Integration tests for the append-only activity log (0029_audit_log.sql).
//
// These talk to a REAL Supabase project and are SKIPPED automatically unless the
// env vars below are present. They verify the two guarantees that cannot be
// unit-tested: that every write is recorded with the right actor, and that
// nothing reachable from the application can alter or delete a recorded entry.
//
// To run them:
//   1. Apply all migrations (npm run migrate) to that project.
//   2. Put NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and
//      SUPABASE_SERVICE_ROLE_KEY in the shell env.
//   3. npx vitest run tests/rpc/audit.test.ts
//
// Do NOT run this against production: the suite's own cleanup appends delete
// entries to the log, and by design they can never be removed.

import { afterAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
const hasEnv = Boolean(url && anonKey && service)

const admin = hasEnv
  ? createClient(url!, service!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

const anon = hasEnv
  ? createClient(url!, anonKey!, { auth: { persistSession: false } })
  : (null as unknown as SupabaseClient)

const createdSlotIds: string[] = []

async function makeSlot() {
  const start = new Date(Date.now() + 72 * 3600_000)
  const end = new Date(start.getTime() + 15 * 60_000)
  const { data, error } = await admin
    .from('slots')
    .insert({
      track: 'facilitator',
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      capacity: 1,
      status: 'open',
      venue: 'Audit Test Venue',
    })
    .select()
    .single()
  if (error) throw error
  createdSlotIds.push(data.id)
  return data
}

/** Newest audit entry for a given table/record. */
async function latestEntry(table: string, recordId: string) {
  const { data, error } = await admin
    .from('audit_log')
    .select('*')
    .eq('table_name', table)
    .eq('record_id', recordId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data
}

afterAll(async () => {
  if (!hasEnv) return
  if (createdSlotIds.length) {
    await admin.from('bookings').delete().in('slot_id', createdSlotIds)
    await admin.from('slots').delete().in('id', createdSlotIds)
  }
})

describe.skipIf(!hasEnv)('audit log', () => {
  it('records a service-role write with a readable summary', async () => {
    const slot = await makeSlot()
    const entry = await latestEntry('slots', slot.id)

    expect(entry).not.toBeNull()
    expect(entry!.action).toBe('insert')
    expect(entry!.actor_type).toBe('service')
    expect(entry!.auth_role).toBe('service_role')
    expect(entry!.summary).toMatch(/^Created interview slot/)
    expect(entry!.summary).toContain('Audit Test Venue')
    expect(entry!.new_data.capacity).toBe(1)
  })

  it('records the field-level diff of an update', async () => {
    const slot = await makeSlot()
    const { error } = await admin.from('slots').update({ capacity: 3 }).eq('id', slot.id)
    expect(error).toBeNull()

    const entry = await latestEntry('slots', slot.id)
    expect(entry!.action).toBe('update')
    expect(entry!.changed_fields).toEqual(['capacity'])
    expect(entry!.old_data.capacity).toBe(1)
    expect(entry!.new_data.capacity).toBe(3)
    expect(entry!.summary).toContain('capacity from 1 to 3')
  })

  it('attributes an anonymous applicant action to the applicant, not the server', async () => {
    const slot = await makeSlot()
    const studentId = `AUDIT${Date.now()}`
    const { data: booking, error } = await admin
      .from('bookings')
      .insert({
        slot_id: slot.id,
        track: 'facilitator',
        applicant_name: 'Audit Test Applicant',
        applicant_email: `audit-${Date.now()}@example.test`,
        student_id: studentId,
      })
      .select()
      .single()
    expect(error).toBeNull()

    // The applicant cancels from /my-booking with no session at all.
    const cancelled = await anon.rpc('cancel_booking_public', {
      p_student_id: studentId,
      p_booking_id: booking!.id,
    })
    expect(cancelled.error).toBeNull()

    const entry = await latestEntry('bookings', booking!.id)
    expect(entry!.actor_type).toBe('public')
    expect(entry!.auth_role).toBe('anon')
    expect(entry!.actor_name).toBe('Audit Test Applicant')
    expect(entry!.summary).toMatch(/^Cancelled booking for Audit Test Applicant/)
  })

  it('cannot be updated, even with the service-role key', async () => {
    const slot = await makeSlot()
    const entry = await latestEntry('slots', slot.id)

    const { error } = await admin
      .from('audit_log')
      .update({ summary: 'tampered' })
      .eq('id', entry!.id)

    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('cannot be deleted, even with the service-role key', async () => {
    const slot = await makeSlot()
    const entry = await latestEntry('slots', slot.id)

    const { error } = await admin.from('audit_log').delete().eq('id', entry!.id)

    expect(error).not.toBeNull()
    expect(error!.code).toBe('42501')
  })

  it('is not readable without a signed-in admin session', async () => {
    const { data, error } = await anon.from('audit_log').select('id').limit(1)
    expect(error ?? { code: '' }).toBeTruthy()
    expect(data ?? []).toEqual([])
  })
})
