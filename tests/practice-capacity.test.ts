import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getPracticeCapacityCategory } from '@/lib/practice-capacity'

describe('practice capacity categories', () => {
  it.each(['facilitator', 'game_master'])('classifies %s under Faci/GM capacity', (position) => {
    expect(getPracticeCapacityCategory(position)).toBe('faci_gm')
  })

  it.each(['designer', 'treasurer', 'secretary', 'custom_committee_role'])(
    'classifies %s under committee capacity',
    (position) => {
      expect(getPracticeCapacityCategory(position)).toBe('committee')
    },
  )

  it('serializes booking classification with roster position changes in the database', () => {
    const migration = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0048_harden_split_practice_capacity.sql'),
      'utf8',
    )
    const lockedRosterReads = migration.match(
      /SELECT \* INTO member\s+FROM committee_roster\s+WHERE[\s\S]{0,240}?FOR UPDATE;/g,
    )

    expect(lockedRosterReads).toHaveLength(3)
  })
})
