# Orientation Backend Design

## Overview

Add support for multiple orientations (February, April, December) to the interview booking system. Each orientation has its own independent set of slots, bookings, and track settings.

## Database Changes

### 1. New Enum Type

```sql
create type orientation as enum ('february', 'april', 'december');
```

### 2. Add Orientation Column

Add `orientation orientation not null default 'february'` to:
- `slots` table
- `bookings` table
- `track_settings` table

### 3. Update Track Settings Primary Key

- Drop current primary key on `track_settings`
- Create composite primary key: `(track, orientation)`
- Insert default rows for each track+orientation combination (6 rows total)

### 4. Update Unique Constraint on Bookings

- Drop: `one_active_booking_per_email_track`
- Create: `one_active_booking_per_email_track_orientation` on `(lower(applicant_email), track, orientation) where status = 'booked'`

### 5. Update Indexes

- Update `slots_track_starts_at_idx` to include orientation: `(track, orientation, starts_at)`

## RPC Changes

### Updated Functions

1. **`available_slots(p_track track, p_orientation orientation)`**
   - Add `p_orientation` parameter
   - Filter slots by orientation

2. **`head_slots(p_track track, p_orientation orientation)`**
   - Add `p_orientation` parameter
   - Filter slots by orientation

3. **`head_bookings(p_track track, p_orientation orientation)`**
   - Add `p_orientation` parameter
   - Filter bookings by orientation

4. **`book_slot_public`** - No signature change needed
   - Auto-detects orientation from the slot being booked
   - Sets orientation on the booking automatically

### Unchanged Functions

- `head_cancel_booking(p_booking uuid)` - No change needed
- `head_update_interview_status` - No change needed
- `head_update_interview_notes` - No change needed

## Frontend Changes

### Data Layer (`lib/bookings.ts`, `lib/head.ts`)

- Add `Orientation` type: `'february' | 'april' | 'december'`
- Update function signatures to accept orientation parameter
- Pass orientation to Supabase RPC calls

### Booking Page (`app/book/BookClient.tsx`)

- Pass selected orientation to `getAvailableSlots(track, orientation)`
- Orientation is already stored in state from previous frontend work

### Head Dashboard (`app/head/HeadDashboard.tsx`, `app/head/page.tsx`)

- Pass selected orientation to `getHeadSlots` and `getHeadBookings`
- Update dashboard title to "{Month} Orientation Dashboard"
- Orientation is already in URL params from previous frontend work

### Admin Page (`app/admin/`)

- No changes needed (staff management is orientation-independent)

## Migration Strategy

1. Create new migration file: `0014_orientation.sql`
2. Apply migration to database
3. Update TypeScript types and functions
4. Update frontend to pass orientation parameter

## Data Flow

```
User selects orientation (frontend state/URL)
    ↓
Frontend calls lib functions with orientation parameter
    ↓
lib functions call Supabase RPCs with p_orientation
    ↓
RPCs filter data by orientation
    ↓
Results returned to frontend
```

## Testing

- Verify each orientation shows its own slots/bookings
- Verify booking works correctly with orientation
- Verify track settings are per orientation
- Verify unique constraint works per orientation
