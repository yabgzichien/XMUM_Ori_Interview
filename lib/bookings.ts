// Thin data-access functions for the public (no-login) interviewee booking UI.
// Each function constructs its own browser client at call time (never at module
// load) so this file is safe to import even when env vars are unset at build
// time. The browser client uses the anon key, so these work without a session.

import { createClient } from '@/lib/supabase/client'
import type { AvailableSlot } from '@/lib/booking-helpers'

export type Track = 'facilitator' | 'game_master'
export type Orientation = 'february' | 'april' | 'december'

export type PublicBookingInput = {
  name: string
  studentId: string
  email: string
  experiences: string
  links?: string
}

export type PublicBooking = {
  id: string
  slot_id: string
  track: Track
  status: 'booked' | 'cancelled'
  applicant_name: string
  applicant_email: string
  student_id: string | null
  experiences: string | null
  created_at: string
}

export async function getAvailableSlots(track: Track, orientation: Orientation) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('available_slots', { p_track: track, p_orientation: orientation })
  return { data: (data as AvailableSlot[] | null) ?? null, error }
}

export async function bookSlotPublic(slotId: string, input: PublicBookingInput) {
  const supabase = createClient()
  const { data, error } = await supabase.rpc('book_slot_public', {
    p_slot: slotId,
    p_name: input.name,
    p_student_id: input.studentId,
    p_email: input.email,
    p_experiences: input.experiences,
  })
  return { data: (data as PublicBooking | null) ?? null, error }
}
