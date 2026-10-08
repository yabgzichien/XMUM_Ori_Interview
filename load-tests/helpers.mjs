export const LIVE_SITE_URL = 'https://xmum-ori-interview.vercel.app'
export const LOAD_TEST_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION'
export const LOAD_TEST_ORIENTATION = 'december'
export const LOAD_TEST_YEAR = 2026
export const LOAD_TEST_VUS = 200
export const LOAD_TEST_SLOTS_PER_TRACK = 20
export const LOAD_TEST_SLOT_CAPACITY = 5

export function validateLoadTestTarget(targetUrl, acknowledgement) {
  const normalizedTarget = String(targetUrl || '').replace(/\/$/, '')
  if (normalizedTarget !== LIVE_SITE_URL) {
    throw new Error(`Load test target must be ${LIVE_SITE_URL}`)
  }
  if (acknowledgement !== LOAD_TEST_ACKNOWLEDGEMENT) {
    throw new Error(
      `Production load test acknowledgement is required: ${LOAD_TEST_ACKNOWLEDGEMENT}`,
    )
  }
}

export function buildDemoSlots({ runId, startsAt }) {
  const firstStart = new Date(startsAt)
  const slots = []

  for (const track of ['facilitator', 'game_master']) {
    for (let index = 0; index < LOAD_TEST_SLOTS_PER_TRACK; index += 1) {
      const slotStart = new Date(firstStart.getTime() + index * 30 * 60_000)
      const slotEnd = new Date(slotStart.getTime() + 30 * 60_000)
      slots.push({
        track,
        orientation: LOAD_TEST_ORIENTATION,
        orientation_year: LOAD_TEST_YEAR,
        starts_at: slotStart.toISOString(),
        ends_at: slotEnd.toISOString(),
        capacity: LOAD_TEST_SLOT_CAPACITY,
        status: 'open',
        venue: `LOADTEST:${runId}`,
      })
    }
  }

  return slots
}

export function chooseTrack(vu) {
  return (vu - 1) % 2 === 0 ? 'facilitator' : 'game_master'
}

export function chooseSlotIndex(vu, slotsPerTrack = LOAD_TEST_SLOTS_PER_TRACK) {
  return Math.floor((vu - 1) / 2) % slotsPerTrack
}

export function selectDemoSlots(slots, venueTag) {
  return slots
    .filter((slot) => slot.venue === venueTag)
    .sort((left, right) =>
      String(left.starts_at).localeCompare(String(right.starts_at)),
    )
}

export function buildApplicant(runId, vu) {
  const token = String(runId).replace(/[^a-z0-9]/gi, '').toLowerCase()
  const upperToken = token.toUpperCase()
  const sequence = String(vu).padStart(4, '0')

  return {
    name: `Load Test Applicant ${vu}`,
    studentId: `LT-${upperToken}-${sequence}`,
    email: `loadtest+${token}-${sequence}@xmu.edu.my`,
    contactNumber: `010-${String(9_000_000 + vu)}`,
  }
}
