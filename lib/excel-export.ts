import ExcelJS from 'exceljs'
import type { HeadBooking, HeadSlot, Orientation, Track } from '@/lib/head'

export type ExportExcelOptions = {
  track: Track
  orientation: Orientation
  orientationYear: number
  slots: HeadSlot[]
  bookings: HeadBooking[]
  startDate?: string | null
  endDate?: string | null
  timeZone?: string
}

const DEFAULT_TIMEZONE = 'Asia/Kuala_Lumpur'

// Default template time slots (matching 26_12 GM Interview Time Slot Export Example.xlsx)
const DEFAULT_TIME_SLOTS = [
  '6.00pm-6.15pm',
  '6.15pm-6.30pm',
  '6.30pm-6.45pm',
  '6.45pm-7.00pm',
  '7.00pm-7.15pm',
  '7.15pm-7.30pm',
  '7.30pm-7.45pm',
  '7.45pm-8.00pm',
  '8.00pm-8.15pm',
  '8.15pm-8.30pm',
  '8.30pm-8.45pm',
  '8.45pm-9.00pm',
  '9.00pm-9.15pm',
  '9.15pm-9.30pm',
  '9.30pm-9.45pm',
  '9.45pm-10.00pm',
  '10.00pm-10.15pm',
  '10.15pm-10.30pm',
  '10.30pm-10.45pm',
  '10.45pm-11.00pm',
]

/** Formats an ISO string into 'YYYY-MM-DD' in the given timezone. */
export function getLocalDateString(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(iso)
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Formats a single time part into '6.00pm' or '10.15am' in the given timezone. */
export function formatSlotTimePart(iso: string, timeZone: string = DEFAULT_TIMEZONE): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d)
  const hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00'
  const dayPeriod = parts.find((p) => p.type === 'dayPeriod')?.value?.toLowerCase() ?? ''
  return `${hour}.${minute}${dayPeriod}`
}

/** Formats a time range into e.g. '6.00pm-6.15pm'. */
export function formatSlotTimeRange(startsAt: string, endsAt: string, timeZone: string = DEFAULT_TIMEZONE): string {
  return `${formatSlotTimePart(startsAt, timeZone)}-${formatSlotTimePart(endsAt, timeZone)}`
}

/** Formats a Date into e.g. '10Sep2026 1230' in the given timezone. */
export function formatExportTimestamp(now: Date = new Date(), timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const day = parts.find((p) => p.type === 'day')?.value ?? ''
  const month = parts.find((p) => p.type === 'month')?.value ?? ''
  const year = parts.find((p) => p.type === 'year')?.value ?? ''
  let hour = parts.find((p) => p.type === 'hour')?.value ?? ''
  if (hour === '24') hour = '00'
  const minute = parts.find((p) => p.type === 'minute')?.value ?? ''

  return `${day}${month}${year} ${hour}${minute}`
}

/** Generates the export filename with date/time, e.g. '26_12 GM Interview Time Slot Export 10Sep2026 1230.xlsx'. */
export function generateExportFilename({
  track,
  orientation,
  year,
  startDate,
  endDate,
  timestampDate = new Date(),
  timeZone = DEFAULT_TIMEZONE,
}: {
  track: Track
  orientation: Orientation
  year: number
  startDate?: string | null
  endDate?: string | null
  timestampDate?: Date
  timeZone?: string
}): string {
  const trackLabel = track === 'game_master' ? 'GM' : 'Facilitator'
  const timestamp = formatExportTimestamp(timestampDate, timeZone)
  const orientationLabel = orientation.charAt(0).toUpperCase() + orientation.slice(1)

  if (startDate && endDate && startDate === endDate) {
    const parts = startDate.split('-') // ['YYYY', 'MM', 'DD']
    const datePrefix = parts.length === 3 ? `${parts[2]}_${parts[1]}` : startDate
    return `${datePrefix} ${trackLabel} Interview Time Slot Export ${timestamp}.xlsx`
  } else if (startDate && !endDate) {
    const parts = startDate.split('-')
    const datePrefix = parts.length === 3 ? `${parts[2]}_${parts[1]}` : startDate
    return `${datePrefix} ${trackLabel} Interview Time Slot Export ${timestamp}.xlsx`
  } else {
    return `${orientationLabel} ${year} ${trackLabel} Interview Time Slot Export ${timestamp}.xlsx`
  }
}

const thinBorderAll: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
}

function applyBoxBorder(
  ws: ExcelJS.Worksheet,
  startRow: number,
  startCol: number,
  endRow: number,
  endCol: number,
) {
  for (let r = startRow; r <= endRow; r++) {
    for (let c = startCol; c <= endCol; c++) {
      const cell = ws.getCell(r, c)
      const existing = cell.border || {}
      cell.border = {
        ...existing,
        top: r === startRow ? { style: 'thin', color: { argb: 'FF000000' } } : existing.top,
        bottom: r === endRow ? { style: 'thin', color: { argb: 'FF000000' } } : existing.bottom,
        left: c === startCol ? { style: 'thin', color: { argb: 'FF000000' } } : existing.left,
        right: c === endCol ? { style: 'thin', color: { argb: 'FF000000' } } : existing.right,
      }
    }
  }
}

export async function generateInterviewBookingWorkbook({
  slots,
  bookings,
  startDate,
  endDate,
  timeZone = DEFAULT_TIMEZONE,
}: ExportExcelOptions): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'XMUM Orientation Booking System'
  workbook.created = new Date()

  // Filter slots and bookings by date range if provided
  const activeBookings = bookings.filter((b) => b.interview_status !== 'failed')

  let filteredSlots = slots
  if (startDate) {
    filteredSlots = filteredSlots.filter((s) => getLocalDateString(s.starts_at, timeZone) >= startDate)
  }
  if (endDate) {
    filteredSlots = filteredSlots.filter((s) => getLocalDateString(s.starts_at, timeZone) <= endDate)
  }

  // Group slots by local calendar date (YYYY-MM-DD)
  const slotsByDate = new Map<string, HeadSlot[]>()
  for (const s of filteredSlots) {
    const d = getLocalDateString(s.starts_at, timeZone)
    const list = slotsByDate.get(d)
    if (list) list.push(s)
    else slotsByDate.set(d, [s])
  }

  // Also check if any bookings belong to dates not in filteredSlots
  for (const b of activeBookings) {
    const d = getLocalDateString(b.starts_at, timeZone)
    if (startDate && d < startDate) continue
    if (endDate && d > endDate) continue
    if (!slotsByDate.has(d)) {
      slotsByDate.set(d, [])
    }
  }

  const sortedDates = Array.from(slotsByDate.keys()).sort()

  // If no dates at all, create one default sheet
  const datesToRender = sortedDates.length > 0 ? sortedDates : ['default']

  for (const dateStr of datesToRender) {
    let sheetName = 'Sheet1'
    if (dateStr !== 'default') {
      const parts = dateStr.split('-') // ['YYYY', 'MM', 'DD']
      if (parts.length === 3) {
        sheetName = `${parts[2]}_${parts[1]}` // e.g. '26_12'
      } else {
        sheetName = dateStr
      }
    }

    // Ensure unique sheet name in workbook
    let finalSheetName = sheetName
    let counter = 1
    while (workbook.getWorksheet(finalSheetName)) {
      finalSheetName = `${sheetName}_${++counter}`
    }

    const ws = workbook.addWorksheet(finalSheetName, {
      views: [{ showGridLines: true }],
    })

    // Set Column Widths matching example
    // Table 1: B(2), C(3), D(4), E(5), F(6)
    // Spacer: G(7)
    // Table 2: H(8), I(9), J(10), K(11), L(12)
    // Spacer: M(13)
    // Table 3: N(14), O(15), P(16), Q(17), R(18)
    ws.getColumn(1).width = 8
    ws.getColumn(2).width = 21.38
    ws.getColumn(3).width = 26.38
    ws.getColumn(4).width = 17.63
    ws.getColumn(5).width = 22.5
    ws.getColumn(6).width = 12.0
    ws.getColumn(7).width = 12.0
    ws.getColumn(8).width = 21.38
    ws.getColumn(9).width = 26.38
    ws.getColumn(10).width = 17.63
    ws.getColumn(11).width = 22.5
    ws.getColumn(12).width = 12.0
    ws.getColumn(13).width = 12.0
    ws.getColumn(14).width = 21.38
    ws.getColumn(15).width = 26.38
    ws.getColumn(16).width = 17.63
    ws.getColumn(17).width = 22.5
    ws.getColumn(18).width = 12.0

    const daySlots = (dateStr !== 'default' ? slotsByDate.get(dateStr) : []) ?? []
    const dayBookings = activeBookings.filter(
      (b) => dateStr === 'default' || getLocalDateString(b.starts_at, timeZone) === dateStr,
    )

    // Determine venues for the 3 tables
    const distinctVenues = Array.from(
      new Set([
        ...daySlots.map((s) => s.venue?.trim()).filter(Boolean),
        ...dayBookings.map((b) => b.venue?.trim()).filter(Boolean),
      ]),
    ) as string[]

    const tableVenues: string[] = ['', '', '']
    if (distinctVenues.length === 1) {
      tableVenues[0] = distinctVenues[0]
      tableVenues[1] = distinctVenues[0]
      tableVenues[2] = distinctVenues[0]
    } else {
      distinctVenues.forEach((v, idx) => {
        if (idx < 3) tableVenues[idx] = v
      })
    }

    // Render Table Header Blocks (Rows 3-4)
    // For each table:
    // Table 1: B3:C4, D3:F4
    // Table 2: H3:I4, J3:L4
    // Table 3: N3:O4, P3:R4
    const tableColStarts = [2, 8, 14]

    for (let t = 0; t < 3; t++) {
      const cStart = tableColStarts[t]

      // Left block: Table name (or empty like template, but Table 1/2/3 is standard)
      ws.mergeCells(3, cStart, 4, cStart + 1)
      const leftCell = ws.getCell(3, cStart)
      leftCell.value = `Table ${t + 1}`
      leftCell.font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FF000000' } }
      leftCell.alignment = { horizontal: 'center', vertical: 'middle' }

      // Right block: Location: <Venue>
      ws.mergeCells(3, cStart + 2, 4, cStart + 4)
      const rightCell = ws.getCell(3, cStart + 2)
      rightCell.value = tableVenues[t] ? `Location: ${tableVenues[t]}` : 'Location:'
      rightCell.font = { name: 'Calibri', size: 20, bold: true, color: { argb: 'FF000000' } }
      rightCell.alignment = { horizontal: 'center', vertical: 'middle' }

      // Fill and borders for rows 3-4 in this table
      for (let r = 3; r <= 4; r++) {
        for (let col = cStart; col <= cStart + 4; col++) {
          const cell = ws.getCell(r, col)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC9DAF8' } }
        }
      }
      applyBoxBorder(ws, 3, cStart, 4, cStart + 1)
      applyBoxBorder(ws, 3, cStart + 2, 4, cStart + 4)

      // Row 5: Column headers
      const headers = ['Time Slot', 'Name', 'Student ID', 'Contact Number', 'Attendance']
      for (let hIdx = 0; hIdx < headers.length; hIdx++) {
        const cell = ws.getCell(5, cStart + hIdx)
        cell.value = headers[hIdx]
        cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } }
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = thinBorderAll
      }

      // Row 6: Green Example row
      const exampleValues = [
        'Example',
        'Soo Stanley Prince',
        'FIs2508139',
        '011-27093927',
        '1/0',
      ]
      for (let eIdx = 0; eIdx < exampleValues.length; eIdx++) {
        const cell = ws.getCell(6, cStart + eIdx)
        cell.value = exampleValues[eIdx]
        cell.alignment = { horizontal: 'center', vertical: 'middle' }
        cell.border = thinBorderAll

        if (eIdx < 4) {
          cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } }
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00FF00' } }
        } else {
          cell.font = { name: 'Arial', size: 10, bold: false, color: { argb: 'FF000000' } }
        }
      }
    }

    // Build Time Windows
    // Extract unique time intervals from daySlots
    type TimeWindow = {
      starts_at: string
      ends_at: string
      label: string
      startMs: number
    }

    const windowMap = new Map<string, TimeWindow>()
    for (const s of daySlots) {
      const label = formatSlotTimeRange(s.starts_at, s.ends_at, timeZone)
      if (!windowMap.has(label)) {
        windowMap.set(label, {
          starts_at: s.starts_at,
          ends_at: s.ends_at,
          label,
          startMs: new Date(s.starts_at).getTime(),
        })
      }
    }
    for (const b of dayBookings) {
      const label = formatSlotTimeRange(b.starts_at, b.ends_at, timeZone)
      if (!windowMap.has(label)) {
        windowMap.set(label, {
          starts_at: b.starts_at,
          ends_at: b.ends_at,
          label,
          startMs: new Date(b.starts_at).getTime(),
        })
      }
    }

    let timeWindows = Array.from(windowMap.values()).sort((a, b) => a.startMs - b.startMs)

    // If day has no slots/bookings, use default template time slots
    if (timeWindows.length === 0) {
      timeWindows = DEFAULT_TIME_SLOTS.map((label, idx) => ({
        starts_at: '',
        ends_at: '',
        label,
        startMs: idx,
      }))
    }

    // Render Data Rows (Rows 7+)
    timeWindows.forEach((tw, slotIdx) => {
      const startRow = 7 + slotIdx * 4
      const endRow = startRow + 3
      const isOdd = slotIdx % 2 === 0 // 0, 2, 4... -> 1st, 3rd, 5th slot

      const zebraFill: ExcelJS.Fill | undefined = isOdd
        ? { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } }
        : undefined

      // Gather matching bookings for this time window
      const matchingBookings = dayBookings.filter(
        (b) => formatSlotTimeRange(b.starts_at, b.ends_at, timeZone) === tw.label,
      )

      // Find slots matching this time window
      const matchingSlots = daySlots.filter(
        (s) => formatSlotTimeRange(s.starts_at, s.ends_at, timeZone) === tw.label,
      )

      // Distribute bookings across the 3 tables:
      // If slots have distinct venues:
      //   Table t gets bookings for matchingSlots[t]
      // Else:
      //   Table 0 gets first 4 bookings, Table 1 gets next 4, Table 2 gets next 4
      const tableAssignedBookings: HeadBooking[][] = [[], [], []]

      if (distinctVenues.length > 1) {
        for (const b of matchingBookings) {
          const venueIdx = distinctVenues.findIndex((v) => v === b.venue?.trim())
          if (venueIdx >= 0 && venueIdx < 3) {
            tableAssignedBookings[venueIdx].push(b)
          } else {
            tableAssignedBookings[0].push(b)
          }
        }
      } else if (matchingSlots.length > 1) {
        // Parallel slots with same/no venue
        matchingSlots.forEach((slot, sIdx) => {
          if (sIdx < 3) {
            const slotBookings = matchingBookings.filter((b) => b.slot_id === slot.id)
            tableAssignedBookings[sIdx].push(...slotBookings)
          }
        })
      } else {
        // Single slot or general bookings
        matchingBookings.forEach((b, bIdx) => {
          const targetTable = Math.min(2, Math.floor(bIdx / 4))
          tableAssignedBookings[targetTable].push(b)
        })
      }

      for (let t = 0; t < 3; t++) {
        const cStart = tableColStarts[t]

        // Merge Time Slot column across 4 rows
        ws.mergeCells(startRow, cStart, endRow, cStart)
        const timeCell = ws.getCell(startRow, cStart)
        timeCell.value = tw.label
        timeCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF000000' } }
        timeCell.alignment = { horizontal: 'center', vertical: 'middle' }
        if (zebraFill) {
          timeCell.fill = zebraFill
        }

        // Apply outer borders for merged time cell
        applyBoxBorder(ws, startRow, cStart, endRow, cStart)

        // 4 Candidate rows
        const candidates = tableAssignedBookings[t] || []
        for (let r = 0; r < 4; r++) {
          const currRow = startRow + r
          const booking = candidates[r]

          const nameCell = ws.getCell(currRow, cStart + 1)
          nameCell.value = booking?.applicant_name || ''
          nameCell.font = { name: 'Arial', size: 10, bold: false, color: { argb: 'FF000000' } }
          nameCell.alignment = { horizontal: booking?.applicant_name ? 'left' : 'center', vertical: 'middle' }
          nameCell.border = thinBorderAll
          if (zebraFill) nameCell.fill = zebraFill

          const idCell = ws.getCell(currRow, cStart + 2)
          idCell.value = booking?.student_id || ''
          idCell.font = { name: 'Arial', size: 10, bold: false, color: { argb: 'FF000000' } }
          idCell.alignment = { horizontal: 'center', vertical: 'middle' }
          idCell.border = thinBorderAll
          if (zebraFill) idCell.fill = zebraFill

          const contactCell = ws.getCell(currRow, cStart + 3)
          contactCell.value = ''
          contactCell.font = { name: 'Arial', size: 10, bold: false, color: { argb: 'FF000000' } }
          contactCell.alignment = { horizontal: 'center', vertical: 'middle' }
          contactCell.border = thinBorderAll
          if (zebraFill) contactCell.fill = zebraFill

          const attCell = ws.getCell(currRow, cStart + 4)
          attCell.value = ''
          attCell.font = { name: 'Arial', size: 10, bold: false, color: { argb: 'FF000000' } }
          attCell.alignment = { horizontal: 'center', vertical: 'middle' }
          attCell.border = thinBorderAll
          // Attendance column has no fill (always white)
        }
      }
    })
  }

  return workbook
}
