# Interview Slot Booking System — Design Spec

**Date:** 2026-06-22
**Project:** XMUM Orientation — Tech Team, Task 1
**Status:** Draft for review

## 1. Goal

A web app where the **Head of Facilitators** and **Head of Game Masters** open interview
availability, and **applicants** self-book interview slots. Two independent tracks:
Facilitator and Game Master. Built as the first module of the wider Orientation platform —
its auth + database are reused by later modules.

## 2. Roles

| Role | Capability |
|---|---|
| `applicant` | Default on sign-up. Browse + book slots, manage own bookings. |
| `head_facilitator` | Manage slots/bookings for the **Facilitator** track only. |
| `head_gm` | Manage slots/bookings for the **Game Master** track only. |
| `admin` | Full access to both tracks; seeded manually; can promote Heads. |

## 3. MVP Scope

**Applicant**
- Register / log in (email + password).
- Browse available slots for a track (may apply to both tracks).
- Book a slot — transaction-safe, no double-booking; **max one active booking per track**.
- View, cancel, or reschedule own booking **until a per-track cutoff** (e.g. N hours before).

**Head (own track only)**
- Dashboard scoped to their track.
- Bulk-create slots: date + start/end time + interval + capacity → generates all slots.
- Edit / delete / close individual slots.
- View bookings per slot; search by applicant name/email.
- Open / close the booking window for their track.

## 4. Phase 2 (designed-for, not built now)

Attendance (attended/no-show), outcome (pass/reject/waitlist + notes), CSV export,
email notifications (confirmation + reminder), live stats dashboard. Data model leaves room
for these so they add without rework.

## 5. Tech Stack

- **Next.js (App Router) + TypeScript**, **Tailwind CSS + shadcn/ui**
- **Supabase**: Postgres (data), Auth (email+password, roles)
- **Booking safety:** Postgres function (RPC) using row locking + DB constraints
- **Hosting:** Vercel (app) + Supabase cloud (data); GitHub for source/CI

## 6. Data Model (core tables)

- `profiles` — user id (→ auth), name, student_id, email, role.
- `slots` — id, track (`facilitator`|`game_master`), starts_at, ends_at, capacity,
  status (`open`|`closed`), created_by.
- `bookings` — id, slot_id, applicant_id, track, status (`booked`|`cancelled`),
  created_at. Unique active booking per (applicant, track).
- `track_settings` — per-track booking window open/close + reschedule cutoff.

## 7. Key Behaviours

- **No overbooking:** booking goes through a Postgres RPC that locks the slot row,
  checks `count(active bookings) < capacity`, then inserts — all in one transaction.
- **One active booking per track:** enforced by a partial unique index.
- **Cutoff:** cancel/reschedule allowed only while `now < slot.starts_at - cutoff`.
- **Window:** booking blocked unless the track's window is open and `now` is in range.
- **Track isolation:** RLS so each Head only reads/writes their own track; admin sees all.

## 8. Non-Goals (this task)

Attendance/scoring, location tracking, other orientation modules, payments, mobile native app.

## 9. Deployment & Budget

Free tier ($0/mo) for build + normal use. Supabase Pro ($25) optional for one month if the
live recruitment window drives ~250 concurrent bookings. Deploy via GitHub → Vercel; Supabase
managed. MVP effort ≈ 6–7 working days of generated code + review.

## 10. Amendment (2026-06-23) — interviewees don't log in

Decision changed from "open self-registration" to **no-login interviewees**. An interviewee
books by entering **name, student ID, email, experiences** and picking a slot — no account.
- Bookings store these details directly; `applicant_id` is now nullable (migration `0009`).
- Duplicate guard is **one active booking per email per track** (was per account).
- Booking goes through `book_slot_public` (anon-callable, SECURITY DEFINER).
- **No interviewee self-service:** a Head/Admin cancels a booking from the dashboard
  (`head_cancel_booking`); the Head bookings view also shows `experiences`.
- Only staff (Heads/Admin) have accounts and log in. `/register` and `/my-bookings` removed.
