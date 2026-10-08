import { describe, expect, test, vi } from 'vitest'

import {
  LIVE_SITE_URL,
  LOAD_TEST_ACKNOWLEDGEMENT,
  buildApplicant,
  buildDemoSlots,
  chooseSlotIndex,
  chooseTrack,
  selectDemoSlots,
  validateLoadTestTarget,
} from '../load-tests/helpers.mjs'
import {
  assertNoExistingRunState,
  buildK6Environment,
  cleanupDemoRun,
  createChildSignalForwarders,
  runWithCleanup,
  seedDemoRun,
  validateRunnerEnvironment,
} from '../scripts/load-test-runner.mjs'

describe('applicant booking load-test helpers', () => {
  test('rejects a live write test without the exact production acknowledgement', () => {
    expect(() => validateLoadTestTarget(LIVE_SITE_URL, '')).toThrow(
      'Production load test acknowledgement is required',
    )
    expect(() => validateLoadTestTarget(LIVE_SITE_URL, 'yes')).toThrow(
      'Production load test acknowledgement is required',
    )
    expect(() =>
      validateLoadTestTarget(LIVE_SITE_URL, LOAD_TEST_ACKNOWLEDGEMENT),
    ).not.toThrow()
  })

  test('rejects any target other than the approved live booking site', () => {
    expect(() =>
      validateLoadTestTarget(
        'https://example.com',
        LOAD_TEST_ACKNOWLEDGEMENT,
      ),
    ).toThrow('Load test target must be')
  })

  test('builds 40 tagged demo slots with exactly 200 seats', () => {
    const slots = buildDemoSlots({
      runId: 'run-123',
      startsAt: new Date('2099-12-01T01:00:00.000Z'),
    })

    expect(slots).toHaveLength(40)
    expect(slots.filter((slot) => slot.track === 'facilitator')).toHaveLength(20)
    expect(slots.filter((slot) => slot.track === 'game_master')).toHaveLength(20)
    expect(slots.every((slot) => slot.capacity === 5)).toBe(true)
    expect(slots.every((slot) => slot.orientation === 'december')).toBe(true)
    expect(slots.every((slot) => slot.orientation_year === 2026)).toBe(true)
    expect(slots.every((slot) => slot.venue === 'LOADTEST:run-123')).toBe(true)
    expect(slots.reduce((sum, slot) => sum + slot.capacity, 0)).toBe(200)
  })

  test('distributes 200 virtual users evenly across tracks and demo slots', () => {
    const assignments = Array.from({ length: 200 }, (_, index) => {
      const vu = index + 1
      return {
        track: chooseTrack(vu),
        slotIndex: chooseSlotIndex(vu, 20),
      }
    })

    expect(assignments.filter(({ track }) => track === 'facilitator')).toHaveLength(100)
    expect(assignments.filter(({ track }) => track === 'game_master')).toHaveLength(100)

    for (const track of ['facilitator', 'game_master']) {
      for (let slotIndex = 0; slotIndex < 20; slotIndex += 1) {
        expect(
          assignments.filter(
            (assignment) =>
              assignment.track === track && assignment.slotIndex === slotIndex,
          ),
        ).toHaveLength(5)
      }
    }
  })

  test('creates unique campus-format applicant data for every virtual user', () => {
    const first = buildApplicant('run-123', 1)
    const second = buildApplicant('run-123', 2)

    expect(first).toEqual({
      name: 'Load Test Applicant 1',
      studentId: 'LT-RUN123-0001',
      email: 'loadtest+run123-0001@xmu.edu.my',
      contactNumber: '010-9000001',
    })
    expect(second.email).not.toBe(first.email)
    expect(second.studentId).not.toBe(first.studentId)
  })

  test('keeps all tagged demo slots in stable order even when some are full', () => {
    const slots = [
      {
        id: 'later',
        venue: 'LOADTEST:run-123',
        starts_at: '2099-12-01T02:00:00.000Z',
        seats_left: 5,
      },
      {
        id: 'other-run',
        venue: 'LOADTEST:run-999',
        starts_at: '2099-12-01T00:00:00.000Z',
        seats_left: 5,
      },
      {
        id: 'full-but-assigned',
        venue: 'LOADTEST:run-123',
        starts_at: '2099-12-01T01:00:00.000Z',
        seats_left: 0,
      },
    ]

    expect(selectDemoSlots(slots, 'LOADTEST:run-123')).toEqual([
      slots[2],
      slots[0],
    ])
  })
})

describe('load-test lifecycle', () => {
  test('blocks a second seed while recoverable cleanup state exists', () => {
    expect(() => assertNoExistingRunState(true)).toThrow(
      'A seeded load-test run already exists',
    )
    expect(() => assertNoExistingRunState(false)).not.toThrow()
  })

  test('forwards the actual parent signal name to the k6 child', () => {
    const child = { kill: vi.fn() }
    const { onSigint, onSigterm } = createChildSignalForwarders(child)

    onSigint()
    onSigterm()

    expect(child.kill).toHaveBeenNthCalledWith(1, 'SIGINT')
    expect(child.kill).toHaveBeenNthCalledWith(2, 'SIGTERM')
  })

  test('requires both Supabase keys before seeding production demo data', () => {
    expect(() => validateRunnerEnvironment({})).toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_URL',
    )
    expect(() =>
      validateRunnerEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      }),
    ).toThrow('Missing NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(() =>
      validateRunnerEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      }),
    ).toThrow('Missing SUPABASE_SERVICE_ROLE_KEY')
  })

  test('never exposes the service-role key to the k6 child process', () => {
    const childEnvironment = buildK6Environment(
      {
        PATH: '/usr/bin',
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret',
        SMTP_PASSWORD: 'smtp-secret',
        SUPABASE_DB_URL: 'database-secret',
      },
      { runId: 'run-123' },
    )

    expect(childEnvironment).toMatchObject({
      PATH: '/usr/bin',
      TARGET_URL: LIVE_SITE_URL,
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_ANON_KEY: 'anon-key',
      LOAD_TEST_RUN_ID: 'run-123',
      LOAD_TEST_YEAR: '2026',
    })
    expect(childEnvironment).not.toHaveProperty('SUPABASE_SERVICE_ROLE_KEY')
    expect(childEnvironment).not.toHaveProperty('NEXT_PUBLIC_SUPABASE_ANON_KEY')
    expect(childEnvironment).not.toHaveProperty('SMTP_PASSWORD')
    expect(childEnvironment).not.toHaveProperty('SUPABASE_DB_URL')
  })

  test('seeds 40 run-tagged slots without modifying live booking settings', async () => {
    const insertSlots = vi.fn(async (slots) =>
      slots.map((slot, index) => ({ ...slot, id: `slot-${index + 1}` })),
    )

    const state = await seedDemoRun({
      database: { insertSlots },
      runId: 'run-123',
      now: new Date('2026-09-27T01:00:00.000Z'),
    })

    expect(insertSlots).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          track: 'facilitator',
          capacity: 5,
          venue: 'LOADTEST:run-123',
        }),
        expect.objectContaining({
          track: 'game_master',
          capacity: 5,
          venue: 'LOADTEST:run-123',
        }),
      ]),
    )
    expect(state).toEqual({
      runId: 'run-123',
      slotIds: Array.from({ length: 40 }, (_, index) => `slot-${index + 1}`),
    })
  })

  test('cleanup targets only the seeded slot IDs', async () => {
    const deleteHolds = vi.fn(async () => undefined)
    const deleteBookings = vi.fn(async () => undefined)
    const deleteSlots = vi.fn(async () => undefined)

    await cleanupDemoRun({
      database: {
        deleteHolds,
        deleteBookings,
        deleteSlots,
      },
      state: { runId: 'run-123', slotIds: ['slot-1', 'slot-2'] },
    })

    expect(deleteHolds).toHaveBeenCalledWith(['slot-1', 'slot-2'])
    expect(deleteBookings).toHaveBeenCalledWith(['slot-1', 'slot-2'])
    expect(deleteSlots).toHaveBeenCalledWith(['slot-1', 'slot-2'])
  })

  test('always cleans seeded data when the k6 run fails', async () => {
    const cleanup = vi.fn(async () => undefined)

    await expect(
      runWithCleanup({
        seed: async () => ({ runId: 'run-123', slotIds: ['slot-1'] }),
        execute: async () => {
          throw new Error('k6 failed')
        },
        cleanup,
      }),
    ).rejects.toThrow('k6 failed')

    expect(cleanup).toHaveBeenCalledWith({
      runId: 'run-123',
      slotIds: ['slot-1'],
    })
  })
})
