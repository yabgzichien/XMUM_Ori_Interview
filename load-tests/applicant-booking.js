/* global __ENV, __VU */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Rate } from 'k6/metrics'

import {
  LOAD_TEST_ORIENTATION,
  LOAD_TEST_SLOTS_PER_TRACK,
  LOAD_TEST_VUS,
  buildApplicant,
  chooseSlotIndex,
  chooseTrack,
  selectDemoSlots,
} from './helpers.mjs'

const targetUrl = String(__ENV.TARGET_URL || '').replace(/\/$/, '')
const supabaseUrl = String(__ENV.SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = __ENV.SUPABASE_ANON_KEY
const runId = __ENV.LOAD_TEST_RUN_ID
const testYear = Number(__ENV.LOAD_TEST_YEAR)
const venueTag = `LOADTEST:${runId}`

if (!targetUrl || !supabaseUrl || !anonKey || !runId || !testYear) {
  throw new Error(
    'Missing TARGET_URL, SUPABASE_URL, SUPABASE_ANON_KEY, LOAD_TEST_RUN_ID, or LOAD_TEST_YEAR',
  )
}

const pageLoaded = new Rate('page_loaded')
const availabilityLoaded = new Rate('availability_loaded')
const reservationSucceeded = new Rate('reservation_succeeded')
const bookingSucceeded = new Rate('booking_succeeded')

export const options = {
  scenarios: {
    applicants: {
      executor: 'per-vu-iterations',
      vus: LOAD_TEST_VUS,
      iterations: 1,
      maxDuration: '3m',
    },
  },
  thresholds: {
    page_loaded: ['rate>0.99'],
    availability_loaded: ['rate>0.99'],
    reservation_succeeded: ['rate>0.99'],
    booking_succeeded: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<2000', 'p(99)<5000'],
    'http_req_duration{step:confirm}': ['p(95)<2000'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
}

const rpcHeaders = {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
  'Content-Type': 'application/json',
  Prefer: 'return=representation',
}

function rpc(name, payload, step) {
  return http.post(
    `${supabaseUrl}/rest/v1/rpc/${name}`,
    JSON.stringify(payload),
    {
      headers: rpcHeaders,
      tags: { name: `rpc:${name}`, step },
      timeout: '30s',
    },
  )
}

function responseJson(response) {
  try {
    return response.json()
  } catch {
    return null
  }
}

function firstRecord(value) {
  return Array.isArray(value) ? value[0] : value
}

export default function applicantBookingFlow() {
  const track = chooseTrack(__VU)
  const applicant = buildApplicant(runId, __VU)

  const pageResponse = http.get(
    `${targetUrl}/book?orientation=${LOAD_TEST_ORIENTATION}&track=${track}`,
    {
      tags: { name: 'booking-page', step: 'page' },
      timeout: '30s',
    },
  )
  const pageOk = check(pageResponse, {
    'booking page returned 200': (response) => response.status === 200,
    'booking page rendered applicant flow': (response) =>
      response.body.includes('Select Your Desired Position'),
  })
  pageLoaded.add(pageOk)
  if (!pageOk) {
    availabilityLoaded.add(false)
    reservationSucceeded.add(false)
    bookingSucceeded.add(false)
    return
  }

  sleep(0.5 + Math.random())

  const availabilityResponse = rpc(
    'available_slots',
    {
      p_track: track,
      p_orientation: LOAD_TEST_ORIENTATION,
      p_year: testYear,
    },
    'availability',
  )
  const availableSlots = responseJson(availabilityResponse)
  const demoSlots = Array.isArray(availableSlots)
    ? selectDemoSlots(availableSlots, venueTag)
    : []
  const availabilityOk = check(availabilityResponse, {
    'availability returned 200': (response) => response.status === 200,
    'demo slots were available': () => demoSlots.length === LOAD_TEST_SLOTS_PER_TRACK,
  })
  availabilityLoaded.add(availabilityOk)
  if (!availabilityOk) {
    reservationSucceeded.add(false)
    bookingSucceeded.add(false)
    return
  }

  const selectedSlot = demoSlots[chooseSlotIndex(__VU, demoSlots.length)]
  const reservationResponse = rpc(
    'reserve_slot',
    { p_slot: selectedSlot.id, p_prev_token: null },
    'reserve',
  )
  const reservation = firstRecord(responseJson(reservationResponse))
  const reservationOk = check(reservationResponse, {
    'reservation returned 200': (response) => response.status === 200,
    'reservation returned a hold token': () => Boolean(reservation?.token),
  })
  reservationSucceeded.add(reservationOk)
  if (!reservationOk) {
    bookingSucceeded.add(false)
    return
  }

  sleep(1 + Math.random() * 2)

  const confirmationResponse = rpc(
    'confirm_reservation',
    {
      p_token: reservation.token,
      p_name: applicant.name,
      p_student_id: applicant.studentId,
      p_email: applicant.email,
      p_experiences: applicant.contactNumber,
    },
    'confirm',
  )
  const booking = firstRecord(responseJson(confirmationResponse))
  const bookingOk = check(confirmationResponse, {
    'confirmation returned 200': (response) => response.status === 200,
    'confirmation returned a booked record': () =>
      Boolean(booking?.id) && booking?.status === 'booked',
    'confirmation kept the selected slot': () => booking?.slot_id === selectedSlot.id,
    'confirmation kept applicant identity': () =>
      booking?.student_id === applicant.studentId &&
      booking?.applicant_email === applicant.email,
  })
  bookingSucceeded.add(bookingOk)
}
