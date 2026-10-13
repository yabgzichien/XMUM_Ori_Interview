# Deployment notes

Read this before pushing to `main`, running migrations, or switching features.
`main` deploys to production on Vercel (https://xmum-ori-interview.vercel.app).

## Current state (since 2026-10-14)

`main` runs the **Action Team interview booking**. Performance Practice is
switched off, not deleted. It lives on its own branch until the Action Team
round ends.

Two features take turns on `main` because they run at different times of the
orientation cycle. Only one is live at a time.

| Branch | What it holds |
|---|---|
| `main` | Live site. Currently Action Team interviews (`b745f62`). |
| `feat/action-team` | Action Team work. Same tree as `main` right now. |
| `performance-practice-main` | Performance Practice as it was on `main` before the switch (`8879b81`). |
| `main-2026-09-30` | `main` after PR #2 (interview deadline auto-close), Facilitator / Game Master interviews. |
| `main-2026-09-29` | `main` before PR #2. |

## How the switch was made

`main` was not force-pushed. On `feat/action-team` we ran
`git merge -s ours origin/main`, which records main's history as merged but
keeps the Action Team files, then fast-forwarded `main` to it. All of main's
earlier commits are still in its history.

Side effect: Git considers `performance-practice-main` already merged into
`main`. A plain `git merge performance-practice-main` will say "Already up to
date" and change nothing. Use the steps below instead.

## Switching main back to Performance Practice

1. Make sure the Action Team round is finished and admins have closed the
   booking link (Head dashboard, "Action Team booking link" panel).
2. Swap the code with the same `-s ours` trick, in the other direction:
   ```bash
   git fetch origin
   git switch performance-practice-main
   git pull
   git merge -s ours origin/main -m "Switch main back to Performance Practice"
   git push origin performance-practice-main:main
   ```
   This is a fast-forward, so no force push is needed.
3. Copy this `CLAUDE.md` onto `main` again and update the "Current state"
   section. The merge above keeps Performance Practice's files, which do not
   include this file.
4. Check the database before running migrations (see below).

Use the same steps with the branch names swapped to bring Action Team back
later.

## Database

Both features share one Supabase database (the one in `.env.local`). Code
switches; the database does not. Every migration is shared state.

- `npm run migrate` applies files missing from `_schema_migrations`, from the
  branch you are on. It skips files that branch does not have.
- Applied as of 2026-10-14: `0001`–`0049` and `0055`–`0057`.
- **Not applied: `0050`–`0054`.** They exist only on `performance-practice-main`
  (practice group holds, roster contact number, group leaders, group songs).
  Before switching back, check whether production already has those objects,
  for example if they were pasted into the SQL editor without being recorded.
  Then run `npm run migrate` from `performance-practice-main`.
- `0055` added `action_team` to the `track` enum. Enum values cannot be
  removed. Performance Practice code ignores it, so it is harmless.
- Live `track_settings` still has the older primary key `(track, orientation)`,
  not `(track, orientation, orientation_year)`. The PK change in `0020` failed
  silently. Do not write `ON CONFLICT (track, orientation, orientation_year)`
  against this table; `0057` shows the update-then-insert pattern that works.
- When pasting `supabase/all_migrations.sql` into the SQL editor, run it up to
  and including `0055` first, then the rest. Postgres cannot use a new enum
  value in the same transaction that added it.

## Action Team operations

- The public booking link opens and closes from the "Action Team booking link"
  panel on `/head` (admins only). It is backed by
  `track_settings.window_open` / `window_close`, and `reserve_slot` /
  `confirm_reservation` refuse bookings outside that window.
- New orientation rows start closed. Create slots with Bulk Create before
  opening the link, or applicants see "No interview slots".
- The Booked Applicants table shows all tracks, so old Facilitator / Game
  Master records stay visible. Admins can select records and delete them
  permanently. Deletes cannot be undone.
