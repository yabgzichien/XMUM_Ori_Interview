'use server'

import { createClient } from '@/lib/supabase/server'
import { sendBookingConfirmation } from '@/lib/email'
import type { PublicBookingInput, PublicBooking } from '@/lib/bookings'

export async function bookSlotAction(
  slotId: string,
  input: PublicBookingInput
): Promise<{ data: PublicBooking | null; error: string | null }> {
  const supabase = await createClient()

  const combinedExperiences = input.experiences.trim() + (input.links?.trim() ? `\n\nRelevant Links:\n${input.links.trim()}` : '')

  // 1. Write the booking to the DB using security definer RPC on the server
  const { data, error } = await supabase.rpc('book_slot_public', {
    p_slot: slotId,
    p_name: input.name,
    p_student_id: input.studentId || null,
    p_email: input.email,
    p_experiences: combinedExperiences,
  })

  if (error || !data) {
    return { data: null, error: error?.message || 'Database booking failed.' }
  }

  // 2. Booking succeeded! Fetch slot times and trigger email asynchronously
  const booking = data as PublicBooking
  
  // Query slot times + venue from DB so the confirmation email can show them
  const { data: slot } = await supabase
    .from('slots')
    .select('starts_at, ends_at, venue')
    .eq('id', booking.slot_id)
    .maybeSingle()

  const bookingDetails = {
    id: booking.id,
    applicant_name: booking.applicant_name,
    applicant_email: booking.applicant_email,
    track: booking.track,
    starts_at: slot?.starts_at || '',
    ends_at: slot?.ends_at || '',
    created_at: booking.created_at,
    venue: slot?.venue || '',
  }

  // Fire email dispatch asynchronously so we don't delay the client UI redirection
  sendBookingConfirmation(bookingDetails).then((res) => {
    if (res.success) {
      console.log(`Booking confirmation email sent to ${bookingDetails.applicant_email}. MessageId: ${res.messageId}`)
    } else {
      console.warn(`Booking confirmation email failed: ${res.error}`)
    }
  })

  return { data: booking, error: null }
}

export async function sendBulkWelcomeEmailsAction(
  bookings: { booking_id: string; applicant_name: string; applicant_email: string; track: string }[],
  customSubject?: string,
  customBody?: string
): Promise<{ successCount: number; failCount: number }> {
  const { sendWelcomeEmail } = await import('@/lib/email')
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const { getCurrentProfile } = await import('@/lib/auth')
  // Attribution only — the send itself is unchanged when there is no session.
  const profile = await getCurrentProfile()
  const adminDb = createAdminClient(profile?.id)
  
  let successCount = 0
  let failCount = 0

  for (const b of bookings) {
    try {
      const res = await sendWelcomeEmail({
        applicant_name: b.applicant_name,
        applicant_email: b.applicant_email,
        track: b.track,
        customSubject,
        customBody,
      })
      if (res.success) {
        successCount++
        
        // 1. Fetch current experiences to append status tag
        const { data: currentBooking } = await adminDb
          .from('bookings')
          .select('experiences')
          .eq('id', b.booking_id)
          .single()
        
        const currentExp = currentBooking?.experiences || ''
        const updatedExp = currentExp + (currentExp.includes('[Welcome Email Sent]') ? '' : '\n\n[Welcome Email Sent]')
        
        // 2. Persist to database
        await adminDb
          .from('bookings')
          .update({ experiences: updatedExp })
          .eq('id', b.booking_id)
      } else {
        failCount++
      }
    } catch (err) {
      console.error(`Bulk welcome email failed for ${b.applicant_email}:`, err)
      failCount++
    }
  }

  return { successCount, failCount }
}
