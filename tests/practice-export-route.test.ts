import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExcelJS from 'exceljs'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))

import { GET } from '@/app/api/export/practice/route'

describe('GET /api/export/practice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 401 when signed out', async () => {
    mocks.getCurrentProfile.mockResolvedValue(null)
    const req = new NextRequest('http://localhost:3000/api/export/practice')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('returns 403 when not admin', async () => {
    mocks.getCurrentProfile.mockResolvedValue({ id: 'u1', role: 'head_facilitator' })
    const req = new NextRequest('http://localhost:3000/api/export/practice')
    const res = await GET(req)
    expect(res.status).toBe(403)
  })

  it('returns 200 and valid excel workbook when admin', async () => {
    mocks.getCurrentProfile.mockResolvedValue({ id: 'admin-1', role: 'admin' })

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'practice_groups') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'g-1',
                  name: 'Dancing A',
                  committee_capacity: 1,
                  faci_gm_capacity: 1,
                  description: 'Sample Song',
                  performance_video_url: 'https://youtu.be/test',
                  song_url: null,
                  practice_group_leaders: [{ roster_member_id: 'r-lead-1' }],
                },
              ],
              error: null,
            }),
          }
        }
        if (table === 'committee_roster') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            then: vi.fn((resolve) =>
              resolve({
                data: [
                  { id: 'r-lead-1', name: 'Leader Alice', student_id: 'S1', position: 'lead' },
                  { id: 'r-mem-1', name: 'Member Bob', student_id: 'S2', position: 'facilitator' },
                ],
                error: null,
              }),
            ),
          }
        }
        if (table === 'practice_group_bookings') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                { id: 'b-1', group_id: 'g-1', roster_member_id: 'r-mem-1' },
              ],
              error: null,
            }),
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      }),
    }

    mocks.createClient.mockResolvedValue(mockDb)

    const req = new NextRequest('http://localhost:3000/api/export/practice?orientation=december&year=2026')
    const res = await GET(req)

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
    expect(res.headers.get('Content-Disposition')).toContain(
      '26_12 Committees Facilitators Game Masters Performance.xlsx',
    )

    const arrayBuffer = await res.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(arrayBuffer))

    const sheet = workbook.getWorksheet('Performance List')
    expect(sheet).toBeDefined()
    expect(sheet?.getCell('A1').value).toBe('26/12 December Orientation Performance List')
    expect(sheet?.getCell('D3').value).toBe('Dancing A')
    expect(sheet?.getCell('D4').value).toBe('Sample Song')
    expect(sheet?.getCell('D6').value).toBe('Leader Alice')
    expect(sheet?.getCell('D8').value).toBe('Member Bob')
  })

  it('uses songs column in row 4 of the Excel export when present', async () => {
    mocks.getCurrentProfile.mockResolvedValue({ id: 'admin-1', role: 'admin' })

    const mockDb = {
      from: vi.fn((table: string) => {
        if (table === 'practice_groups') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  id: 'g-1',
                  name: 'Dancing A',
                  committee_capacity: 1,
                  faci_gm_capacity: 1,
                  songs: 'Seven + Supernova',
                  description: 'Legacy Description',
                  performance_video_url: 'https://youtu.be/test',
                  song_url: null,
                  practice_group_leaders: [],
                },
              ],
              error: null,
            }),
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({ data: [], error: null }),
          then: vi.fn((resolve) => resolve({ data: [], error: null })),
        }
      }),
    }

    mocks.createClient.mockResolvedValue(mockDb)

    const req = new NextRequest('http://localhost:3000/api/export/practice?orientation=december&year=2026')
    const res = await GET(req)
    expect(res.status).toBe(200)

    const arrayBuffer = await res.arrayBuffer()
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(arrayBuffer))

    const sheet = workbook.getWorksheet('Performance List')
    expect(sheet?.getCell('D4').value).toBe('Seven + Supernova')
  })
})
