import ExcelJS from 'exceljs'
import { describe, expect, it } from 'vitest'
import { parsePracticeRosterFile } from '@/lib/practice-import'

const positions = new Set(['facilitator', 'game_master'])
const expectedRow = {
  rowNumber: 2,
  name: 'Example Member',
  student_id: 'DSC2344112',
  position: 'facilitator',
}

async function xlsxFile(rows: string[][]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Roster')
  rows.forEach((row) => sheet.addRow(row))
  const buffer = await workbook.xlsx.writeBuffer()
  return new File([buffer], 'roster.xlsx', {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('practice roster imports', () => {
  it('parses equivalent XLSX, CSV, and JSON files into canonical rows', async () => {
    const files = [
      await xlsxFile([
        ['name', 'student_id', 'position'],
        ['Example Member', 'dsc2344112', 'facilitator'],
      ]),
      new File([
        '\uFEFFname,student_id,position\r\n"Example Member",dsc2344112,facilitator\r\n',
      ], 'roster.csv', { type: 'text/csv' }),
      new File([JSON.stringify([
        { name: 'Example Member', student_id: 'dsc2344112', position: 'facilitator' },
      ])], 'roster.json', { type: 'application/json' }),
    ]

    for (const file of files) {
      await expect(parsePracticeRosterFile(file, positions)).resolves.toEqual({
        rows: [expectedRow],
        errors: [],
      })
    }
  })

  it('supports quoted commas and escaped quotes in CSV fields', async () => {
    const file = new File([
      'name,student_id,position\n"Tan, \"\"Alex\"\"",DSC1,facilitator\n',
    ], 'roster.csv', { type: 'text/csv' })
    const result = await parsePracticeRosterFile(file, positions)
    expect(result.errors).toEqual([])
    expect(result.rows[0]).toMatchObject({ name: 'Tan, "Alex"', student_id: 'DSC1' })
  })

  it('rejects duplicate student IDs case-insensitively', async () => {
    const file = new File([JSON.stringify([
      { name: 'One', student_id: 'DSC1', position: 'facilitator' },
      { name: 'Two', student_id: 'dsc1', position: 'game_master' },
    ])], 'roster.json')
    const result = await parsePracticeRosterFile(file, positions)
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 3, field: 'student_id', message: expect.stringMatching(/duplicate/i) }),
    ]))
  })

  it('rejects missing headers and unexpected JSON fields', async () => {
    const missingHeader = await parsePracticeRosterFile(
      new File(['name,student_id\nExample,DSC1'], 'roster.csv'),
      positions,
    )
    expect(missingHeader.errors[0]).toMatchObject({ row: 1, field: 'file' })

    const extraField = await parsePracticeRosterFile(
      new File([JSON.stringify([{ name: 'Example', student_id: 'DSC1', position: 'facilitator', email: 'x' }])], 'roster.json'),
      positions,
    )
    expect(extraField.errors[0].message).toMatch(/exactly/i)
  })

  it('reports blank values and positions outside the configured list', async () => {
    const file = new File([JSON.stringify([
      { name: '', student_id: 'DSC1', position: 'unknown' },
    ])], 'roster.json')
    const result = await parsePracticeRosterFile(file, positions)
    expect(result.rows).toEqual([])
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 2, field: 'name' }),
      expect.objectContaining({ row: 2, field: 'position' }),
    ]))
  })

  it('rejects malformed JSON, CSV, and XLSX files', async () => {
    const files = [
      new File(['{'], 'roster.json'),
      new File(['name,student_id,position\n"Unclosed,DSC1,facilitator'], 'roster.csv'),
      new File(['not a workbook'], 'roster.xlsx'),
    ]
    for (const file of files) {
      const result = await parsePracticeRosterFile(file, positions)
      expect(result.rows).toEqual([])
      expect(result.errors[0]).toMatchObject({ field: 'file' })
    }
  })

  it('rejects files above 5 MB and more than 5,000 data rows', async () => {
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'roster.csv')
    const oversizedResult = await parsePracticeRosterFile(oversized, positions)
    expect(oversizedResult.errors[0].message).toMatch(/5 MB/i)

    const rows = Array.from({ length: 5001 }, (_, index) => ({
      name: `Member ${index}`,
      student_id: `DSC${index}`,
      position: 'facilitator',
    }))
    const tooMany = await parsePracticeRosterFile(
      new File([JSON.stringify(rows)], 'roster.json'),
      positions,
    )
    expect(tooMany.errors[0].message).toMatch(/5,000/i)
  })
})
