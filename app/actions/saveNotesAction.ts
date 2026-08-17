'use server'

import { createClient } from '@/lib/supabase/server'
import { errorMessage } from '@/lib/utils'

// Notes are written through head_update_interview_notes (0029), not the
// service-role client: the RPC enforces "own track or admin" — the check this
// action previously had no version of — and, because it runs under the caller's
// session, the activity log attributes the edit to the person who made it.
export async function saveInterviewNotesAction(
  bookingId: string,
  notes: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('head_update_interview_notes', {
      p_booking: bookingId,
      p_notes: notes,
    })

    if (error) {
      return { success: false, error: error.message }
    }
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: errorMessage(err) }
  }
}
