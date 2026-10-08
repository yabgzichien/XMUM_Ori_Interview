import {
  buildDemoSlots,
  LIVE_SITE_URL,
  LOAD_TEST_YEAR,
} from '../load-tests/helpers.mjs'

const REQUIRED_RUNNER_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
]

export function assertNoExistingRunState(hasState) {
  if (hasState) {
    throw new Error(
      'A seeded load-test run already exists. Run `npm run loadtest:cleanup` before seeding again.',
    )
  }
}

export function createChildSignalForwarders(child) {
  return {
    onSigint: () => child.kill('SIGINT'),
    onSigterm: () => child.kill('SIGTERM'),
  }
}

export function validateRunnerEnvironment(environment) {
  for (const key of REQUIRED_RUNNER_ENV) {
    if (!environment[key]) {
      throw new Error(`Missing ${key}`)
    }
  }
}

export function buildK6Environment(environment, state) {
  const safeEnvironment = {}
  for (const key of [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
  ]) {
    if (environment[key]) safeEnvironment[key] = environment[key]
  }

  return {
    ...safeEnvironment,
    TARGET_URL: LIVE_SITE_URL,
    SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_ANON_KEY: environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    LOAD_TEST_RUN_ID: state.runId,
    LOAD_TEST_YEAR: String(LOAD_TEST_YEAR),
  }
}

export async function seedDemoRun({ database, runId }) {
  const slots = buildDemoSlots({
    runId,
    startsAt: new Date('2099-12-01T01:00:00.000Z'),
  })
  const insertedSlots = await database.insertSlots(slots)

  return {
    runId,
    slotIds: insertedSlots.map((slot) => slot.id),
  }
}

export async function cleanupDemoRun({ database, state }) {
  if (state.slotIds.length > 0) {
    await database.deleteHolds(state.slotIds)
    await database.deleteBookings(state.slotIds)
    await database.deleteSlots(state.slotIds)
  }
}

export async function runWithCleanup({ seed, execute, cleanup }) {
  const state = await seed()
  try {
    return await execute(state)
  } finally {
    await cleanup(state)
  }
}
