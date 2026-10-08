import type { PracticeCatalog, PracticeLookupResult, PracticeSongType, PublicPracticeGroup } from '@/lib/practice-types'

type RawSong = {
  type: PracticeSongType
  url?: string | null
  storage_path?: string | null
}

type RawGroup = Omit<PublicPracticeGroup, 'song'> & { song: RawSong | null }
type RawCatalog = Omit<PracticeCatalog, 'groups'> & { groups: RawGroup[] }
type RawLookup =
  | { state: 'available'; groups: RawGroup[] }
  | Extract<PracticeLookupResult, { state: 'booked' }>

function mapGroup(group: RawGroup, publicAudioUrl: (path: string) => string): PublicPracticeGroup {
  if (!group.song) return { ...group, song: null }
  if (group.song.type === 'mp3') {
    const path = group.song.storage_path
    return { ...group, song: path ? { type: 'mp3', url: publicAudioUrl(path) } : null }
  }
  return {
    ...group,
    song: group.song.url ? { type: group.song.type, url: group.song.url } : null,
  }
}

export function mapPracticeCatalog(raw: RawCatalog, publicAudioUrl: (path: string) => string): PracticeCatalog {
  return { ...raw, groups: raw.groups.map((group) => mapGroup(group, publicAudioUrl)) }
}

export function mapPracticeLookup(raw: RawLookup, publicAudioUrl: (path: string) => string): PracticeLookupResult {
  if (raw.state === 'booked') return raw
  return { state: 'available', groups: raw.groups.map((group) => mapGroup(group, publicAudioUrl)) }
}
