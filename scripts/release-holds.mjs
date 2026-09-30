// Emergency script to release holds
// Run: node --env-file=.env.local scripts/release-holds.mjs [optional_token_or_slot_id]

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing SUPABASE env variables in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseServiceKey)
const target = process.argv[2]

async function main() {
  if (target) {
    console.log(`Releasing holds matching token or slot_id: ${target}`)
    const { data, error } = await supabase
      .from('slot_holds')
      .update({ released: true })
      .or(`token.eq.${target},slot_id.eq.${target}`)
      .select()

    if (error) console.error('Error:', error)
    else console.log(`✅ Released ${data.length} hold(s).`)
  } else {
    console.log('Releasing ALL unreleased holds older than 10 minutes (or all unreleased)...')
    const { data, error } = await supabase
      .from('slot_holds')
      .update({ released: true })
      .eq('released', false)
      .select()

    if (error) console.error('Error:', error)
    else console.log(`✅ Released ${data.length} hold(s).`)
  }
}

main().catch(console.error)
