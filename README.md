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

Set `PRACTICE_RATE_LIMIT_SECRET` to a long random server-only value for the public
performance-practice verification rate limit. Never give it a `NEXT_PUBLIC_` prefix or
commit it. For example, this sends a generated value directly to Vercel without printing it:

```bash
openssl rand -hex 32 | vercel env add PRACTICE_RATE_LIMIT_SECRET production
```

## Role-Based Access Control

### Interview booking

| Role | Account? | Primary route | Key permissions | Scope |
|---|---|---|---|---|
| Interviewee | No account | `/book`, `/my-booking` | Book a slot; look up and cancel own booking by Student ID (to move slots: cancel, then book again) | Own booking only |
| `head_facilitator` / `head_gm` | Login required | `/head` | Manage slots, booking window, bookings, interview status/notes, cancel bookings; bulk-invite approved interviewees onto the committee | Own track only (+ own orientation/year if set) |
| `admin` | Login required | `/head`, `/admin` | Everything Heads can do, unscoped, plus invite Head/Admin accounts | Both tracks, all orientations |

### Performance practice

| Role | Account? | Primary route | Key permissions | Scope |
|---|---|---|---|---|
| Rostered committee member | No account | `/practice` | Verify student ID + matching `studentID@xmu.edu.my`, book once, and re-verify to view the assigned group and sessions | Own booking only |
| `head_facilitator` / `head_gm` | Not required for practice | `/practice` | Same account-free booking flow as any rostered committee member; their accounts still provide `/head` interview access | Own booking only |
| `admin` | Login required | `/admin/practice` | Manage the roster, import files, groups, capacities, sessions, and member assignment/movement/removal | All December 2026 practice data |

Interviewees and practice participants do **not** need accounts. Practice identity is checked
case-insensitively against the admin roster: `DSC2344112` must use
`DSC2344112@xmu.edu.my`. A participant can book once and cannot change or remove the booking;
an admin must move or remove it. HOF/HOG accounts continue to control interview management,
but do not gain practice-management access.

## Routes

- `/book` — public, no login: track tabs → pick a slot → enter details → confirmation
- `/my-booking` — public, no login: search active bookings by Student ID and cancel them if active
- `/login` — committee sign-in (Heads/Admin)
- `/register` — committee activation: a pre-invited committee member sets a password (email + invite code)
- `/head` — Committee dashboard (admin/Heads)
- `/admin` — admin-only: invite committee (name, student ID, email, role) and view invite codes/status
- `/practice` — public, no login: verify roster identity, book once, or view an existing booking
- `/admin/practice` — admin-only roster, import, group, session, and assignment management

## Performance practice operations (December 2026)

Migration `0041_account_free_practice_booking.sql` replaces the earlier account-based practice
model. Applying it intentionally resets existing practice groups, sessions, memberships, and
practice roster data to empty; interview bookings, profiles, and staff accounts are not reset.
Back up any old practice data before applying it if it must be retained.

After applying migrations:

1. Sign in as an admin and open `/admin/practice`.
2. Add roster members manually or download the XLSX template from the Import roster tab.
3. Import `.xlsx`, `.csv`, or `.json`. Every row must contain exactly the fields `name`,
   `student_id`, and `position`; position values must already exist in Committee Management.
   Validation is all-or-nothing: no row is saved until the complete file passes and the admin
   selects **Apply import**. The limit is 5 MB and 5,000 rows.
4. Create groups, set capacities/open status, add sessions, and optionally assign members.
5. Give committee members `/practice`; only group names and remaining spaces appear after
   successful identity verification.

The current release is fixed to the **December 2026** orientation intake. The roster and group
tables begin empty, and there is no performance-lead role in this workflow.

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
npm run migrate                    # apply any un-applied SQL migrations (needs SUPABASE_DB_URL)
npm run build:migrations           # regenerate supabase/all_migrations.sql from migrations/
```

`.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key # Keep secret, never expose to browser
PRACTICE_RATE_LIMIT_SECRET=generate-a-long-random-server-only-value

# Canonical site URL used to build links in outbound emails (invite
# activation, etc). Without this, links fall back to whatever Host header
# the server action happens to run behind — e.g. localhost:3000 if triggered
# from a local dev server — which is wrong for anything mailed to a real
# applicant/staffer. Set this to the deployed URL below.
SITE_URL=https://xmum-ori-interview.vercel.app

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
4. **Apply SQL Migrations** — either way works:
   - **From the dashboard (fresh database):** open **SQL Editor**, paste the whole of
     [supabase/all_migrations.sql](supabase/all_migrations.sql), and **Run**. This builds the
     tables, RLS policies, views, triggers, and RPCs.
   - **From your terminal (fresh *or* existing database):** add `SUPABASE_DB_URL` to
     `.env.local` (Project Settings → Database → Connection string → URI) and run
     `npm run migrate`. It applies only the migrations that haven't run yet, tracked in a
     `_schema_migrations` table, so it is the safe option for upgrading a live project.

   > `all_migrations.sql` is **generated** — it is every file in `supabase/migrations`
   > concatenated in order. After adding a migration, run `npm run build:migrations` to
   > rebuild it rather than editing it by hand.
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

Live at **https://xmum-ori-interview.vercel.app**.

1. Push this repo to GitHub and import it at https://vercel.com.
2. Add the env vars (same as `.env.local`, including `SITE_URL` set to the deployed URL
   above) in the Vercel project settings.
3. Deploy. For the live recruitment window with ~250 concurrent users, consider
   temporarily upgrading Supabase to Pro for that period.

## Data model (summary)

- `profiles` — user (→ auth.users), name, student_id, email, role
- `slots` — track, starts_at, ends_at, capacity, status (open/closed)
- `bookings` — slot, applicant, track, status (booked/cancelled); partial unique index =
  one active booking per applicant per track
- `track_settings` — per-track booking window + reschedule cutoff
- `committee_roster` — account-free practice eligibility: name, student ID, position, active status
- `practice_groups` / `practice_sessions` — December 2026 group capacity and schedule
- `practice_group_bookings` — one immutable self-service booking per roster member; admin-managed moves/removals

### Key RPCs

`book_slot` (locks the slot, checks window + capacity + one-per-track) ·
`cancel_booking_public` / `lookup_booking_public` (Student-ID-scoped, used by `/my-booking`) ·
`cancel_booking` / `reschedule_booking` (owner-checked, cutoff-gated — these require a
logged-in owner, so the public `/my-booking` flow does not expose reschedule) ·
`available_slots` (open future slots + seats-left, counts only) ·
`head_slots` / `head_bookings` (track-gated reads incl. applicant identity for Heads).

## Flowcharts

### Interview booking flow

```mermaid
flowchart TD
    Start(["Applicant visits site"]) --> BookPage["/book — choose track\n(Facilitator / Game Master)"]
    BookPage --> SlotList["View open slots\n(available_slots RPC)"]
    SlotList --> Fill["Fill booking form\nname, student ID, email, experience"]
    Fill --> Submit["Submit booking"]

    Submit --> Checks{"Window open?\nSlot has capacity?\nNo existing booking?"}
    Checks -- "No" --> Error["Show error\n(closed / full / duplicate)"]
    Error --> BookPage
    Checks -- "Yes" --> Save[("Booking saved")]
    Save --> Email["Confirmation email sent"]
    Email --> Confirmed(["Booking confirmed"])

    Confirmed --> Later["Applicant returns later"]
    Later --> MyBooking["/my-booking — enter\nstudent ID"]
    MyBooking --> Action{"Cancel the booking?"}
    Action -- "Yes" --> Cancel["Booking cancelled\n(seat freed)"]
    Action -- "Want a different time" --> Reschedule["Cancel, then book\na new slot on /book"]

    Confirmed -.-> HeadReview
    subgraph HEAD["Head / Admin side"]
        HeadReview["Head views bookings\non /head dashboard"]
        HeadReview --> Interview["Conducts interview"]
        Interview --> Status["Marks status:\npending → approved / failed"]
    end

    classDef applicant fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef head fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef decision fill:#f3f4f6,stroke:#6b7280,color:#111827
    classDef db fill:#dcfce7,stroke:#16a34a,color:#14532d

    class BookPage,SlotList,Fill,Submit,MyBooking,Later,Cancel,Reschedule applicant
    class HeadReview,Interview,Status head
    class Checks,Action decision
    class Save db
```

### Practice group flow

```mermaid
flowchart TD
    Admin["Admin loads roster and creates groups"] --> Groups[("Open practice groups")]
    Committee(["Committee member opens /practice"]) --> Verify["Enter student ID and matching university email"]
    Verify --> Valid{"Active roster match?"}
    Valid -- "No" --> GenericError["Show generic verification error"]
    Valid -- "Yes, no booking" --> Browse["Show group names and remaining spaces"]
    Browse --> Confirm["Choose and confirm once"]
    Confirm --> Groups
    Valid -- "Yes, booked" --> MyGroup["Show assigned group and sessions"]
    Admin --> Manage["Move/remove members and manage sessions"]
    Manage --> Groups

    classDef head fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef committee fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef decision fill:#f3f4f6,stroke:#6b7280,color:#111827
    classDef db fill:#dcfce7,stroke:#16a34a,color:#14532d

    class Admin,Manage head
    class Verify,Browse,Confirm,MyGroup committee
    class Valid decision
    class Groups db
```

## Core Features Built

- **Email notifications**: Confirmation email (sent via Nodemailer) after booking a slot,
  including the slot's venue. Sending is fire-and-forget — an SMTP failure is logged but never
  fails the booking, so check the server log if applicants report missing emails.
- **Venue on every slot**: set once per batch when creating slots (editable afterwards in the
  slots table); shown on `/book`, in the booking summary, on `/my-booking`, on the Head
  dashboard, and in the confirmation email.
- **Committee dashboard customizer**: Ability to customize and edit welcome email templates before bulk sending.
- **Interview outcome & notes**: Interactive evaluation notes field inside the candidate detail modal on `/head`.
- **Responsive design**: Supports mobile devices, tablets, and desktop computers (with collapsible forms and bottom-sheet drawers).
- **Self-service lookup & cancellation**: Public `/my-booking` route allows applicants to retrieve and cancel slots with case-insensitive student ID lookups.
