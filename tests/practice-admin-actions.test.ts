import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import {
  assignPracticeMemberAction,
  createPracticeGroupAction,
  deletePracticeGroupAction,
  movePracticeMemberAction,
  savePracticeSessionAction,
  saveRosterMemberAction,
} from '@/app/actions/practiceAdminActions'

function queryBuilder(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const method of ['select', 'eq', 'in', 'order', 'insert', 'update', 'delete']) {
    builder[method] = vi.fn(() => builder)
  }
  builder.single = vi.fn().mockResolvedValue(result)
  builder.maybeSingle = vi.fn().mockResolvedValue(result)
  builder.then = vi.fn((resolve?: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject))
  return builder as Record<string, ReturnType<typeof vi.fn>>
}

function databaseFixture() {
  const builders: Record<string, ReturnType<typeof queryBuilder>> = {
    committee_positions: queryBuilder({ data: { value: 'facilitator' }, error: null }),
    committee_roster: queryBuilder({ data: { id: 'member-1' }, error: null }),
    practice_groups: queryBuilder({ data: { id: 'group-1' }, error: null }),
    practice_sessions: queryBuilder({ data: { id: 'session-1' }, error: null }),
  }
  return {
    builders,
    from: vi.fn((table: string) => builders[table] ?? queryBuilder()),
    rpc: vi.fn().mockResolvedValue({ data: { id: 'result-1' }, error: null }),
  }
}

describe('practice admin actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentProfile.mockResolvedValue({ id: 'admin-1', role: 'admin' })
    mocks.createClient.mockResolvedValue(databaseFixture())
  })

  it('rejects signed-out and HOF/HOG callers before opening a database client', async () => {
    mocks.getCurrentProfile.mockResolvedValueOnce(null)
    expect(await createPracticeGroupAction({ name: 'A', capacity: 5 })).toEqual({
      data: null,
      error: 'Not signed in.',
    })
    mocks.getCurrentProfile.mockResolvedValueOnce({ id: 'head-1', role: 'head_gm' })
    expect(await createPracticeGroupAction({ name: 'A', capacity: 5 })).toEqual({
      data: null,
      error: 'Not authorized.',
    })
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('rejects blank group names and capacities below one', async () => {
    expect(await createPracticeGroupAction({ name: ' ', capacity: 5 })).toEqual({
      data: null,
      error: 'Group name is required.',
    })
    expect(await createPracticeGroupAction({ name: 'Group A', capacity: 0 })).toEqual({
      data: null,
      error: 'Capacity must be at least 1.',
    })
  })

  it('rejects invalid student IDs and unknown committee positions', async () => {
    expect(await saveRosterMemberAction({ name: 'Member', studentId: 'DSC 1', position: 'facilitator' })).toEqual({
      data: null,
      error: 'Enter a valid student ID.',
    })

    const database = databaseFixture()
    database.builders.committee_positions.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.createClient.mockResolvedValue(database)
    expect(await saveRosterMemberAction({ name: 'Member', studentId: 'DSC1', position: 'unknown' })).toEqual({
      data: null,
      error: 'Choose a valid committee position.',
    })
  })

  it('updates an existing roster UUID when the student ID changes', async () => {
    const database = databaseFixture()
    mocks.createClient.mockResolvedValue(database)
    await saveRosterMemberAction({ id: 'member-1', name: 'Member', studentId: 'NEWID1', position: 'facilitator' })
    expect(database.builders.committee_roster.update).toHaveBeenCalledWith({
      name: 'Member',
      student_id: 'NEWID1',
      position: 'facilitator',
    })
    expect(database.builders.committee_roster.eq).toHaveBeenCalledWith('id', 'member-1')
  })

  it('rejects sessions whose end time is not after the start time', async () => {
    const result = await savePracticeSessionAction({
      groupId: 'group-1',
      startsAt: '2026-12-05T03:00:00.000Z',
      endsAt: '2026-12-05T02:00:00.000Z',
      location: 'D5-101',
    })
    expect(result).toEqual({ data: null, error: 'Session end time must be after its start time.' })
  })

  it.each([
    ['member_not_active', assignPracticeMemberAction, ['member-1', 'group-1'], 'Reactivate this roster member before assigning them.'],
    ['already_booked', assignPracticeMemberAction, ['member-1', 'group-1'], 'This roster member already has a group booking.'],
    ['group_full', movePracticeMemberAction, ['booking-1', 'group-2'], 'The destination group is full.'],
    ['group_has_bookings', deletePracticeGroupAction, ['group-1'], 'Move or remove every member before deleting this group.'],
  ])('maps %s database failures to an actionable admin message', async (databaseError, action, args, message) => {
    const database = databaseFixture()
    database.rpc.mockResolvedValue({ data: null, error: { message: databaseError } })
    mocks.createClient.mockResolvedValue(database)
    const result = await (action as (...input: string[]) => Promise<{ data: unknown; error: string | null }>)(...args)
    expect(result).toEqual({ data: null, error: message })
  })
})
