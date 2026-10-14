/* global __ENV, __VU */

// Performance-practice booking load test: N roster members hit the booking
// page at the same moment booking opens and walk the exact client flow in
// app/practice/PracticeClient.tsx:
//
//   GET /practice → POST verify (ID dialog) → POST verify (fresh seats on
//   "Choose") → POST reserve (60s hold) → POST book (re-typed ID)
//
// A 409 (group full / hold lost) sends the user back to pick another group,
// and a 429 (per-IP rate limit) makes them click again after a pause, the
// same as a real student would.

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Rate, Trend } from 'k6/metrics'

const targetUrl = String(__ENV.TARGET_URL || '').replace(/\/$/, '')
const bypass = __ENV.VERCEL_AUTOMATION_BYPASS_SECRET || ''
const users = JSON.parse(__ENV.PRACTICE_USERS || '[]')
const groupIds = JSON.parse(__ENV.PRACTICE_GROUP_IDS || '[]')
const vus = users.length
const startJitterSeconds = Number(__ENV.START_JITTER_SECONDS || 2)
const thinkScale = Number(__ENV.THINK_SCALE || 1)

if (!targetUrl || vus === 0 || groupIds.length === 0) {
  throw new Error('Missing TARGET_URL, PRACTICE_USERS, or PRACTICE_GROUP_IDS')
}

const booked = new Rate('practice_booked')
const rateLimited = new Counter('practice_rate_limited_429')
const conflicts = new Counter('practice_conflicts_409')
const serverErrors = new Counter('practice_server_errors_5xx')
const timeToBook = new Trend('practice_time_to_book', true)

export const options = {
  scenarios: {
    booking_opens: {
      executor: 'per-vu-iterations',
      vus,
      iterations: 1,
      maxDuration: '4m',
    },
  },
  thresholds: {
    practice_booked: ['rate>0.99'],
    practice_server_errors_5xx: ['count==0'],
    'http_req_duration{step:verify}': ['p(95)<2000'],
    'http_req_duration{step:reserve}': ['p(95)<2000'],
    'http_req_duration{step:book}': ['p(95)<2000'],
    'http_req_duration{step:page}': ['p(95)<3000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const headers = {
  'Content-Type': 'application/json',
  ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}),
}

function think(min, max) {
  sleep((min + Math.random() * (max - min)) * thinkScale)
}

function post(path, body, step) {
  const response = http.post(`${targetUrl}${path}`, JSON.stringify(body), {
    headers,
    tags: { step, name: path },
    timeout: '30s',
    responseCallback: http.expectedStatuses(200, 409, 429),
  })
  if (response.status === 429) rateLimited.add(1, { step })
  if (response.status === 409) conflicts.add(1, { step })
  if (response.status >= 500 || response.status === 0) serverErrors.add(1, { step })
  return response
}

function json(response) {
  try {
    return response.json()
  } catch {
    return null
  }
}

// Keep clicking through 429s like an impatient student, up to a limit.
function postWithRetry(path, body, step, attempts = 8) {
  let response
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = post(path, body, step)
    if (response.status !== 429) return response
    think(1, 3)
  }
  return response
}

// Half the room piles onto the first three groups; the rest spread out.
function preferredGroup(available) {
  const hot = available.filter((group) => groupIds.slice(0, 3).includes(group.id))
  const pool = hot.length > 0 && Math.random() < 0.5 ? hot : available
  return pool[Math.floor(Math.random() * pool.length)]
}

function openTestGroups(lookup) {
  const groups = lookup?.data?.groups || []
  return groups.filter((group) => groupIds.includes(group.id) && group.status === 'open' && group.seats_left > 0)
}

export default function bookPracticeGroup() {
  const user = users[__VU - 1]
  sleep(Math.random() * startJitterSeconds)
  const startedAt = Date.now()

  const page = http.get(`${targetUrl}/practice`, {
    headers: bypass ? { 'x-vercel-protection-bypass': bypass } : {},
    tags: { step: 'page', name: '/practice' },
    redirects: 0,
  })
  check(page, { 'page 200': (response) => response.status === 200 })
  if (page.status >= 500) serverErrors.add(1, { step: 'page' })

  think(2, 5) // typing the student ID
  const verified = postWithRetry('/api/practice/verify', { studentId: user.studentId }, 'verify')
  if (!check(verified, { 'verify 200': (response) => response.status === 200 })) {
    booked.add(false)
    return
  }
  think(1, 2) // "Is this you?" → Yes

  for (let attempt = 0; attempt < 6; attempt += 1) {
    think(1, 4) // browsing group cards

    const fresh = postWithRetry('/api/practice/verify', { studentId: user.studentId }, 'verify')
    const lookup = json(fresh)
    if (lookup?.data?.state === 'booked') {
      // An earlier book call landed even though its response did not.
      booked.add(true)
      timeToBook.add(Date.now() - startedAt)
      return
    }
    const available = openTestGroups(lookup)
    if (fresh.status !== 200 || available.length === 0) continue

    const group = preferredGroup(available)
    const reserved = postWithRetry('/api/practice/reserve', { studentId: user.studentId, groupId: group.id }, 'reserve')
    if (reserved.status !== 200) continue
    const hold = json(reserved)?.data

    think(3, 8) // re-typing the student ID on the confirm step
    const confirmed = postWithRetry(
      '/api/practice/book',
      { studentId: user.studentId, groupId: group.id, holdToken: hold?.token },
      'book',
    )
    if (confirmed.status === 200) {
      booked.add(true)
      timeToBook.add(Date.now() - startedAt)
      return
    }
  }
  booked.add(false)
}
