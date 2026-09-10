import { NextRequest, NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { HeadBooking, HeadSlot, Orientation, Track } from '@/lib/head'
import { generateInterviewBookingWorkbook } from '@/lib/excel-export'

function isTrack(val: string | null): val is Track {
  return val === 'facilitator' || val === 'game_master'
}

function isOrientation(val: string | null): val is Orientation {
  return val === 'february' || val === 'april' || val === 'december'
}

export async function GET(request: NextRequest) {
  const profile = await getCurrentProfile()
  if (!profile) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const trackParam = searchParams.get('track')
  const orientationParam = searchParams.get('orientation')
  const yearParam = searchParams.get('year')
  const startDate = searchParams.get('startDate') || undefined
  const endDate = searchParams.get('endDate') || undefined

  if (!isTrack(trackParam)) {
    return NextResponse.json({ error: 'Invalid or missing track parameter.' }, { status: 400 })
  }
  if (!isOrientation(orientationParam)) {
    return NextResponse.json({ error: 'Invalid or missing orientation parameter.' }, { status: 400 })
  }

  const track: Track = trackParam
  const orientation: Orientation = orientationParam
  const year = yearParam ? parseInt(yearParam, 10) || 2026 : 2026

  // Authorization check
  const authorized =
    profile.role === 'admin' ||
    (profile.role === 'head_facilitator' && track === 'facilitator') ||
    (profile.role === 'head_gm' && track === 'game_master')

  if (!authorized) {
    return NextResponse.json({ error: 'Not authorized for this track.' }, { status: 403 })
  }

  if (profile.role !== 'admin' && profile.orientation && profile.orientation !== orientation) {
    return NextResponse.json({ error: 'Not authorized for this orientation.' }, { status: 403 })
  }

  const supabase = await createClient()
  const [slotsRes, bookingsRes] = await Promise.all([
    supabase.rpc('head_slots', { p_track: track, p_orientation: orientation, p_year: year }),
    supabase.rpc('head_bookings', { p_track: track, p_orientation: orientation, p_year: year }),
  ])

  if (slotsRes.error) {
    return NextResponse.json({ error: slotsRes.error.message }, { status: 500 })
  }
  if (bookingsRes.error) {
    return NextResponse.json({ error: bookingsRes.error.message }, { status: 500 })
  }

  const slots = (slotsRes.data as HeadSlot[]) || []
  const bookings = (bookingsRes.data as HeadBooking[]) || []

  const workbook = await generateInterviewBookingWorkbook({
    track,
    orientation,
    orientationYear: year,
    slots,
    bookings,
    startDate,
    endDate,
  })

  const buffer = await workbook.xlsx.writeBuffer()

  const trackLabel = track === 'game_master' ? 'GM' : 'Facilitator'
  let filename: string
  if (startDate && endDate && startDate === endDate) {
    const parts = startDate.split('-') // ['YYYY', 'MM', 'DD']
    const datePrefix = parts.length === 3 ? `${parts[2]}_${parts[1]}` : startDate
    filename = `${datePrefix} ${trackLabel} Interview Time Slot Export.xlsx`
  } else if (startDate && !endDate) {
    const parts = startDate.split('-')
    const datePrefix = parts.length === 3 ? `${parts[2]}_${parts[1]}` : startDate
    filename = `${datePrefix} ${trackLabel} Interview Time Slot Export.xlsx`
  } else {
    filename = `${orientation}_${year}_${trackLabel}_Interview_Time_Slot_Export.xlsx`
  }

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"`,
      'Cache-Control': 'no-store, max-age=0',
    },
  })
}
