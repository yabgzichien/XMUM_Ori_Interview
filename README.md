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

## Role-Based Access Control

### Interview booking

| Role | Account? | Primary route | Key permissions | Scope |
|---|---|---|---|---|
| Interviewee | No account | `/book`, `/my-booking` | Book a slot; look up, cancel, or reschedule own booking by Student ID | Own booking only |
| `head_facilitator` / `head_gm` | Login required | `/head` | Manage slots, booking window, bookings, interview status/notes, cancel bookings; bulk-invite approved interviewees onto the committee | Own track only (+ own orientation/year if set) |
| `admin` | Login required | `/head`, `/admin` | Everything Heads can do, unscoped, plus invite Head/Admin accounts | Both tracks, all orientations |

### Performance practice

| Role | Account? | Primary route | Key permissions | Scope |
|---|---|---|---|---|
| `committee` | Login required | `/practice` | Join/leave a practice group; view own group's roster and sessions | Own group only |
| `performance_lead` | Login required | `/practice` | Everything `committee` can do, plus edit own group's name/capacity and create/edit/delete its practice sessions | Own group only |
| `head_facilitator` / `head_gm` | Login required | `/practice` | Same as `committee` (or `performance_lead` if they lead a group) — HOF/HOG carries no extra practice privileges; no visibility into other groups, the committee roster, or another group's members | Own group only |
| `admin` | Login required | `/head/practice` | View all groups and the committee roster; create/rename/delete groups, reassign leads, and assign committee positions (HOF/HOG etc.) | Both tracks, all orientations |

Interviewees do **not** log in — booking, lookup, and cancellation all run through public,
Student-ID-scoped functions. Only committee/staff have accounts; new staff profiles start
as a placeholder `applicant` role until a Head or Admin assigns their real role. At most one
active booking per applicant per track. Practice group governance and cross-group visibility
(view all groups, the committee roster, or any group's members; create/rename/delete a group;
reassign its lead) is admin-only. HOF/HOG grants real `/head` dashboard access for interview
booking (see above) but, for the practice-group feature specifically, is purely a cosmetic
committee position — a HOF/HOG account uses `/practice` exactly like any other committee
member.

## Routes

- `/book` — public, no login: track tabs → pick a slot → enter details → confirmation
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
    MyBooking --> Action{"Cancel or reschedule?"}
    Action -- "Cancel" --> Cancel["Booking cancelled"]
    Action -- "Reschedule" --> Reschedule["Pick a new slot\n(before cutoff)"]

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
    Head["Head/Admin creates\npractice groups"] --> SetGroup["Set name, capacity,\nassign a performance lead"]
    SetGroup --> Groups[("Practice groups\nopen for signup")]

    Committee(["Committee member logs in"]) --> Practice["/practice page"]
    Practice --> HasGroup{"Already in a group?"}

    HasGroup -- "No" --> Browse["Browse open groups\n(name, lead, seats left)"]
    Browse --> Join{"Seats available?"}
    Join -- "No" --> Full["Show as Full"]
    Join -- "Yes" --> JoinGroup["Join group"]
    JoinGroup --> Groups

    HasGroup -- "Yes" --> MyGroup["View my group:\nsessions + members"]
    MyGroup --> LeaveChoice{"Leave group?"}
    LeaveChoice -- "Yes" --> Leave["Leave group\n(seat freed up)"]
    Leave --> Browse

    MyGroup --> IsLead{"Is performance lead\nof this group?"}
    IsLead -- "Yes" --> ManageSessions["Create / edit / delete\npractice sessions\n(date, time)"]
    ManageSessions --> MyGroup

    classDef head fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef committee fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef decision fill:#f3f4f6,stroke:#6b7280,color:#111827
    classDef db fill:#dcfce7,stroke:#16a34a,color:#14532d

    class Head,SetGroup head
    class Practice,Browse,JoinGroup,MyGroup,Leave,ManageSessions committee
    class HasGroup,Join,LeaveChoice,IsLead decision
    class Groups db
```

### Full system map

```mermaid
flowchart TD
    %% ===== ENTRY =====
    Start(["Visitor loads site"]) --> Home["/ (Landing Page)"]

    Home --> IsAuth{"Logged in?"}
    IsAuth -- "No" --> PublicChoice{"What do they want?"}
    IsAuth -- "Yes: applicant" --> BookPage
    IsAuth -- "Yes: committee / performance_lead" --> Practice["/practice — Practice Group View"]
    IsAuth -- "Yes: head_facilitator / head_gm / admin" --> Head["/head — Head Dashboard"]

    PublicChoice -- "Book an interview" --> BookPage["/book — Choose Track & Slot"]
    PublicChoice -- "Check existing booking" --> MyBooking["/my-booking — Lookup by Student ID"]
    PublicChoice -- "Staff / Committee login" --> Login["/(auth)/login"]
    PublicChoice -- "Have invite code" --> Register["/(auth)/register — Self-Activation"]

    %% ===== APPLICANT BOOKING FLOW =====
    subgraph APPLICANT["Applicant Booking Flow (no login required)"]
        BookPage --> TrackTabs["TrackTabs: Facilitator / Game Master"]
        TrackTabs --> SlotList["SlotList\nRPC: available_slots(track, orientation, year)"]
        SlotList --> PickSlot["Applicant fills form:\nname, student ID, email,\nexperience, links"]
        PickSlot --> BookAction["bookSlotAction (server action)"]
        BookAction --> BookRPC["RPC: book_slot_public\n(SECURITY DEFINER)"]
        BookRPC --> Checks{"Lock slot row →\nwindow open?\ncapacity left?\nno active dup booking?"}
        Checks -- "Fail" --> BookError["Show error\n(closed / full / duplicate)"]
        BookError --> BookPage
        Checks -- "Pass" --> InsertBooking[("INSERT bookings")]
        InsertBooking --> ConfirmEmail["sendBookingConfirmation()\n(nodemailer, async)"]
        ConfirmEmail --> BookDone(["Booking confirmed"])
    end

    BookDone -.-> MyBooking

    subgraph LOOKUP["Applicant Self-Service"]
        MyBooking --> LookupForm["Enter student ID"]
        LookupForm --> LookupRPC["RPC: lookup_booking_public"]
        LookupRPC --> LookupAction{"Cancel or reschedule?"}
        LookupAction -- "Cancel" --> CancelRPC["RPC: cancel_booking\n(0004)"]
        LookupAction -- "Reschedule" --> RescheduleRPC["RPC: reschedule\n(subject to cutoff hours)"]
        CancelRPC --> LookupDone(["Updated / cancelled"])
        RescheduleRPC --> LookupDone
    end

    %% ===== AUTH FLOW =====
    subgraph AUTH["Staff / Committee Auth"]
        Login --> LoginForm["LoginForm → Supabase Auth"]
        LoginForm --> RoleRoute{"profiles.role"}
        RoleRoute -- "committee / performance_lead" --> Practice
        RoleRoute -- "head_facilitator / head_gm / admin" --> Head

        Register --> RegForm["RegisterForm\nvalidates invite code"]
        RegForm --> RegAPI["POST /api/staff/register"]
        RegAPI --> ClaimInvite[("UPDATE staff_invites\nSET claimed_at")]
        ClaimInvite --> CreateProfile["handle_new_user() trigger\ncreates profiles row"]
        CreateProfile --> RoleRoute
    end

    %% ===== MIDDLEWARE =====
    Head -.->|"middleware.ts:\nprotected route,\nno session → /login?next=..."| Login
    Practice -.->|"middleware.ts:\nprotected route"| Login

    %% ===== HEAD DASHBOARD =====
    subgraph HEADFLOW["/head — Head/Admin Dashboard"]
        Head --> HeadRoleCheck{"role check"}
        HeadRoleCheck -- "applicant" --> BookPage
        HeadRoleCheck -- "committee/performance_lead" --> Practice
        HeadRoleCheck -- "head_facilitator/head_gm/admin" --> HeadTabs["SlotsTable / BookingsTable /\nBulkCreateForm / WindowForm"]

        HeadTabs --> ManageSlots["Create/bulk-create slots\n(blocked if past or has bookings)"]
        HeadTabs --> ManageWindow["Set booking window\n(track_settings)"]
        HeadTabs --> ManageBookings["View bookings\nRPC: head_bookings"]
        ManageBookings --> UpdateStatus["RPC: head_update_interview_status\n(pending/failed/approved)"]
        ManageBookings --> SaveNotes["saveNotesAction →\ninterview_notes"]
        ManageBookings --> HeadCancel["RPC: head_cancel_booking"]

        Head -.->|"admin only"| HeadPractice["/head/practice —\nHeadPracticeDashboard (admin only)"]
        HeadPractice --> ManageGroups["RPC: head_create_practice_group /\nupdate / delete /\nhead_reassign_practice_lead"]
    end

    %% ===== ADMIN =====
    subgraph ADMINFLOW["/admin — Admin Only"]
        Head -.->|"admin role"| AdminPage["/admin — AdminStaff"]
        AdminPage --> CreateInvite["Create staff invite\n(email, role, track,\norientation, year)"]
        CreateInvite --> InsertInvite[("INSERT staff_invites\n+ generate code")]
        InsertInvite --> InviteEmail["inviteAction /\ninviteCommitteeAction\nsends email with code"]
        InviteEmail --> Register
    end

    %% ===== PRACTICE GROUPS =====
    subgraph PRACTICEFLOW["/practice — Committee / Performance Lead / HOF / HOG"]
        Practice --> PracticeRoleCheck{"role check"}
        PracticeRoleCheck -- "admin" --> HeadPractice
        PracticeRoleCheck -- "committee / performance_lead /\nhead_facilitator / head_gm" --> PracticeClient["PracticeClient"]

        PracticeClient --> ViewGroups["RPC: available_practice_groups\n(scoped by auth_committee_scope)"]
        ViewGroups --> JoinGroup["RPC: join_practice_group /\nleave_practice_group"]

        PracticeClient --> LeadCheck{"is performance_lead\nof a group?"}
        LeadCheck -- "Yes" --> ManageSessions["RPC: lead_create_session /\nupdate_session / delete_session"]
    end

    %% ===== DATABASE LAYER =====
    subgraph DB["Supabase Postgres (RLS-protected)"]
        TblProfiles[("profiles\nrole, track, orientation,\norientation_year")]
        TblSlots[("slots\ntrack, orientation, year,\ncapacity, status")]
        TblBookings[("bookings\napplicant info, status,\ninterview_status")]
        TblSettings[("track_settings\nwindow_open/close,\nreschedule_cutoff")]
        TblInvites[("staff_invites\ncode, claimed_at")]
        TblGroups[("practice_groups /\npractice_group_members /\npractice_sessions")]
        TblNotes[("interview_notes")]
    end

    InsertBooking --> TblBookings
    BookRPC -.-> TblSlots
    ManageSlots --> TblSlots
    ManageWindow --> TblSettings
    UpdateStatus --> TblBookings
    SaveNotes --> TblNotes
    InsertInvite --> TblInvites
    ClaimInvite --> TblInvites
    CreateProfile --> TblProfiles
    ManageGroups --> TblGroups
    JoinGroup --> TblGroups
    ManageSessions --> TblGroups
    ViewGroups -.-> TblGroups

    %% ===== STYLES =====
    classDef publicPage fill:#dbeafe,stroke:#2563eb,color:#1e3a8a
    classDef staffPage fill:#fef3c7,stroke:#d97706,color:#78350f
    classDef adminPage fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    classDef dbNode fill:#dcfce7,stroke:#16a34a,color:#14532d
    classDef decision fill:#f3f4f6,stroke:#6b7280,color:#111827

    class Home,BookPage,MyBooking,Login,Register publicPage
    class Head,HeadPractice,Practice,PracticeClient staffPage
    class AdminPage adminPage
    class TblProfiles,TblSlots,TblBookings,TblSettings,TblInvites,TblGroups,TblNotes dbNode
    class IsAuth,PublicChoice,Checks,LookupAction,RoleRoute,HeadRoleCheck,PracticeRoleCheck,LeadCheck decision
```

## Core Features Built

- **Email notifications**: Confirmation email (sent via Nodemailer) after booking a slot.
- **Committee dashboard customizer**: Ability to customize and edit welcome email templates before bulk sending.
- **Interview outcome & notes**: Interactive evaluation notes field inside the candidate detail modal on `/head`.
- **Responsive design**: Supports mobile devices, tablets, and desktop computers (with collapsible forms and bottom-sheet drawers).
- **Self-service lookup & cancellation**: Public `/my-booking` route allows applicants to retrieve and cancel slots with case-insensitive student ID lookups.
