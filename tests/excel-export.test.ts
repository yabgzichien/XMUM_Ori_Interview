import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  generateInterviewBookingWorkbook,
  formatSlotTimePart,
  formatSlotTimeRange,
  getLocalDateString,
  formatExportTimestamp,
  generateExportFilename,
  generatePracticePerformanceWorkbook,
  generatePracticeExportFilename,
  formatOrientationPrefix,
  type PracticeExportGroup,
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

  it('formats export timestamp with dMMMyyyy HHmm matching user requirement', () => {
    // 2022-09-10 12:30 in UTC+8
    const d = new Date('2022-09-10T04:30:00Z')
    expect(formatExportTimestamp(d)).toBe('10Sep2022 1230')
  })

  it('generates export filename with date time', () => {
    const timestampDate = new Date('2022-09-10T04:30:00Z')
    // Single day export
    const filenameSingle = generateExportFilename({
      track: 'game_master',
      orientation: 'december',
      year: 2026,
      startDate: '2026-12-26',
      endDate: '2026-12-26',
      timestampDate,
    })
    expect(filenameSingle).toBe('26_12 GM Interview Time Slot Export 10Sep2022 1230.xlsx')

    // Full orientation export
    const filenameFull = generateExportFilename({
      track: 'facilitator',
      orientation: 'december',
      year: 2026,
      timestampDate,
    })
    expect(filenameFull).toBe('December 2026 Facilitator Interview Time Slot Export 10Sep2022 1230.xlsx')
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

describe('practice performance excel-export', () => {
  it('formats orientation prefix correctly', () => {
    expect(formatOrientationPrefix('december', 2026, '/')).toBe('26/12')
    expect(formatOrientationPrefix('september', 2026, '/')).toBe('26/09')
    expect(formatOrientationPrefix('december', 2026, '_')).toBe('26_12')
    expect(formatOrientationPrefix('september', 2026, '_')).toBe('26_09')
  })

  it('generates filename matching template convention', () => {
    expect(
      generatePracticeExportFilename({ orientation: 'december', orientationYear: 2026 }),
    ).toBe('26_12 Committees Facilitators Game Masters Performance.xlsx')

    expect(
      generatePracticeExportFilename({ orientation: 'september', orientationYear: 2026 }),
    ).toBe('26_09 Committees Facilitators Game Masters Performance.xlsx')
  })

  it('generates workbook with exact structure, colors, borders, and merges matching template', async () => {
    const mockGroups: PracticeExportGroup[] = [
      {
        id: 'g1',
        name: 'Dancing A',
        description: 'Song 1 + Song 2',
        performance_video_url: 'https://youtu.be/video1',
        committee_capacity: 2,
        faci_gm_capacity: 2,
        leaders: [
          { id: 'l1', name: 'Leader One' },
          { id: 'l2', name: 'Leader Two' },
        ],
        committee_members: [
          { id: 'c1', name: 'Committee Alpha' },
        ],
        faci_gm_members: [
          { id: 'f1', name: 'Facilitator A' },
          { id: 'f2', name: 'Facilitator B' },
        ],
      },
      {
        id: 'g2',
        name: 'Dancing B',
        description: 'Song 3 + Song 4',
        performance_video_url: 'https://youtu.be/video2',
        committee_capacity: 2,
        faci_gm_capacity: 2,
        leaders: [
          { id: 'l3', name: 'Leader Three' },
        ],
        committee_members: [
          { id: 'c2', name: 'Committee Beta' },
          { id: 'c3', name: 'Committee Gamma' },
        ],
        faci_gm_members: [
          { id: 'f3', name: 'Facilitator C' },
        ],
      },
    ]

    const workbook = await generatePracticePerformanceWorkbook({
      orientation: 'december',
      orientationYear: 2026,
      groups: mockGroups,
    })

    const ws = workbook.getWorksheet('Performance List')!
    expect(ws).toBeDefined()
    expect(ws.views[0].showGridLines).toBe(true)

    // Column widths
    expect(ws.getColumn(1).width).toBe(18.63)
    expect(ws.getColumn(2).width).toBe(4.13)
    expect(ws.getColumn(3).width).toBe(28.75)
    expect(ws.getColumn(4).width).toBe(28)
    expect(ws.getColumn(5).width).toBe(28)

    // Row 1 Title Banner
    const a1 = ws.getCell('A1')
    expect(a1.value).toBe('26/12 December Orientation Performance List')
    expect(a1.font?.bold).toBe(true)
    expect(a1.font?.size).toBe(25)
    expect(a1.font?.name).toBe('Times New Roman')
    const a1Fill = a1.fill as { fgColor?: { argb?: string } }
    expect(a1Fill.fgColor?.argb).toBe('FFFFFF00')

    // Row 3 Header
    const c3 = ws.getCell('C3')
    expect(c3.value).toBeNull()
    const c3Fill = c3.fill as { fgColor?: { argb?: string } }
    expect(c3Fill.fgColor?.argb).toBe('FF4A86E8')

    const d3 = ws.getCell('D3')
    expect(d3.value).toBe('Dancing A')
    const d3Fill = d3.fill as { fgColor?: { argb?: string } }
    expect(d3Fill.fgColor?.argb).toBe('FF4A86E8')

    const e3 = ws.getCell('E3')
    expect(e3.value).toBe('Dancing B')

    // Row 4 Songs
    expect(ws.getRow(4).height).toBe(69)
    expect(ws.getCell('C4').value).toBe('Songs')
    expect(ws.getCell('D4').value).toBe('Song 1 + Song 2')
    expect(ws.getCell('D4').alignment?.wrapText).toBe(true)
    expect(ws.getCell('E4').value).toBe('Song 3 + Song 4')

    // Row 5 Reference Link
    expect(ws.getCell('C5').value).toBe('Reference Link')
    const d5 = ws.getCell('D5')
    expect(d5.value).toEqual({
      text: 'https://youtu.be/video1',
      hyperlink: 'https://youtu.be/video1',
    })
    expect(d5.font?.color).toEqual({ argb: 'FF0000FF' })
    expect(d5.font?.underline).toBe(true)

    // Max Leaders is 2 (rows 6 and 7)
    // Row 6 Col B: 1, Col C: Leaders, Col D: Leader One, Col E: Leader Three
    expect(ws.getCell('B6').value).toBe(1)
    expect(ws.getCell('C6').value).toBe('Leaders')
    const c6Fill = ws.getCell('C6').fill as { fgColor?: { argb?: string } }
    expect(c6Fill.fgColor?.argb).toBe('FFC9DAF8')
    expect(ws.getCell('D6').value).toBe('Leader One')
    expect(ws.getCell('E6').value).toBe('Leader Three')

    // Row 7 Col B: 2, Col D: Leader Two, Col E: '-' (blank slot in Leaders)
    expect(ws.getCell('B7').value).toBe(2)
    expect(ws.getCell('D7').value).toBe('Leader Two')
    expect(ws.getCell('E7').value).toBe('-')
    const e7Fill = ws.getCell('E7').fill as { fgColor?: { argb?: string } }
    expect(e7Fill.fgColor?.argb).toBe('FFC9DAF8')

    // Committees: capacity is 2, so rows 8 and 9 (Col B: 3 and 4)
    expect(ws.getCell('B8').value).toBe(3)
    expect(ws.getCell('C8').value).toBe('Committees')
    const c8Fill = ws.getCell('C8').fill as { fgColor?: { argb?: string } }
    expect(c8Fill.fgColor?.argb).toBe('FFF4CCCC')
    expect(ws.getCell('D8').value).toBe('Committee Alpha')
    expect(ws.getCell('E8').value).toBe('Committee Beta')

    expect(ws.getCell('B9').value).toBe(4)
    expect(ws.getCell('D9').value).toBe('-') // Empty slot in Dancing A -> '-'
    const d9Fill = ws.getCell('D9').fill as { fgColor?: { argb?: string } }
    expect(d9Fill.fgColor?.argb).toBe('FFF4CCCC')
    expect(ws.getCell('E9').value).toBe('Committee Gamma')

    // Facilitators & Game Masters: capacity is 2, so rows 10 and 11 (Col B: 5 and 6)
    expect(ws.getCell('B10').value).toBe(5)
    expect(ws.getCell('C10').value).toBe('Facilitators & Game Masters')
    const c10Fill = ws.getCell('C10').fill as { fgColor?: { argb?: string } }
    expect(c10Fill.fgColor?.argb).toBe('FFFFF2CC')
    expect(ws.getCell('D10').value).toBe('Facilitator A')
    expect(ws.getCell('E10').value).toBe('Facilitator C')

    expect(ws.getCell('B11').value).toBe(6)
    expect(ws.getCell('D11').value).toBe('Facilitator B')
    expect(ws.getCell('E11').value).toBe('-') // Empty slot in Dancing B -> '-'
    const e11Fill = ws.getCell('E11').fill as { fgColor?: { argb?: string } }
    expect(e11Fill.fgColor?.argb).toBe('FFFFF2CC')
  })

  it('generates exact format and cell values when reconstructing 26_09 template data', async () => {
    const originalWb = new ExcelJS.Workbook()
    await originalWb.xlsx.readFile('./26_09 Committees Facilitators Game Masters Performance.xlsx')
    const origWs = originalWb.worksheets[0]

    const groups: PracticeExportGroup[] = []
    for (let c = 4; c <= 8; c++) {
      const name = String(origWs.getCell(3, c).value)
      const desc = String(origWs.getCell(4, c).value)
      const refLinkVal = origWs.getCell(5, c).value
      const refLink = typeof refLinkVal === 'object' && refLinkVal !== null ? (refLinkVal.text || refLinkVal.hyperlink) : (refLinkVal || '')

      const leaders: Array<{ id: string; name: string; student_id: string }> = []
      for (let r = 6; r <= 8; r++) {
        const v = origWs.getCell(r, c).value
        if (v) leaders.push({ id: `l-${c}-${r}`, name: String(v), student_id: `SL-${c}-${r}` })
      }

      const committees: Array<{ id: string; name: string; student_id: string }> = []
      for (let r = 9; r <= 13; r++) {
        const v = origWs.getCell(r, c).value
        // Skip redacted duplicates (Dong Yanzhe in R13)
        if (v && origWs.getCell(r, c).fill?.fgColor?.argb !== 'FF000000') {
          committees.push({ id: `c-${c}-${r}`, name: String(v), student_id: `SC-${c}-${r}` })
        }
      }

      const faciGms: Array<{ id: string; name: string; student_id: string }> = []
      for (let r = 14; r <= 43; r++) {
        const v = origWs.getCell(r, c).value
        // Skip redacted duplicates (Wang Hao Tong in R42)
        if (v && origWs.getCell(r, c).fill?.fgColor?.argb !== 'FF000000') {
          faciGms.push({ id: `f-${c}-${r}`, name: String(v), student_id: `SF-${c}-${r}` })
        }
      }

      groups.push({
        id: `g-${c}`,
        name,
        description: desc,
        performance_video_url: refLink,
        committee_capacity: 5,
        faci_gm_capacity: 30,
        leaders,
        committee_members: committees,
        faci_gm_members: faciGms,
      })
    }

    const genWb = await generatePracticePerformanceWorkbook({
      orientation: 'september',
      orientationYear: 2026,
      groups,
    })
    const genWs = genWb.getWorksheet('Performance List')!

    expect(genWs).toBeDefined()
    // A1
    expect(genWs.getCell('A1').value).toBe('26/09 September Orientation Performance List')
    expect(genWs.getCell('A1').font?.name).toBe('Times New Roman')
    expect(genWs.getCell('A1').font?.size).toBe(25)
    expect(genWs.getCell('A1').font?.bold).toBe(true)

    // Row 3
    expect(genWs.getCell('C3').value).toBeNull()
    expect(genWs.getCell('D3').value).toBe('Dancing A')
    expect(genWs.getCell('E3').value).toBe('Dancing B')
    expect(genWs.getCell('F3').value).toBe('Dancing C')
    expect(genWs.getCell('G3').value).toBe('Dancing D')
    expect(genWs.getCell('H3').value).toBe('Singing A')

    // Row 4
    expect(genWs.getRow(4).height).toBe(69)
    expect(genWs.getCell('C4').value).toBe('Songs')
    expect(genWs.getCell('D4').value).toBe(origWs.getCell('D4').value)

    // Row 5
    expect(genWs.getCell('C5').value).toBe('Reference Link')

    // Leaders (rows 6..8)
    expect(genWs.getCell('C6').value).toBe('Leaders')
    expect(genWs.getCell('B6').value).toBe(1)
    expect(genWs.getCell('B7').value).toBe(2)
    expect(genWs.getCell('B8').value).toBe(3)
    // Dancing B has 1 leader (Nicole), rows 7 and 8 should be '-' with section fill
    expect(genWs.getCell('E6').value).toBe('Nicole Chuah Jia Xuan')
    expect(genWs.getCell('E7').value).toBe('-')
    expect((genWs.getCell('E7').fill as { fgColor?: { argb?: string } })?.fgColor?.argb).toBe('FFC9DAF8')
    expect(genWs.getCell('E8').value).toBe('-')
    expect((genWs.getCell('E8').fill as { fgColor?: { argb?: string } })?.fgColor?.argb).toBe('FFC9DAF8')

    // Committees (rows 9..13)
    expect(genWs.getCell('C9').value).toBe('Committees')
    expect(genWs.getCell('B9').value).toBe(4)
    expect(genWs.getCell('B13').value).toBe(8)

    // Facilitators & Game Masters (rows 14..43)
    expect(genWs.getCell('C14').value).toBe('Facilitators & Game Masters')
    expect(genWs.getCell('B14').value).toBe(9)
    expect(genWs.getCell('B43').value).toBe(38)
  })

  it('ensures same person with same student ID only appears once (e.g. Leader and Committee member)', async () => {
    const mockGroups: PracticeExportGroup[] = [
      {
        id: 'g1',
        name: 'Dancing A',
        committee_capacity: 1,
        faci_gm_capacity: 1,
        leaders: [
          { id: 'l1', name: 'Yang Zi Chien', student_id: 'CST210001' },
        ],
        committee_members: [
          // Same student ID as leader
          { id: 'c1', name: 'Yang Zi Chien', student_id: 'CST210001' },
        ],
        faci_gm_members: [],
      },
    ]

    const workbook = await generatePracticePerformanceWorkbook({
      orientation: 'december',
      orientationYear: 2026,
      groups: mockGroups,
    })

    const ws = workbook.getWorksheet('Performance List')!
    // Row 6: Leaders section
    expect(ws.getCell('C6').value).toBe('Leaders')
    expect(ws.getCell('D6').value).toBe('Yang Zi Chien')

    // Row 7: Committees section (since Yang Zi Chien was already in Leaders, committee slot is blank '-')
    expect(ws.getCell('C7').value).toBe('Committees')
    expect(ws.getCell('D7').value).toBe('-')
    const d7Fill = ws.getCell('D7').fill as { fgColor?: { argb?: string } }
    expect(d7Fill.fgColor?.argb).toBe('FFF4CCCC')
  })

  it('allows two different people with the same name if they have different student IDs', async () => {
    const mockGroups: PracticeExportGroup[] = [
      {
        id: 'g1',
        name: 'Dancing A',
        committee_capacity: 1,
        faci_gm_capacity: 1,
        leaders: [
          { id: 'l1', name: 'Yang Zi Chien', student_id: 'CST210001' },
        ],
        committee_members: [
          // Different student ID even though name is the same
          { id: 'c1', name: 'Yang Zi Chien', student_id: 'CST210099' },
        ],
        faci_gm_members: [],
      },
    ]

    const workbook = await generatePracticePerformanceWorkbook({
      orientation: 'december',
      orientationYear: 2026,
      groups: mockGroups,
    })

    const ws = workbook.getWorksheet('Performance List')!
    // Row 6: Leaders section
    expect(ws.getCell('C6').value).toBe('Leaders')
    expect(ws.getCell('D6').value).toBe('Yang Zi Chien')

    // Row 7: Committees section
    expect(ws.getCell('C7').value).toBe('Committees')
    expect(ws.getCell('D7').value).toBe('Yang Zi Chien')
  })
})

