'use server'

import { createAdminClient } from '@/lib/supabase/admin'

export async function saveInterviewNotesAction(
  bookingId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const adminDb = createAdminClient()
    const { error } = await adminDb
      .from('bookings')
      .update({ interview_notes: notes || null })
      .eq('id', bookingId)

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: any) {
    return { success: false, error: err.message || String(err) }
  }
}
