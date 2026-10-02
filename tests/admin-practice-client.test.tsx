import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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

const groups = [{ id: 'group-1', name: 'Group A', capacity: 3, status: 'open' as const, booking_count: 1, session_count: 1 }, {
  id: 'group-2', name: 'Group B', capacity: 4, status: 'closed' as const, booking_count: 0, session_count: 0,
}]

const bookings = [{ id: 'booking-1', group_id: 'group-1', roster_member_id: 'member-1', member_name: 'Alice Tan', student_id: 'DSC2344112', source: 'self_service' as const }]
const sessions = [{ id: 'session-1', group_id: 'group-1', starts_at: '2026-12-05T02:00:00.000Z', ends_at: '2026-12-05T03:00:00.000Z', location: 'D5-101' }]
const positions = [{ value: 'facilitator', label: 'Facilitator' }, { value: 'game_master', label: 'Game Master' }]
const snapshot = { roster, groups, bookings, sessions, positions }

describe('admin practice management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(actions.saveRosterMemberAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.setRosterMemberActiveAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.createPracticeGroupAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.updatePracticeGroupAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.deletePracticeGroupAction).mockResolvedValue({ data: true, error: null })
    vi.mocked(actions.savePracticeSessionAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.deletePracticeSessionAction).mockResolvedValue({ data: true, error: null })
    vi.mocked(actions.assignPracticeMemberAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.movePracticeMemberAction).mockResolvedValue({ data: {}, error: null })
    vi.mocked(actions.removePracticeBookingAction).mockResolvedValue({ data: true, error: null })
  })

  it('summarizes the operation and switches workspaces', () => {
    render(<AdminPracticeDashboard snapshot={snapshot} />)
    const overview = screen.getByLabelText('Practice overview')
    expect(within(overview).getByText('3')).toBeDefined()
    expect(within(overview).getByText('Roster members')).toBeDefined()
    expect(within(overview).getByText('1 booked')).toBeDefined()
    expect(within(overview).getByText('2 remaining spaces')).toBeDefined()

    fireEvent.click(screen.getByRole('tab', { name: /groups/i }))
    expect(screen.getByRole('heading', { name: /practice groups and schedules/i })).toBeDefined()
  })

  it('supports keyboard navigation between management tabs', () => {
    render(<AdminPracticeDashboard snapshot={snapshot} />)
    const rosterTab = screen.getByRole('tab', { name: /^roster3$/i })
    const importTab = screen.getByRole('tab', { name: /^import roster$/i })
    const groupsTab = screen.getByRole('tab', { name: /^groups2$/i })

    rosterTab.focus()
    fireEvent.keyDown(rosterTab, { key: 'ArrowRight' })
    expect(importTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(importTab)

    fireEvent.keyDown(importTab, { key: 'End' })
    expect(groupsTab.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(groupsTab)
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
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Carol Lim' } })
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'DSC2344114' } })
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'facilitator' } })
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    await waitFor(() => expect(actions.saveRosterMemberAction).toHaveBeenCalledWith({ name: 'Carol Lim', studentId: 'DSC2344114', position: 'facilitator' }))

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
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Duplicate Member' } })
    fireEvent.change(screen.getByLabelText('Student ID'), { target: { value: 'DSC2344112' } })
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('already in use')
  })

  it('shows import errors and applies only the same validated file', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { rows: [], inserted: 0, updated: 0, errors: [{ row: 3, field: 'student_id', message: 'Duplicate student ID.' }] } }), { status: 400, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { rows: [{ rowNumber: 2 }], inserted: 1, updated: 0, errors: [] } }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { inserted: 1, updated: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } }))
    render(<RosterImportPanel />)
    const input = screen.getByLabelText(/roster file/i)
    const bad = new File(['bad'], 'bad.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [bad] } })
    fireEvent.click(screen.getByRole('button', { name: /validate file/i }))
    expect(await screen.findByText('Row 3 — student_id: Duplicate student ID.')).toBeDefined()
    expect((screen.getByRole('button', { name: /apply import/i }) as HTMLButtonElement).disabled).toBe(true)

    const good = new File(['good'], 'good.csv', { type: 'text/csv' })
    fireEvent.change(input, { target: { files: [good] } })
    fireEvent.click(screen.getByRole('button', { name: /validate file/i }))
    await screen.findByText(/1 new member/i)
    fireEvent.click(screen.getByRole('button', { name: /apply import/i }))
    expect(await screen.findByText(/import complete/i)).toBeDefined()
    const validatedBody = fetchMock.mock.calls[1][1]?.body as FormData
    const appliedBody = fetchMock.mock.calls[2][1]?.body as FormData
    expect(validatedBody.get('file')).toBe(good)
    expect(appliedBody.get('file')).toBe(good)
    expect(navigation.refresh).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/roster updated. choose another file/i)).toBeDefined()
    expect(screen.queryByText(/your roster is not changed until/i)).toBeNull()
    expect(screen.getByLabelText(/roster file/i)).not.toBe(input)
    fetchMock.mockRestore()
  })

  it('manages groups, sessions, assignments, moves, and removals', async () => {
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    fireEvent.change(screen.getByLabelText('New group name'), { target: { value: 'Group C' } })
    fireEvent.change(screen.getByLabelText('New group capacity'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /create group/i }))
    await waitFor(() => expect(actions.createPracticeGroupAction).toHaveBeenCalledWith({ name: 'Group C', capacity: 5 }))

    fireEvent.click(screen.getByRole('button', { name: /close group a/i }))
    await waitFor(() => expect(actions.updatePracticeGroupAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'group-1', status: 'closed' })))
    fireEvent.click(screen.getByRole('button', { name: /delete group b/i }))
    await waitFor(() => expect(actions.deletePracticeGroupAction).toHaveBeenCalledWith('group-2'))

    fireEvent.change(screen.getByLabelText('Session start for Group A'), { target: { value: '2026-12-06T10:00' } })
    fireEvent.change(screen.getByLabelText('Session end for Group A'), { target: { value: '2026-12-06T11:00' } })
    fireEvent.change(screen.getByLabelText('Session location for Group A'), { target: { value: 'D5-102' } })
    fireEvent.click(screen.getByRole('button', { name: /add session to group a/i }))
    await waitFor(() => expect(actions.savePracticeSessionAction).toHaveBeenCalledWith(expect.objectContaining({ groupId: 'group-1', location: 'D5-102' })))
    fireEvent.click(screen.getByRole('button', { name: /edit session D5-101/i }))
    fireEvent.click(screen.getByRole('button', { name: /save session for group a/i }))
    await waitFor(() => expect(actions.savePracticeSessionAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'session-1' })))
    fireEvent.click(screen.getByRole('button', { name: /delete session D5-101/i }))
    await waitFor(() => expect(actions.deletePracticeSessionAction).toHaveBeenCalledWith('session-1'))

    fireEvent.change(screen.getByLabelText('Assign member to Group B'), { target: { value: 'member-3' } })
    fireEvent.click(screen.getByRole('button', { name: /assign to group b/i }))
    await waitFor(() => expect(actions.assignPracticeMemberAction).toHaveBeenCalledWith('member-3', 'group-2'))
    fireEvent.change(screen.getByRole('combobox', { name: 'Move DSC2344112' }), { target: { value: 'group-2' } })
    fireEvent.click(screen.getByRole('button', { name: /^move DSC2344112$/i }))
    await waitFor(() => expect(actions.movePracticeMemberAction).toHaveBeenCalledWith('booking-1', 'group-2'))
    fireEvent.click(screen.getByRole('button', { name: /remove DSC2344112/i }))
    await waitFor(() => expect(actions.removePracticeBookingAction).toHaveBeenCalledWith('booking-1'))
  })

  it('preserves the selected destination after a failed move', async () => {
    vi.mocked(actions.movePracticeMemberAction).mockResolvedValue({ data: null, error: 'The destination group is full.' })
    render(<PracticeGroupManager groups={groups} roster={roster} bookings={bookings} sessions={sessions} />)
    const select = screen.getByRole('combobox', { name: 'Move DSC2344112' }) as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'group-2' } })
    fireEvent.click(screen.getByRole('button', { name: /^move DSC2344112$/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('The destination group is full.')
    expect(select.value).toBe('group-2')
  })
})
