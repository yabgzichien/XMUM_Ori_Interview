import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentProfile: vi.fn(),
  createClient: vi.fn(),
  parsePracticeRosterFile: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ getCurrentProfile: mocks.getCurrentProfile }))
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/practice-import', () => ({ parsePracticeRosterFile: mocks.parsePracticeRosterFile }))

import { POST as validatePOST } from '@/app/api/admin/practice/import/validate/route'
import { POST as applyPOST } from '@/app/api/admin/practice/import/apply/route'
import { GET as templateGET } from '@/app/api/admin/practice/import/template/route'

function uploadRequest(path: string) {
  const form = new FormData()
  form.set('file', new File(['name,student_id,position\nExample,DSC1,facilitator'], 'roster.csv'))
  return {
    url: `http://localhost${path}`,
    formData: vi.fn().mockResolvedValue(form),
  } as unknown as Request
}

function databaseFixture() {
  const rpc = vi.fn().mockResolvedValue({ data: { total: 1, inserted: 1, updated: 0 }, error: null })
  const from = vi.fn((table: string) => ({
    select: vi.fn().mockResolvedValue(table === 'committee_positions'
      ? { data: [{ value: 'facilitator' }], error: null }
      : { data: [], error: null }),
  }))
  return { rpc, from }
}

describe('admin practice import routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentProfile.mockResolvedValue({ id: 'admin-1', role: 'admin' })
    mocks.parsePracticeRosterFile.mockResolvedValue({
      rows: [{ rowNumber: 2, name: 'Example', student_id: 'DSC1', position: 'facilitator' }],
      errors: [],
    })
    mocks.createClient.mockResolvedValue(databaseFixture())
  })

  it('returns 401 when signed out and 403 for non-admin staff', async () => {
    mocks.getCurrentProfile.mockResolvedValueOnce(null)
    const signedOut = await validatePOST(uploadRequest('/api/admin/practice/import/validate'))
    expect(signedOut.status).toBe(401)

    mocks.getCurrentProfile.mockResolvedValueOnce({ id: 'head-1', role: 'head_gm' })
    const head = await validatePOST(uploadRequest('/api/admin/practice/import/validate'))
    expect(head.status).toBe(403)
  })

  it('validates and reports insert/update counts without writing', async () => {
    const database = databaseFixture()
    database.from = vi.fn((table: string) => ({
      select: vi.fn().mockResolvedValue(table === 'committee_positions'
        ? { data: [{ value: 'facilitator' }], error: null }
        : { data: [{ student_id: 'OTHER' }], error: null }),
    }))
    mocks.createClient.mockResolvedValue(database)
    const response = await validatePOST(uploadRequest('/api/admin/practice/import/validate'))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ data: { inserted: 1, updated: 0, errors: [] } })
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('reparses on apply and sends all canonical rows to one authenticated RPC', async () => {
    const database = databaseFixture()
    mocks.createClient.mockResolvedValue(database)
    const response = await applyPOST(uploadRequest('/api/admin/practice/import/apply'))
    expect(response.status).toBe(200)
    expect(mocks.parsePracticeRosterFile).toHaveBeenCalledTimes(1)
    expect(database.rpc).toHaveBeenCalledTimes(1)
    expect(database.rpc).toHaveBeenCalledWith('admin_apply_practice_roster', {
      p_rows: [{ name: 'Example', student_id: 'DSC1', position: 'facilitator' }],
    })
  })

  it('does not write an import containing validation errors', async () => {
    const database = databaseFixture()
    mocks.createClient.mockResolvedValue(database)
    mocks.parsePracticeRosterFile.mockResolvedValue({
      rows: [],
      errors: [{ row: 2, field: 'student_id', message: 'Duplicate student ID.' }],
    })
    const response = await applyPOST(uploadRequest('/api/admin/practice/import/apply'))
    expect(response.status).toBe(400)
    expect(database.rpc).not.toHaveBeenCalled()
  })

  it('returns no success counts when the transactional RPC fails', async () => {
    const database = databaseFixture()
    database.rpc.mockResolvedValue({ data: null, error: { message: 'write failed' } })
    mocks.createClient.mockResolvedValue(database)
    const response = await applyPOST(uploadRequest('/api/admin/practice/import/apply'))
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'The roster import could not be applied.' })
  })

  it('downloads an authenticated XLSX template with the required headers', async () => {
    const response = await templateGET()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('spreadsheetml')
    expect(response.headers.get('content-disposition')).toContain('practice-roster-template.xlsx')
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0)
  })
})
