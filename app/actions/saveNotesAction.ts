'use server'

import { createAdminClient } from '@/lib/supabase/admin'
import { errorMessage } from '@/lib/utils'

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
  } catch (err: unknown) {
    return { success: false, error: errorMessage(err) }
  }
}
