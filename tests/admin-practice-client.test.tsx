import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommitteeDashboard } from '@/app/admin/CommitteeDashboard'
import { RosterManager } from '@/app/admin/practice/RosterManager'
import { RosterImportPanel } from '@/app/admin/practice/RosterImportPanel'
import { PracticeGroupManager } from '@/app/admin/practice/PracticeGroupManager'
import { AdminPracticeDashboard } from '@/app/admin/practice/AdminPracticeDashboard'
import * as actions from '@/app/actions/practiceAdminActions'

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}))

vi.mock('@/app/actions/practiceAdminActions', () => ({
  saveRosterMemberAction: vi.fn(),
  setRosterMemberActiveAction: vi.fn(),
  createPracticeGroupAction: vi.fn(),
  updatePracticeGroupAction: vi.fn(),
  deletePracticeGroupAction: vi.fn(),
  savePracticeSessionAction: vi.fn(),
  deletePracticeSessionAction: vi.fn(),
  assignPracticeMemberAction: vi.fn(),
  movePracticeMemberAction: vi.fn(),
  removePracticeBookingAction: vi.fn(),
  savePracticeOpeningAction: vi.fn(),
  savePracticeGroupDetailsAction: vi.fn(),
}))

const roster = [{
  id: 'member-1', name: 'Alice Tan', student_id: 'DSC2344112', position: 'facilitator',
  active: true, booking_id: 'booking-1', group_id: 'group-1', group_name: 'Group A',
}, {
  id: 'member-2', name: 'Bob Lee', student_id: 'DSC2344113', position: 'game_master',
  active: false, booking_id: null, group_id: null, group_name: null,
}, {
  id: 'member-3', name: 'Carol Lim', student_id: 'DSC2344114', position: 'facilitator',
  active: true, booking_id: null, group_id: null, group_name: null,
}]

const groups = [{
  id: 'group-1', name: 'Group A', capacity: 5, committee_capacity: 3, faci_gm_capacity: 2,
  status: 'open' as const, booking_count: 1, committee_booking_count: 0, faci_gm_booking_count: 1, session_count: 1,
  performance_type: 'K-pop dance', description: 'High energy performance.', songs: 'Gee + Fighting + Timber', leader_roster_member_ids: ['member-1'], leader_names: ['Alice Tan'],
  performance_video_url: 'https://youtu.be/dQw4w9WgXcQ', song_source_type: 'youtube' as const,
  song_url: 'https://youtu.be/5qap5aO4i9A', song_storage_path: null,
}, {
  id: 'group-2', name: 'Group B', capacity: 6, committee_capacity: 4, faci_gm_capacity: 2,
  status: 'closed' as const, booking_count: 0, committee_booking_count: 0, faci_gm_booking_count: 0, session_count: 0,
  performance_type: null, description: null, songs: null, leader_roster_member_ids: [], leader_names: [],
  performance_video_url: null, song_source_type: null, song_url: null, song_storage_path: null,
}]

const bookings = [{ id: 'booking-1', group_id: 'group-1', roster_member_id: 'member-1', member_name: 'Alice Tan', student_id: 'DSC2344112', source: 'self_service' as const }]
const sessions = [{ id: 'session-1', group_id: 'group-1', starts_at: '2026-12-05T02:00:00.000Z', ends_at: '2026-12-05T03:00:00.000Z', location: 'D5-101' }]
const positions = [{ value: 'facilitator', label: 'Facilitator' }, { value: 'game_master', label: 'Game Master' }]
const snapshot = { roster, groups, bookings, sessions, positions, booking_opens_at: '2026-12-01T01:00:00.000Z' }

describe('admin practice management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(actions.saveRosterMemberAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.setRosterMemberActiveAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.createPracticeGroupAction).mockResolvedValue({ data: { id: 'group-new' }, error: null })
    vi.mocked(actions.updatePracticeGroupAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.deletePracticeGroupAction).mockResolvedValue({ data: true, error: null })
    vi.mocked(actions.savePracticeSessionAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.deletePracticeSessionAction).mockResolvedValue({ data: true, error: null })
    vi.mocked(actions.assignPracticeMemberAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.movePracticeMemberAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.removePracticeBookingAction).mockResolvedValue({ data: true, error: null })
    vi.mocked(actions.savePracticeOpeningAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.savePracticeGroupDetailsAction).mockResolvedValue({ data: {}, error: null })
  })

  it('lets admins schedule or clear the shared booking opening time in Malaysia time', async () => {
    render(<AdminPracticeDashboard snapshot={snapshot} />)
    const opening = screen.getByRole('button', { name: /booking opens at.*malaysia time/i })
    expect(opening.textContent).toMatch(/1 Dec 2026/)
    expect(opening.textContent).toMatch(/9:00/)

    fireEvent.click(opening)
    fireEvent.click(screen.getByRole('button', { name: '2 December 2026' }))
    fireEvent.change(screen.getByLabelText('Booking opens at (Malaysia time) hour'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Booking opens at (Malaysia time) minute'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /save opening time/i }))
    await waitFor(() => expect(actions.savePracticeOpeningAction).toHaveBeenCalledWith({ opensAt: '2026-12-02T10:30' }))

    const clearButton = screen.getByRole('button', { name: /clear opening time/i })
    await waitFor(() => expect(clearButton.hasAttribute('disabled')).toBe(false))
    fireEvent.click(clearButton)
    await waitFor(() => expect(actions.savePracticeOpeningAction).toHaveBeenCalledWith({ opensAt: null }))
  })

  it('summarizes practice groups without a roster workspace', () => {
    render(<AdminPracticeDashboard snapshot={snapshot} />)
    expect(screen.queryByLabelText('Practice overview')).toBeNull()
    expect(screen.getByRole('timer')).toBeDefined()
    expect(screen.getByRole('heading', { name: /^practice group$/i })).toBeDefined()
    expect(screen.queryByRole('tab', { name: /roster/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: /import roster/i })).toBeNull()
  })

  it('supports keyboard navigation between committee roster tabs', () => {
    render(<CommitteeDashboard roster={roster} positions={positions} />)
    const rosterTab = screen.getByRole('tab', { name: /^roster3$/i })
    const titlesTab = screen.getByRole('tab', { name: /^titles2$/i })
    expect(screen.queryByRole('tab', { name: /import/i })).toBeNull()

    rosterTab.focus()
    fireEvent.keyDown(rosterTab, { key: 'ArrowRight' })
    expect(titlesTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(titlesTab)
    expect(screen.getByRole('heading', { name: /roster titles/i })).toBeDefined()
  })

  it('filters the roster by name, student ID, or position', () => {
    render(<RosterManager roster={roster} positions={positions} />)
    fireEvent.change(screen.getByRole('searchbox', { name: /search roster/i }), { target: { value: 'Bob' } })
    expect(screen.getByText('Bob Lee')).toBeDefined()
    expect(screen.queryByText('Alice Tan')).toBeNull()

    fireEvent.change(screen.getByRole('searchbox', { name: /search roster/i }), { target: { value: 'DSC2344114' } })
    expect(screen.getByText('Carol Lim')).toBeDefined()
    expect(screen.queryByText('Bob Lee')).toBeNull()
  })

  it('adds, edits, deactivates, and reactivates roster members', async () => {
    render(<RosterManager roster={roster} positions={positions} />)
    expect(screen.queryByLabelText('Name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^add member$/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Carol Lim' } })
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'DSC2344114' } })
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'facilitator' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add member/i }))
    await waitFor(() => expect(actions.saveRosterMemberAction).toHaveBeenCalledWith({ name: 'Carol Lim', studentId: 'DSC2344114', position: 'facilitator', contactNumber: '' }))

    fireEvent.click(screen.getByRole('button', { name: /edit DSC2344112/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Alice Updated' } })
    fireEvent.click(screen.getByRole('button', { name: /save member/i }))
    await waitFor(() => expect(actions.saveRosterMemberAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'member-1', name: 'Alice Updated' })))

    fireEvent.click(screen.getByRole('button', { name: /deactivate DSC2344112/i }))
    await waitFor(() => expect(actions.setRosterMemberActiveAction).toHaveBeenCalledWith('member-1', false))
    fireEvent.click(screen.getByRole('button', { name: /reactivate DSC2344113/i }))
    await waitFor(() => expect(actions.setRosterMemberActiveAction).toHaveBeenCalledWith('member-2', true))
  })

  it('announces roster action errors as alerts', async () => {
    vi.mocked(actions.saveRosterMemberAction).mockResolvedValue({ data: null, error: 'That student ID is already in use.' })
    render(<RosterManager roster={roster} positions={positions} />)
    fireEvent.click(screen.getByRole('button', { name: /^add member$/i }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Duplicate Member' } })
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'DSC2344112' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /add member/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('already in use')
  })

  it('shows import errors and applies only the same validated JSON', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { rows: [], inserted: 0, updated: 0, errors: [{ row: 3, field: 'student_id', message: 'Duplicate student ID.' }] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { rows: [{ rowNumber: 1 }], inserted: 1, updated: 0, errors: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { inserted: 1, updated: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    const onDone = vi.fn()
    render(<RosterImportPanel positions={positions} onDone={onDone} />)
    const box = screen.getByLabelText('Roster JSON')
    fireEvent.change(box, { target: { value: '[bad]' } })
    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    expect(await screen.findByText('Item 3 — student_id: Duplicate student ID.')).toBeDefined()
    expect((screen.getByRole('button', { name: /apply import/i }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(box, { target: { value: '[good]' } })
    fireEvent.click(screen.getByRole('button', { name: /^validate$/i }))
    await screen.findByText(/1 new member/i)
    fireEvent.click(screen.getByRole('button', { name: /apply import/i }))
    expect(await screen.findByText(/import complete/i)).toBeDefined()
    const validatedFile = (fetchMock.mock.calls[1][1]?.body as FormData).get('file') as File
    const appliedFile = (fetchMock.mock.calls[2][1]?.body as FormData).get('file') as File
    expect(await validatedFile.text()).toBe('[good]')
    expect(await appliedFile.text()).toBe('[good]')
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalled()
    fetchMock.mockRestore()
  })

  it('pastes from the clipboard and exposes the AI prompt with live positions', async () => {
    Object.assign(navigator, { clipboard: { readText: vi.fn().mockResolvedValue('[{"pasted":true}]'), writeText: vi.fn().mockResolvedValue(undefined) } })
    render(<RosterImportPanel positions={positions} />)
    fireEvent.click(screen.getByRole('button', { name: /^paste$/i }))
    await waitFor(() => expect((screen.getByLabelText('Roster JSON') as HTMLTextAreaElement).value).toBe('[{"pasted":true}]'))
    fireEvent.click(screen.getByRole('button', { name: /copy ai prompt/i }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledTimes(1))
    const prompt = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
    expect(prompt).toContain('"facilitator"')
    expect(prompt).toMatch(/never invent/i)
  })

  it('manages groups, sessions, assignments, moves, and removals', async () => {
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    expect(screen.queryByLabelText('New group name')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^create a practice group$/i }))
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Group C' } })
    fireEvent.change(screen.getByLabelText('New group committee capacity'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('New group Faci/GM capacity'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: /^create group$/i }))
    await waitFor(() => expect(actions.createPracticeGroupAction).toHaveBeenCalledWith({
      name: 'Group C', committeeCapacity: 5, faciGmCapacity: 7,
    }))

    fireEvent.click(screen.getByRole('button', { name: /edit group a/i }))
    fireEvent.change(screen.getByLabelText('Committee capacity for Group A'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Faci/GM capacity for Group A'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: /save group a/i }))
    await waitFor(() => expect(actions.updatePracticeGroupAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 'group-1', committeeCapacity: 4, faciGmCapacity: 3,
    })))

    fireEvent.click(screen.getByRole('button', { name: /edit group a/i }))
    fireEvent.click(screen.getByRole('button', { name: /close group a/i }))
    await waitFor(() => expect(actions.updatePracticeGroupAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1', status: 'closed' })))
    fireEvent.click(screen.getByRole('button', { name: /edit group b/i }))
    fireEvent.click(screen.getByRole('button', { name: /delete group b/i }))
    await waitFor(() => expect(actions.deletePracticeGroupAction).toHaveBeenCalledWith('group-2'))

    fireEvent.click(screen.getByRole('button', { name: /edit group a/i }))
    // Session scheduling is hidden for now.
    expect(screen.queryByRole('button', { name: /add new session to group a/i })).toBeNull()

    expect(screen.queryByRole('combobox', { name: 'Move DSC2344112' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^edit DSC2344112$/i }))
    fireEvent.change(screen.getByRole('combobox', { name: 'Move DSC2344112' }), { target: { value: 'group-2' } })
    fireEvent.click(screen.getByRole('button', { name: /^move DSC2344112$/i }))
    await waitFor(() => expect(actions.movePracticeMemberAction).toHaveBeenCalledWith('booking-1', 'group-2'))
    fireEvent.click(screen.getByRole('button', { name: /^edit DSC2344112$/i }))
    fireEvent.click(screen.getByRole('button', { name: /remove DSC2344112/i }))
    await waitFor(() => expect(actions.removePracticeBookingAction).toHaveBeenCalledWith('booking-1'))

    fireEvent.click(screen.getByRole('button', { name: /edit group b/i }))
    fireEvent.click(screen.getByRole('button', { name: /add member to group b/i }))
    fireEvent.change(screen.getByRole('searchbox', { name: /search members to add/i }), { target: { value: 'Carol' } })
    fireEvent.click(screen.getByRole('button', { name: /add DSC2344114 to group b/i }))
    await waitFor(() => expect(actions.assignPracticeMemberAction).toHaveBeenCalledWith('member-3', 'group-2'))
  })

  it('edits optional performance details and song source for each group', async () => {
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    fireEvent.click(screen.getByRole('button', { name: /edit group a/i }))

    expect((screen.getByLabelText('Songs for Group A') as HTMLInputElement).value).toBe('Gee + Fighting + Timber')
    expect(screen.queryByLabelText('Performance type for Group A')).toBeNull()
    expect(screen.queryByLabelText('Description for Group A')).toBeNull()
    expect(within(screen.getByLabelText('Selected Performance leaders for Group A')).getByText('Alice Tan')).toBeDefined()
    expect((screen.getByText('Optional').closest('details') as HTMLDetailsElement).open).toBe(false)
    fireEvent.change(screen.getByLabelText('Songs for Group A'), { target: { value: 'Updated songs list.' } })
    fireEvent.change(screen.getByLabelText('Song source for Group A'), { target: { value: 'external' } })
    fireEvent.change(screen.getByLabelText('Song link for Group A'), { target: { value: 'https://audio.example.test/song.mp3' } })
    fireEvent.click(screen.getByRole('button', { name: /save performance details for Group A/i }))

    expect(await screen.findByText(/performance details saved/i)).toBeDefined()
  })

  it('preserves the selected destination after a failed move', async () => {
    vi.mocked(actions.movePracticeMemberAction).mockResolvedValue({ data: null, error: 'The destination group is full.' })
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    fireEvent.click(screen.getByRole('button', { name: /edit group a/i }))
    fireEvent.click(screen.getByRole('button', { name: /^edit DSC2344112$/i }))
    const select = screen.getByRole('combobox', { name: 'Move DSC2344112' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'group-2' } })
    fireEvent.click(screen.getByRole('button', { name: /^move DSC2344112$/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('The destination group is full.')
    expect(select.value).toBe('group-2')
  })

  it('shows only name, leader, and seat counts until a group is opened for editing', () => {
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    expect(screen.getByText('Alice Tan')).toBeDefined()
    expect(screen.getByText('Not assigned')).toBeDefined()
    expect(screen.getByRole('meter', { name: 'Committee seats for Group A' })).toBeDefined()
    expect(screen.getByRole('meter', { name: 'Faci/GM seats for Group A' })).toBeDefined()
    expect(screen.queryByText('Open for booking')).toBeNull()
    expect(screen.queryByLabelText('Songs for Group A')).toBeNull()
    expect(screen.queryByLabelText('Performance type for Group A')).toBeNull()
    expect(screen.queryByRole('button', { name: /add new session to group a/i })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /edit group a/i }))
    expect(screen.getByLabelText('Songs for Group A')).toBeDefined()
    expect(screen.queryByLabelText('Performance type for Group A')).toBeNull()
    expect(screen.queryByLabelText('Description for Group A')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /edit group b/i }))
    expect(screen.queryByLabelText('Songs for Group A')).toBeNull()
    expect(screen.getByLabelText('Songs for Group B')).toBeDefined()
    expect(screen.queryByLabelText('Performance type for Group B')).toBeNull()
    expect(screen.queryByLabelText('Description for Group B')).toBeNull()
  })

  it('creates a group with performance details from the popup', async () => {
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    fireEvent.click(screen.getByRole('button', { name: /^create a practice group$/i }))
    expect(screen.getByRole('dialog')).toBeDefined()
    expect(screen.queryByLabelText('New group performance type')).toBeNull()
    expect(screen.queryByLabelText('New group description')).toBeNull()
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Group D' } })
    fireEvent.change(screen.getByLabelText('New group songs'), { target: { value: 'Drama, Supernova' } })
    for (const name of ['alice', 'carol']) {
      fireEvent.click(screen.getByRole('button', { name: 'New group performance leaders' }))
      fireEvent.change(screen.getByRole('searchbox', { name: /search new group performance leaders/i }), { target: { value: name } })
      fireEvent.click(screen.getByRole('option', { name: new RegExp(name, 'i') }).querySelector('button') as HTMLElement)
    }
    expect(within(screen.getByLabelText('Selected New group performance leaders')).getAllByRole('listitem')).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: /remove leader carol/i }))
    fireEvent.click(screen.getByRole('button', { name: /^create group$/i }))
    await waitFor(() => expect(actions.savePracticeGroupDetailsAction).toHaveBeenCalledTimes(1))
    const form = vi.mocked(actions.savePracticeGroupDetailsAction).mock.calls[0][0] as FormData
    expect(form.get('groupId')).toBe('group-new')
    expect(form.get('songs')).toBe('Drama, Supernova')
    expect(form.get('performanceType')).toBeNull()
    expect(form.get('description')).toBeNull()
    expect(form.getAll('leaderRosterMemberId')).toEqual(['member-1'])
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
