# XMUM Orientation — Interview Slot Booking

Two-sided interview booking for the **Head of Facilitators** and **Head of Game Masters**.
Heads open interview availability; applicants self-book. Two independent tracks
(Facilitator / Game Master). Built as the first module of the wider Orientation platform.

- **Spec:** [docs/superpowers/specs/2026-06-22-interview-booking-design.md](docs/superpowers/specs/2026-06-22-interview-booking-design.md)
- **Plan:** [docs/superpowers/plans/2026-06-22-interview-booking.md](docs/superpowers/plans/2026-06-22-interview-booking.md)

## Tech stack

Next.js 16 (App Router, TypeScript) · Tailwind v4 + shadcn/ui · Supabase (Postgres + Auth) ·
Vitest. Booking concurrency is enforced in Postgres via a locking RPC (`book_slot`), so a
slot can never be overbooked.

## Roles

| Who | Can |
|---|---|
| Interviewee (no account) | Browse + book a slot by entering name, student ID, email, experiences |
| `head_facilitator` / `head_gm` | Manage slots/bookings + window for their own track; cancel a booking |
| `admin` | Everything, both tracks |

Interviewees do **not** log in. Only staff (Heads/Admin) have accounts. At most one
active booking per email per track; changes/cancellations are done by a Head.

## Routes

- `/book` — public, no login: track tabs → pick a slot → enter details → confirmation + reference
- `/my-booking` — public, no login: search active bookings by Student ID and cancel them if active
- `/login` — committee sign-in (Heads/Admin)
- `/register` — committee activation: a pre-invited committee member sets a password (email + invite code)
- `/head` — Committee dashboard (admin/Heads)
- `/admin` — admin-only: invite committee (name, student ID, email, role) and view invite codes/status

## Staff onboarding

Two ways to create staff accounts:

1. **Seed** (initial admin + heads): `npm run seed` — see below.
2. **In-app invites** (admin self-service): an admin goes to `/admin`, adds a staffer
   (name, student ID, email, role) → the system generates an **invite code**. The admin
   shares the email + code with the staffer, who activates their account at `/register` by
   setting a password. The claim runs server-side (`app/api/staff/register`, service-role
   key) and assigns the invited role. Invite codes guard against anyone claiming an account
   they weren't invited to.

## Local development

```bash
npm install
cp .env.local.example .env.local   # then fill in the values below
npm run dev                        # http://localhost:3000
npm test                           # unit tests (DB tests auto-skip without env)
npm run build && npm run lint
```

`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key # Keep secret, never expose to browser

# SMTP Email Configuration (Nodemailer)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_FROM="XMUM Orientation Committee" <your-email@gmail.com>
```

## Wiring up Supabase & Setup

Follow these simple steps to hook up your own Supabase project:

1. **Create a Supabase Project**: Create a new project at [supabase.com](https://supabase.com).
2. **Setup Credentials**: Copy the URL, the `anon` key, and the `service_role` key from your Supabase Dashboard (Project Settings -> API) and paste them into your `.env.local`.
3. **Configure Email SMTP**: Set up your email transporter variables in `.env.local`. If using Gmail, generate an **App Password** in your Google Account security settings.
4. **Apply SQL Migrations**:
   - Go to your Supabase project dashboard and click on **SQL Editor**.
   - Open the [supabase/all_migrations.sql](file:///c:/Users/yang/Desktop/xmum/my-own/OriApp/supabase/all_migrations.sql) file in this repository.
   - Copy the entire file content, paste it into a new query inside the Supabase SQL Editor, and click **Run**. This will build the tables, RLS policies, views, triggers, and RPCs (including multi-orientation filters, evaluations, and Student ID lookups).
5. **Seed the Committee Accounts**:
   Run the seed script in your terminal to initialize pre-confirmed Admin and Head accounts:
   ```bash
   npm run seed
   ```
6. **Run Integration Tests**:
   Ensure everything is communicating correctly with the DB:
   ```bash
   npm test
   ```

## Deploy (Vercel)

1. Push this repo to GitHub and import it at https://vercel.com.
2. Add the three env vars (same as `.env.local`) in the Vercel project settings.
3. Deploy. For the live recruitment window with ~250 concurrent users, consider
   temporarily upgrading Supabase to Pro for that period.

## Data model (summary)

- `profiles` — user (→ auth.users), name, student_id, email, role
- `slots` — track, starts_at, ends_at, capacity, status (open/closed)
- `bookings` — slot, applicant, track, status (booked/cancelled); partial unique index =
  one active booking per applicant per track
- `track_settings` — per-track booking window + reschedule cutoff

### Key RPCs

`book_slot` (locks the slot, checks window + capacity + one-per-track) ·
`cancel_booking` / `reschedule_booking` (owner-checked, cutoff-gated) ·
`available_slots` (open future slots + seats-left, counts only) ·
`head_slots` / `head_bookings` (track-gated reads incl. applicant identity for Heads).

## Core Features Built

- **Email notifications**: Confirmation email (sent via Nodemailer) after booking a slot.
- **Committee dashboard customizer**: Ability to customize and edit welcome email templates before bulk sending.
- **Interview outcome & notes**: Interactive evaluation notes field inside the candidate detail modal on `/head`.
- **Responsive design**: Supports mobile devices, tablets, and desktop computers (with collapsible forms and bottom-sheet drawers).
- **Self-service lookup & cancellation**: Public `/my-booking` route allows applicants to retrieve and cancel slots with case-insensitive student ID lookups.
