// Thin data-access functions over Supabase for the applicant booking UI.
// Each function constructs its own browser client at call time (never at
// module load) so this file is safe to import even when env vars are unset
// at build time.

import { createClient } from '@/lib/supabase/client'
import type { AvailableSlot } from '@/lib/booking-helpers'

export type Track = 'facilitator' | 'game_master'

export type Booking = {
  id: string
  slot_id: string
  applicant_id: string
  track: Track
  status: 'booked' | 'cancelled'
  created_at: string
}

export type BookingWithSlot = Booking & {
  slots: {
    id: string
    track: Track
    starts_at: string
    ends_at: string
    capacity: number
    status: string
    created_by: string | null
  } | null
}

export type TrackSettings = {
  track: Track
  window_open: string | null
  window_close: string | null
  reschedule_cutoff_hours: number
}

export async function getAvailableSlots(track: Track) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('available_slots', { p_track: track })
  return { data: (data as AvailableSlot[] | null) ?? null, error }
}

export async function getMyActiveBookings() {
  const supabase = createClient()
  const { data, error } = await supabase
    .from('bookings')
    .select('*, slots(*)')
    .eq('status', 'booked')
  return { data: (data as BookingWithSlot[] | null) ?? null, error }
}

export async function getTrackSettings() {
  const supabase = createClient()
  const { data, error } = await supabase.from('track_settings').select('*')
  return { data: (data as TrackSettings[] | null) ?? null, error }
}

export async function bookSlot(slotId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('book_slot', { p_slot: slotId })
  return { data: (data as Booking | null) ?? null, error }
}

export async function cancelBooking(bookingId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('cancel_booking', { p_booking: bookingId })
  return { data: (data as Booking | null) ?? null, error }
}

export async function rescheduleBooking(bookingId: string, newSlotId: string) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('reschedule_booking', {
    p_booking: bookingId,
    p_new_slot: newSlotId,
  })
  return { data: (data as Booking | null) ?? null, error }
}
