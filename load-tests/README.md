# Applicant booking load test

This guarded k6 test simulates exactly 200 concurrent applicants against
`https://xmum-ori-interview.vercel.app`.

Each applicant loads `/book`, chooses one of the two positions, fetches an
isolated demo slot, reserves it, enters unique demo details, and confirms the
booking. Confirmation calls the same `confirm_reservation` RPC as the app but
does not invoke the Next.js email action, so no confirmation email is sent.

The runner seeds 40 far-future slots under the live December 2026 cycle (20 per
position, capacity 5), then removes those slots and their holds/bookings after
the run. Production currently keys booking settings by track and orientation,
so a separate test year cannot be inserted. The slots are tagged with a unique
`LOADTEST:` venue and may appear at the bottom of the live applicant list only
for the few seconds that the test is running.

## Prerequisites

1. Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/).
2. Ensure `.env.local` contains `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` for the live
   project.
3. Run this only during an approved test window. Although the demo data is
   isolated, the test intentionally generates production traffic.

## Recommended one-command run

```bash
LOAD_TEST_ACKNOWLEDGEMENT=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION \
  npm run loadtest:applicants
```

This checks that k6 is installed before seeding, runs all 200 users, exports an
aggregated JSON result under `load-tests/results/`, and cleans the demo data in
a `finally` block even when thresholds fail.

## Manual lifecycle and recovery

```bash
export LOAD_TEST_ACKNOWLEDGEMENT=I_UNDERSTAND_THIS_WRITES_TO_PRODUCTION
npm run loadtest:seed
npm run loadtest:run
npm run loadtest:cleanup
```

Use the manual cleanup command if the process or machine is terminated before
automatic cleanup completes. The local `load-tests/.state.json` file contains
the exact seeded slot IDs and no credentials.

## Passing thresholds

- More than 99% successful page loads, availability requests, reservations,
  and confirmations.
- Less than 1% failed HTTP requests.
- Overall p95 below 2 seconds and p99 below 5 seconds.
- Confirmation p95 below 2 seconds.

The terminal prints the full k6 summary. The JSON result remains available for
comparison after all demo database records have been removed.
