import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { parsePracticeRosterFile } from '@/lib/practice-import'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const form = await request.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose an XLSX, CSV, or JSON file.' }, { status: 400 })
  }

  const database = await createClient()
  const [{ data: positionRows, error: positionError }, { data: rosterRows, error: rosterError }] = await Promise.all([
    database.from('committee_positions').select('value'),
    database.from('committee_roster').select('student_id'),
  ])
  if (positionError || rosterError) {
    return NextResponse.json({ error: 'The roster could not be validated.' }, { status: 500 })
  }

  const positions = new Set((positionRows ?? []).map((row: { value: string }) => row.value))
  const validation = await parsePracticeRosterFile(file, positions)
  if (validation.errors.length > 0) {
    return NextResponse.json({ data: { ...validation, inserted: 0, updated: 0 } }, { status: 200 })
  }

  const existingIds = new Set((rosterRows ?? []).map((row: { student_id: string }) => row.student_id.toLowerCase()))
  const updated = validation.rows.filter((row) => existingIds.has(row.student_id.toLowerCase())).length
  return NextResponse.json({
    data: {
      ...validation,
      inserted: validation.rows.length - updated,
      updated,
    },
  })
}
