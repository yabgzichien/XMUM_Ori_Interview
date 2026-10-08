import { describe, expect, it } from 'vitest'
import { parsePracticeRosterFile } from '@/lib/practice-import'

const positions = new Set(['facilitator', 'game_master'])
const member = { name: 'Example Member', student_id: 'dsc2344112', position: 'facilitator' }
const expectedRow = { rowNumber: 1, name: 'Example Member', student_id: 'DSC2344112', position: 'facilitator' }

describe('practice roster imports', () => {
  it('parses JSON and plain-text rosters into canonical rows', async () => {
    for (const name of ['roster.json', 'roster.txt']) {
      await expect(parsePracticeRosterFile(new File([JSON.stringify([member])], name), positions))
        .resolves.toEqual({ rows: [expectedRow], errors: [] })
    }
  })

  it('accepts JSON wrapped in a markdown code fence from an AI tool', async () => {
    const fenced = '```json\n' + JSON.stringify([member]) + '\n```'
    await expect(parsePracticeRosterFile(new File([fenced], 'roster.json'), positions))
      .resolves.toEqual({ rows: [expectedRow], errors: [] })
  })

  it('rejects CSV and XLSX files', async () => {
    for (const name of ['roster.csv', 'roster.xlsx']) {
      const result = await parsePracticeRosterFile(new File(['name,student_id,position'], name), positions)
      expect(result.rows).toEqual([])
      expect(result.errors[0]).toMatchObject({ field: 'file' })
    }
  })

  it('rejects duplicate student IDs case-insensitively', async () => {
    const file = new File([JSON.stringify([
      { name: 'One', student_id: 'DSC1', position: 'facilitator' },
      { name: 'Two', student_id: 'dsc1', position: 'game_master' },
    ])], 'roster.json')
    const result = await parsePracticeRosterFile(file, positions)
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, field: 'student_id', message: expect.stringMatching(/duplicate/i) }),
    ]))
  })

  it('accepts an optional contact number and rejects an overlong one', async () => {
    const withContact = await parsePracticeRosterFile(
      new File([JSON.stringify([{ ...member, contact_number: ' 012-3456789 ' }])], 'roster.json'), positions)
    expect(withContact.errors).toEqual([])
    expect(withContact.rows[0].contact_number).toBe('012-3456789')
    const blank = await parsePracticeRosterFile(
      new File([JSON.stringify([{ ...member, contact_number: '' }])], 'roster.json'), positions)
    expect(blank.rows[0]).toEqual(expectedRow)
    const tooLong = await parsePracticeRosterFile(
      new File([JSON.stringify([{ ...member, contact_number: '1'.repeat(31) }])], 'roster.json'), positions)
    expect(tooLong.errors[0]).toEqual(expect.objectContaining({ field: 'contact_number' }))
  })

  it('rejects missing or unexpected fields and non-array JSON', async () => {
    const extra = await parsePracticeRosterFile(
      new File([JSON.stringify([{ ...member, email: 'x' }])], 'roster.json'), positions)
    expect(extra.errors[0].message).toMatch(/must contain/i)
    const missing = await parsePracticeRosterFile(
      new File([JSON.stringify([{ name: 'A', student_id: 'DSC1' }])], 'roster.json'), positions)
    expect(missing.errors[0].message).toMatch(/must contain/i)
    const notArray = await parsePracticeRosterFile(new File(['{"members":[]}'], 'roster.json'), positions)
    expect(notArray.errors[0].message).toMatch(/array/i)
  })

  it('reports blank values and positions outside the configured list', async () => {
    const file = new File([JSON.stringify([{ name: '', student_id: 'DSC1', position: 'unknown' }])], 'roster.json')
    const result = await parsePracticeRosterFile(file, positions)
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 1, field: 'name' }),
      expect.objectContaining({ row: 1, field: 'position' }),
    ]))
  })

  it('rejects malformed or empty JSON', async () => {
    for (const text of ['{', '   ']) {
      const result = await parsePracticeRosterFile(new File([text], 'roster.json'), positions)
      expect(result.rows).toEqual([])
      expect(result.errors[0]).toMatchObject({ field: 'file' })
    }
  })

  it('rejects files above 5 MB and more than 5,000 members', async () => {
    const oversized = await parsePracticeRosterFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'roster.json'), positions)
    expect(oversized.errors[0].message).toMatch(/5 MB/i)
    const rows = Array.from({ length: 5001 }, (_, index) => ({ name: `Member ${index}`, student_id: `DSC${index}`, position: 'facilitator' }))
    const tooMany = await parsePracticeRosterFile(new File([JSON.stringify(rows)], 'roster.json'), positions)
    expect(tooMany.errors[0].message).toMatch(/5,000/i)
  })
})
