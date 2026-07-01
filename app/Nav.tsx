import React from 'react'
import { getCurrentProfile } from '@/lib/auth'
import { NavClient } from './NavClient'

export async function Nav() {
  const profile = await getCurrentProfile()
  return <NavClient profile={profile} />
}
