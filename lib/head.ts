// Thin data-access functions over Supabase for the Head dashboard. Each
// function constructs its own browser client at call time (never at module
// load) so this file is safe to import even when env vars are unset at
// build time.

import { createClient } from '@/lib/supabase/client'

export type Track = 'facilitator' | 'game_master'
export type Orientation = 'february' | 'april' | 'december'

export type HeadSlot = {
  id: string
  track: Track
  orientation: Orientation
  orientation_year?: number
  starts_at: string
  ends_at: string
  capacity: number
  status: 'open' | 'closed'
  booked_count: number
  venue?: string
}

export type HeadBooking = {
  booking_id: string
  slot_id: string
  track: Track
  orientation: Orientation
  orientation_year?: number
  starts_at: string
  ends_at: string
  applicant_name: string
  applicant_email: string
  student_id: string | null
  experiences: string | null
  interview_notes: string | null
  created_at: string
  interview_status: 'pending' | 'failed' | 'approved'
  venue?: string
}

export type TrackSettings = {
  track: Track
  orientation: Orientation
  orientation_year?: number
  window_open: string | null
  window_close: string | null
  reschedule_cutoff_hours: number
}

export type NewSlotRow = {
  track: Track
  orientation: Orientation
  orientation_year?: number
  starts_at: string
  ends_at: string
  capacity: number
  status: 'open'
  created_by: string
  venue?: string
}

export async function getHeadSlots(track: Track, orientation: Orientation, orientationYear: number = 2026) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_slots', { p_track: track, p_orientation: orientation, p_year: orientationYear })
  return { data: (data as HeadSlot[] | null) ?? null, error }
}

export async function getHeadBookings(track: Track, orientation: Orientation, orientationYear: number = 2026) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_bookings', { p_track: track, p_orientation: orientation, p_year: orientationYear })
  return { data: (data as HeadBooking[] | null) ?? null, error }
}

export async function cancelBooking(bookingId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_cancel_booking', { p_booking: bookingId })
  return { data, error }
}

export async function getTrackSettings(track: Track, orientation: Orientation, orientationYear: number = 2026) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('track_settings')
    .select('*')
    .eq('track', track)
    .eq('orientation', orientation)
    .eq('orientation_year', orientationYear)
    .single()
  return { data: (data as TrackSettings | null) ?? null, error }
}

export async function createSlots(rows: NewSlotRow[]) {
  const supabase = createClient()
  const { data, error } = await supabase.from('slots').insert(rows)
  return { data, error }
}

export async function updateSlot(
  id: string,
  patch: Partial<Pick<HeadSlot, 'capacity' | 'status' | 'venue'>>,
) {
  const supabase = createClient()
  const { data, error } = await supabase.from('slots').update(patch).eq('id', id)
  return { data, error }
}

export async function deleteSlot(id: string) {
  const supabase = createClient()
  const { data, error } = await supabase.from('slots').delete().eq('id', id)
  return { data, error }
}

export async function updateTrackWindow(
  track: Track,
  orientation: Orientation,
  windowOpen: string | null,
  windowClose: string | null,
  orientationYear: number = 2026,
) {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('track_settings')
    .update({ window_open: windowOpen, window_close: windowClose })
    .eq('track', track)
    .eq('orientation', orientation)
    .eq('orientation_year', orientationYear)
  return { data, error }
}

export async function updateInterviewStatus(
  bookingId: string,
  status: 'pending' | 'failed' | 'approved',
) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('head_update_interview_status', {
    p_booking: bookingId,
    p_status: status,
  })
  return { data, error }
}

