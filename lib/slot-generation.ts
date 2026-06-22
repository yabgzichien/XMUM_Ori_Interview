// Pure, dependency-free slot-generation logic for the Head bulk-create form.
// No Supabase imports here so this can be unit-tested in isolation.

export type SlotTime = { starts_at: string; ends_at: string }

type GenerateSlotTimesInput = {
  date: string // 'YYYY-MM-DD' (local)
  startTime: string // 'HH:MM' 24h
  endTime: string // 'HH:MM' 24h
  intervalMinutes: number
}

function parseTime(value: string): { hours: number; minutes: number } {
  const [hours, minutes] = value.split(':').map(Number)
  return { hours, minutes }
}

/**
 * Generates consecutive local slot times of `intervalMinutes` length,
 * starting at `date`+`startTime`, where each slot's end is `<= endTime`.
 * Returns ISO strings built from local date/time components.
 */
export function generateSlotTimes(input: GenerateSlotTimesInput): SlotTime[] {
  const { date, startTime, endTime, intervalMinutes } = input

  if (intervalMinutes <= 0) {
    throw new Error('intervalMinutes must be greater than 0')
  }
  if (!(endTime > startTime)) {
    throw new Error('endTime must be after startTime')
  }

  const [year, month, day] = date.split('-').map(Number)
  const start = parseTime(startTime)
  const end = parseTime(endTime)

  const rangeStart = new Date(year, month - 1, day, start.hours, start.minutes)
  const rangeEnd = new Date(year, month - 1, day, end.hours, end.minutes)

  const slots: SlotTime[] = []
  let slotStart = rangeStart

  while (true) {
    const slotEnd = new Date(slotStart.getTime() + intervalMinutes * 60_000)
    if (slotEnd.getTime() > rangeEnd.getTime()) break
    slots.push({ starts_at: slotStart.toISOString(), ends_at: slotEnd.toISOString() })
    slotStart = slotEnd
  }

  return slots
}
