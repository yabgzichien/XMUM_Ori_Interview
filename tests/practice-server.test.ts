import { describe, expect, it } from 'vitest'
import { mapPracticeCatalog, mapPracticeLookup } from '@/lib/practice-catalog'

const rawGroup = {
  id: 'group-1',
  name: 'Neon Pulse',
  status: 'open' as const,
  seats_left: 4,
  committee_seats_left: 2,
  faci_gm_seats_left: 2,
  performance_type: 'K-pop dance',
  description: 'High energy performance.',
  leaders: [{ id: 'member-1', name: 'Alice Tan', position: 'Facilitator' }, { id: 'member-9', name: 'Ben Ong', position: 'Game Master' }],
  performance_video_url: 'https://youtu.be/dQw4w9WgXcQ',
  song: { type: 'mp3' as const, storage_path: 'group-1/song.mp3' },
}

describe('practice public catalog service', () => {
  it('returns the public preview catalog and resolves stored MP3 paths to public URLs', async () => {
    const result = mapPracticeCatalog({
      server_now: '2026-11-30T00:00:00.000Z',
      booking_opens_at: '2026-12-01T00:00:00.000Z',
      booking_open: false,
      groups: [rawGroup],
    }, (path) => `https://storage.example.test/${path}`)

    expect(result).toEqual(expect.objectContaining({
      booking_open: false,
      groups: [expect.objectContaining({
        id: 'group-1',
        song: { type: 'mp3', url: 'https://storage.example.test/group-1/song.mp3' },
      })],
    }))
  })

  it('applies the same media mapping to verified availability results', async () => {
    const result = mapPracticeLookup(
      { state: 'available', groups: [rawGroup] },
      (path) => `https://storage.example.test/${path}`,
    )

    expect(result).toMatchObject({
      state: 'available',
      groups: [{ song: { type: 'mp3', url: 'https://storage.example.test/group-1/song.mp3' } }],
    })
  })
})
