// Browser-side avatar upload/removal. Mirrors the lib/practice.ts pattern:
// each function builds its own client at call time and talks to Supabase
// Storage + the profiles table directly under the caller's own RLS session
// (see 0032_profile_avatar.sql for the storage policies).

import { createClient } from '@/lib/supabase/client'

const AVATAR_BUCKET = 'avatars'
const MAX_AVATAR_BYTES = 3 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}
const ALL_EXTENSIONS = Object.values(EXT_BY_TYPE)

/** Uploads/replaces the caller's avatar and returns the new public URL. */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    throw new Error('Please upload a JPG, PNG, or WEBP image.')
  }
  if (file.size > MAX_AVATAR_BYTES) {
    throw new Error('Image must be smaller than 3MB.')
  }

  const supabase = createClient()
  const path = `${userId}/avatar.${ext}`

  const { error: uploadError } = await supabase.storage
    .from(AVATAR_BUCKET)
    .upload(path, file, { upsert: true, cacheControl: '3600', contentType: file.type })
  if (uploadError) throw uploadError

  // Old avatars under a different extension would otherwise linger in storage.
  const staleExtensions = ALL_EXTENSIONS.filter((e) => e !== ext)
  if (staleExtensions.length) {
    await supabase.storage.from(AVATAR_BUCKET).remove(staleExtensions.map((e) => `${userId}/avatar.${e}`))
  }

  const { data } = supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path)
  // Cache-bust: the path is stable across re-uploads, so force a fresh fetch.
  const avatarUrl = `${data.publicUrl}?v=${Date.now()}`

  const { error: updateError } = await supabase.from('profiles').update({ avatar_url: avatarUrl }).eq('id', userId)
  if (updateError) throw updateError

  return avatarUrl
}

/** Deletes the caller's avatar file(s) and clears profiles.avatar_url. */
export async function removeAvatar(userId: string): Promise<void> {
  const supabase = createClient()
  await supabase.storage.from(AVATAR_BUCKET).remove(ALL_EXTENSIONS.map((e) => `${userId}/avatar.${e}`))

  const { error } = await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
  if (error) throw error
}
