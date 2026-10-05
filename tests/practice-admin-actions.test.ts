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
  savePracticeGroupDetailsAction,
  savePracticeOpeningAction,
  savePracticeSessionAction,
  saveRosterMemberAction,
} from '@/app/actions/practiceAdminActions'

function queryBuilder(result: { data?: unknown; error?: unknown } = { data: null, error: null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> & { then?: unknown } = {}
  for (const method of ['select', 'eq', 'in', 'order', 'insert', 'upsert', 'update', 'delete']) {
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
    practice_settings: queryBuilder({ data: { id: 'settings-1' }, error: null }),
  }
  const bucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'uploaded.mp3' }, error: null }),
    remove: vi.fn().mockResolvedValue({ data: {}, error: null }),
  }
  return {
    builders,
    from: vi.fn((table: string) => builders[table] ?? queryBuilder()),
    rpc: vi.fn().mockResolvedValue({ data: { id: 'result-1' }, error: null }),
    storage: { from: vi.fn(() => bucket) },
    bucket,
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

  it('stores the shared Malaysia opening time as UTC and allows Preview Mode without a date', async () => {
    const database = databaseFixture()
    mocks.createClient.mockResolvedValue(database)

    expect(await savePracticeOpeningAction({ opensAt: '2026-12-02T10:30' })).toEqual({ data: expect.anything(), error: null })
    expect(database.builders.practice_settings.upsert).toHaveBeenCalledWith(expect.objectContaining({
      orientation: 'december',
      orientation_year: 2026,
      booking_opens_at: '2026-12-02T02:30:00.000Z',
    }), { onConflict: 'orientation,orientation_year' })

    await savePracticeOpeningAction({ opensAt: null })
    expect(database.builders.practice_settings.upsert).toHaveBeenLastCalledWith(expect.objectContaining({ booking_opens_at: null }), { onConflict: 'orientation,orientation_year' })
  })

  it('validates optional performance media before updating a group', async () => {
    const form = new FormData()
    form.set('groupId', 'group-1')
    form.set('performanceType', 'Dance')
    form.set('description', 'Description')
    form.set('leaderRosterMemberId', '')
    form.set('performanceVideoUrl', 'https://example.com/not-youtube')
    form.set('songSourceType', '')
    form.set('songUrl', '')

    expect(await savePracticeGroupDetailsAction(form)).toEqual({
      data: null,
      error: 'Enter a valid YouTube performance video link.',
    })
  })

  it('uploads an MP3 and removes the replaced stored song only after the group update succeeds', async () => {
    const database = databaseFixture()
    database.builders.practice_groups.single
      .mockResolvedValueOnce({ data: { id: 'group-1', song_storage_path: 'group-1/old.mp3' }, error: null })
      .mockResolvedValue({ data: { id: 'group-1' }, error: null })
    mocks.createClient.mockResolvedValue(database)
    const form = new FormData()
    form.set('groupId', 'group-1')
    form.set('performanceType', '')
    form.set('description', '')
    form.set('leaderRosterMemberId', '')
    form.set('performanceVideoUrl', '')
    form.set('songSourceType', 'mp3')
    form.set('songUrl', '')
    form.set('songFile', new File(['audio'], 'song.mp3', { type: 'audio/mpeg' }))

    const result = await savePracticeGroupDetailsAction(form)

    expect(result.error).toBeNull()
    expect(database.bucket.upload).toHaveBeenCalledWith(expect.stringMatching(/^group-1\/.+\.mp3$/), expect.any(File), expect.objectContaining({ contentType: 'audio/mpeg' }))
    expect(database.builders.practice_groups.update).toHaveBeenCalledWith(expect.objectContaining({
      song_source_type: 'mp3',
      song_url: null,
      song_storage_path: expect.stringMatching(/^group-1\/.+\.mp3$/),
    }))
    expect(database.bucket.remove).toHaveBeenCalledWith(['group-1/old.mp3'])
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
