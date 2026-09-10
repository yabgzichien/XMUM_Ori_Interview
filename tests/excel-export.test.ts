import { describe, expect, it } from 'vitest'
import {
  generateInterviewBookingWorkbook,
  formatSlotTimePart,
  formatSlotTimeRange,
  getLocalDateString,
} from '@/lib/excel-export'
import type { HeadBooking, HeadSlot } from '@/lib/head'

describe('excel-export helpers', () => {
  it('formats slot time part in Asia/Kuala_Lumpur correctly', () => {
    // 01:00 UTC = 09:00 in UTC+8
    expect(formatSlotTimePart('2026-08-18T01:00:00+00:00')).toBe('9.00am')
    // 10:00 UTC = 18:00 (6:00pm) in UTC+8
    expect(formatSlotTimePart('2026-12-26T10:00:00+00:00')).toBe('6.00pm')
    // 14:45 UTC = 22:45 (10:45pm) in UTC+8
    expect(formatSlotTimePart('2026-12-26T14:45:00+00:00')).toBe('10.45pm')
  })

  it('formats slot time range correctly matching example format', () => {
    expect(
      formatSlotTimeRange('2026-12-26T10:00:00+00:00', '2026-12-26T10:15:00+00:00'),
    ).toBe('6.00pm-6.15pm')
    expect(
      formatSlotTimeRange('2026-12-26T14:45:00+00:00', '2026-12-26T15:00:00+00:00'),
    ).toBe('10.45pm-11.00pm')
  })

  it('gets local calendar date string YYYY-MM-DD', () => {
    expect(getLocalDateString('2026-08-18T01:00:00+00:00')).toBe('2026-08-18')
    expect(getLocalDateString('2026-12-26T10:00:00+00:00')).toBe('2026-12-26')
  })
})

describe('generateInterviewBookingWorkbook', () => {
  const mockSlots: HeadSlot[] = [
    {
      id: 'slot-1',
      track: 'game_master',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: '2026-12-26T10:00:00+00:00', // 6:00pm
      ends_at: '2026-12-26T10:15:00+00:00',   // 6:15pm
      capacity: 4,
      status: 'open',
      booked_count: 2,
      venue: 'B1#101',
    },
    {
      id: 'slot-2',
      track: 'game_master',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: '2026-12-26T10:15:00+00:00', // 6:15pm
      ends_at: '2026-12-26T10:30:00+00:00',   // 6:30pm
      capacity: 4,
      status: 'open',
      booked_count: 1,
      venue: 'B1#101',
    },
  ]

  const mockBookings: HeadBooking[] = [
    {
      booking_id: 'bk-1',
      slot_id: 'slot-1',
      track: 'game_master',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: '2026-12-26T10:00:00+00:00',
      ends_at: '2026-12-26T10:15:00+00:00',
      applicant_name: 'Alice Tan',
      applicant_email: 'alice@xmu.edu.my',
      student_id: 'SWE210001',
      experiences: 'None',
      interview_notes: null,
      created_at: '2026-12-01T00:00:00Z',
      interview_status: 'approved',
      venue: 'B1#101',
      invited_at: null,
      invite_claimed_at: null,
    },
    {
      booking_id: 'bk-2',
      slot_id: 'slot-1',
      track: 'game_master',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: '2026-12-26T10:00:00+00:00',
      ends_at: '2026-12-26T10:15:00+00:00',
      applicant_name: 'Bob Lee',
      applicant_email: 'bob@xmu.edu.my',
      student_id: 'SWE210002',
      experiences: 'Gaming club',
      interview_notes: null,
      created_at: '2026-12-01T00:00:00Z',
      interview_status: 'pending',
      venue: 'B1#101',
      invited_at: null,
      invite_claimed_at: null,
    },
    {
      booking_id: 'bk-3',
      slot_id: 'slot-2',
      track: 'game_master',
      orientation: 'december',
      orientation_year: 2026,
      starts_at: '2026-12-26T10:15:00+00:00',
      ends_at: '2026-12-26T10:30:00+00:00',
      applicant_name: 'Charlie Wong',
      applicant_email: 'charlie@xmu.edu.my',
      student_id: 'SWE210003',
      experiences: 'Orientation leader',
      interview_notes: null,
      created_at: '2026-12-01T00:00:00Z',
      interview_status: 'pending',
      venue: 'B1#101',
      invited_at: null,
      invite_claimed_at: null,
    },
  ]

  it('generates a workbook with worksheet named 26_12', async () => {
    const workbook = await generateInterviewBookingWorkbook({
      track: 'game_master',
      orientation: 'december',
      orientationYear: 2026,
      slots: mockSlots,
      bookings: mockBookings,
    })

    const sheet = workbook.getWorksheet('26_12')
    expect(sheet).toBeDefined()
    expect(sheet?.name).toBe('26_12')
  })

  it('sets correct column widths matching example', async () => {
    const workbook = await generateInterviewBookingWorkbook({
      track: 'game_master',
      orientation: 'december',
      orientationYear: 2026,
      slots: mockSlots,
      bookings: mockBookings,
    })

    const sheet = workbook.getWorksheet('26_12')!
    expect(sheet.getColumn(2).width).toBeCloseTo(21.38, 1) // Col B
    expect(sheet.getColumn(3).width).toBeCloseTo(26.38, 1) // Col C
    expect(sheet.getColumn(4).width).toBeCloseTo(17.63, 1) // Col D
    expect(sheet.getColumn(5).width).toBeCloseTo(22.5, 1)  // Col E
    expect(sheet.getColumn(6).width).toBeCloseTo(12.0, 1)  // Col F
  })

  it('creates header blocks with location and styling on rows 3-4', async () => {
    const workbook = await generateInterviewBookingWorkbook({
      track: 'game_master',
      orientation: 'december',
      orientationYear: 2026,
      slots: mockSlots,
      bookings: mockBookings,
    })

    const sheet = workbook.getWorksheet('26_12')!
    const table1Cell = sheet.getCell('B3')
    expect(table1Cell.value).toBe('Table 1')
    expect(table1Cell.font?.bold).toBe(true)
    expect(table1Cell.font?.size).toBe(20)

    const loc1Cell = sheet.getCell('D3')
    expect(loc1Cell.value).toBe('Location: B1#101')
    expect(loc1Cell.font?.bold).toBe(true)
    expect(loc1Cell.font?.size).toBe(20)

    // Fill should be #C9DAF8
    const fill = loc1Cell.fill as { type: string; fgColor?: { argb?: string } }
    expect(fill.fgColor?.argb).toBe('FFC9DAF8')
  })

  it('renders headers on row 5 and green example on row 6', async () => {
    const workbook = await generateInterviewBookingWorkbook({
      track: 'game_master',
      orientation: 'december',
      orientationYear: 2026,
      slots: mockSlots,
      bookings: mockBookings,
    })

    const sheet = workbook.getWorksheet('26_12')!
    expect(sheet.getCell('B5').value).toBe('Time Slot')
    expect(sheet.getCell('C5').value).toBe('Name')
    expect(sheet.getCell('D5').value).toBe('Student ID')
    expect(sheet.getCell('E5').value).toBe('Contact Number')
    expect(sheet.getCell('F5').value).toBe('Attendance')

    // Row 6 Example
    expect(sheet.getCell('B6').value).toBe('Example')
    expect(sheet.getCell('C6').value).toBe('Soo Stanley Prince')
    expect(sheet.getCell('D6').value).toBe('FIs2508139')
    expect(sheet.getCell('E6').value).toBe('011-27093927')
    expect(sheet.getCell('F6').value).toBe('1/0')

    const exFill = sheet.getCell('C6').fill as { type: string; fgColor?: { argb?: string } }
    expect(exFill.fgColor?.argb).toBe('FF00FF00')
  })

  it('populates candidate bookings into slot rows with zebra styling', async () => {
    const workbook = await generateInterviewBookingWorkbook({
      track: 'game_master',
      orientation: 'december',
      orientationYear: 2026,
      slots: mockSlots,
      bookings: mockBookings,
    })

    const sheet = workbook.getWorksheet('26_12')!

    // Slot 1: Row 7-10 (6.00pm-6.15pm)
    expect(sheet.getCell('B7').value).toBe('6.00pm-6.15pm')
    // Candidate 1
    expect(sheet.getCell('C7').value).toBe('Alice Tan')
    expect(sheet.getCell('D7').value).toBe('SWE210001')
    // Candidate 2
    expect(sheet.getCell('C8').value).toBe('Bob Lee')
    expect(sheet.getCell('D8').value).toBe('SWE210002')
    // Candidates 3 and 4 should be empty
    expect(sheet.getCell('C9').value).toBe('')
    expect(sheet.getCell('C10').value).toBe('')

    // Slot 1 is odd index (0) -> grey zebra fill #D9D9D9
    const slot1Fill = sheet.getCell('B7').fill as { type: string; fgColor?: { argb?: string } }
    expect(slot1Fill.fgColor?.argb).toBe('FFD9D9D9')

    // Slot 2: Row 11-14 (6.15pm-6.30pm)
    expect(sheet.getCell('B11').value).toBe('6.15pm-6.30pm')
    expect(sheet.getCell('C11').value).toBe('Charlie Wong')
    expect(sheet.getCell('D11').value).toBe('SWE210003')

    // Slot 2 is even index (1) -> no fill (white)
    expect(sheet.getCell('B11').fill).toBeUndefined()
  })

  it('generates default template slots when no slots are given', async () => {
    const workbook = await generateInterviewBookingWorkbook({
      track: 'facilitator',
      orientation: 'december',
      orientationYear: 2026,
      slots: [],
      bookings: [],
    })

    const sheet = workbook.getWorksheet('Sheet1')!
    expect(sheet).toBeDefined()
    expect(sheet.getCell('B7').value).toBe('6.00pm-6.15pm')
    expect(sheet.getCell('B83').value).toBe('10.45pm-11.00pm')
  })
})
