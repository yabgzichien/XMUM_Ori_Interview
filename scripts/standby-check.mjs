// Standby Status & Health Check Script
// Run: node --env-file=.env.local scripts/standby-check.mjs

import { createClient } from '@supabase/supabase-js'
import nodemailer from 'nodemailer'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE env variables in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function main() {
  console.log('====================================================')
  console.log('🔍 XMUM Orientation Interview Booking — Standby Check')
  console.log('====================================================\n')

  // 1. Check Supabase Connectivity
  try {
    const { data: facSlots, error: facErr } = await supabase.rpc('available_slots', {
      p_track: 'facilitator',
      p_orientation: 'december',
      p_year: 2026,
    })
    const { data: gmSlots, error: gmErr } = await supabase.rpc('available_slots', {
      p_track: 'game_master',
      p_orientation: 'december',
      p_year: 2026,
    })

    if (facErr || gmErr) {
      console.error('❌ Supabase RPC available_slots error:', facErr || gmErr)
    } else {
      console.log('✅ Supabase RPC available_slots: OK')
      const facSeats = (facSlots || []).reduce((acc, s) => acc + (s.seats_left || 0), 0)
      const gmSeats = (gmSlots || []).reduce((acc, s) => acc + (s.seats_left || 0), 0)
      console.log(`   - Facilitator: ${facSlots?.length ?? 0} slots, ${facSeats} seats available`)
      console.log(`   - Game Master: ${gmSlots?.length ?? 0} slots, ${gmSeats} seats available`)
    }
  } catch (err) {
    console.error('❌ Supabase connection failed:', err.message)
  }

  // 2. Check Track Settings / Windows
  const { data: trackSettings, error: tsErr } = await supabase
    .from('track_settings')
    .select('*')
    .eq('orientation', 'december')
    .eq('orientation_year', 2026)

  if (tsErr) {
    console.error('❌ track_settings query error:', tsErr)
  } else {
    console.log('\n📅 Track Settings (December 2026):')
    for (const ts of trackSettings) {
      console.log(`   - [${ts.track}] window_open: ${ts.window_open ?? 'NULL (Always Open)'} | window_close: ${ts.window_close ?? 'NULL (Always Open)'}`)
    }
  }

  // 3. Check Active Bookings
  const { data: activeBookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, student_id, applicant_name, applicant_email, track, status, created_at')
    .eq('status', 'booked')

  if (bErr) {
    console.error('❌ Bookings query error:', bErr)
  } else {
    console.log(`\n🎟️ Active Bookings Count: ${activeBookings?.length ?? 0}`)
    if (activeBookings && activeBookings.length > 0) {
      for (const b of activeBookings) {
        console.log(`   - [${b.track}] ${b.student_id} | ${b.applicant_name} (${b.applicant_email})`)
      }
    }
  }

  // 4. Check Active Slot Holds (held within last 10 minutes)
  const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: activeHolds, error: hErr } = await supabase
    .from('slot_holds')
    .select('id, slot_id, token, held_at, released')
    .eq('released', false)
    .gt('held_at', tenMinsAgo)

  if (hErr) {
    console.error('❌ Slot holds query error:', hErr)
  } else {
    console.log(`\n⏳ Active Temporary Holds (<10m): ${activeHolds?.length ?? 0}`)
    if (activeHolds && activeHolds.length > 0) {
      for (const h of activeHolds) {
        console.log(`   - Hold Token: ${h.token} on slot ${h.slot_id} at ${h.held_at}`)
      }
    }
  }

  // 5. Check SMTP
  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD) {
    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: false,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASSWORD,
        },
      })
      await transporter.verify()
      console.log('\n📧 SMTP Email Service: OK (Connected to Gmail)')
    } catch (e) {
      console.error('\n❌ SMTP Verification Failed:', e.message)
    }
  } else {
    console.log('\n⚠️ SMTP Email Config is not fully set.')
  }

  console.log('\n====================================================')
}

main().catch(console.error)
