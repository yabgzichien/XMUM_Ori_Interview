import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { isAssignableRosterPosition } from '@/lib/practice'
import { parsePracticeRosterFile } from '@/lib/practice-import'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Paste roster JSON or choose a .json/.txt file.' }, { status: 400 })
  }

  const database = await createClient()
  const { data: positionRows, error: positionError } = await database
    .from('committee_positions')
    .select('value')
  if (positionError) {
    return NextResponse.json({ error: 'The roster import could not be validated.' }, { status: 500 })
  }

  const positions = new Set(
    (positionRows ?? [])
      .map((row: { value: string }) => row.value)
      .filter((value: string) => isAssignableRosterPosition(value)),
  )
  const validation = await parsePracticeRosterFile(file, positions)
  if (validation.errors.length > 0) {
    return NextResponse.json({ data: validation, error: 'Fix every validation error before importing.' }, { status: 400 })
  }

  const { data, error } = await database.rpc('admin_apply_practice_roster', {
    p_rows: validation.rows.map(({ name, student_id, position, contact_number }) => ({ name, student_id, position, contact_number: contact_number ?? null })),
  })
  if (error) {
    return NextResponse.json({ error: 'The roster import could not be applied.' }, { status: 500 })
  }
  return NextResponse.json({ data })
}
