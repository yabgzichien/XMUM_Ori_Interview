import ExcelJS from 'exceljs'
import { normalizeStudentId } from '@/lib/practice-identity'
import type { CanonicalRosterRow, ImportValidation, RosterImportError } from '@/lib/practice-types'

const REQUIRED_FIELDS = ['name', 'student_id', 'position'] as const
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_ROWS = 5000

type RawRosterRow = Record<string, unknown>
type ParsedRows = { rows: RawRosterRow[]; rowNumbers: number[] }
type MatrixRow = { values: string[]; rowNumber: number }

class RosterParseError extends Error {
  constructor(message: string, readonly row: number | null = null) {
    super(message)
  }
}

function fileError(message: string, row: number | null = null): ImportValidation {
  return { rows: [], errors: [{ row, field: 'file', message }] }
}

function parseCsv(text: string): MatrixRow[] {
  const rows: MatrixRow[] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let lineNumber = 1
  let rowNumber = 1

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += character
        if (character === '\n') lineNumber += 1
        else if (character === '\r') {
          if (text[index + 1] === '\n') index += 1
          lineNumber += 1
        }
      }
      continue
    }
    if (character === '"' && field === '') {
      quoted = true
    } else if (character === ',') {
      row.push(field)
      field = ''
    } else if (character === '\n' || character === '\r') {
      row.push(field)
      rows.push({ values: row, rowNumber })
      row = []
      field = ''
      if (character === '\r' && text[index + 1] === '\n') index += 1
      lineNumber += 1
      rowNumber = lineNumber
    } else {
      field += character
    }
  }
  if (quoted) throw new Error('Unclosed quoted field')
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push({ values: row, rowNumber })
  }
  return rows
}

function rowsFromMatrix(matrix: MatrixRow[]): ParsedRows {
  const nonEmpty = matrix
    .filter(({ values }) => values.some((cell) => cell.trim() !== ''))
  if (nonEmpty.length === 0) throw new Error('The file is empty.')
  const headers = nonEmpty[0].values.map((header) => header.replace(/^\uFEFF/, '').trim())
  if (headers.length !== REQUIRED_FIELDS.length || REQUIRED_FIELDS.some((field, index) => headers[index] !== field)) {
    throw new RosterParseError('Header row must be exactly: name, student_id, position.', nonEmpty[0].rowNumber)
  }

  const dataRows = nonEmpty.slice(1)
  const invalid = dataRows.find(({ values }) => values.length !== REQUIRED_FIELDS.length)
  if (invalid) {
    throw new RosterParseError('Row must contain exactly name, student_id, and position.', invalid.rowNumber)
  }
  return {
    rowNumbers: dataRows.map(({ rowNumber }) => rowNumber),
    rows: dataRows.map(({ values }) => Object.fromEntries(
      REQUIRED_FIELDS.map((field, index) => [field, values[index]]),
    )),
  }
}

async function parseXlsx(file: File): Promise<ParsedRows> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(await file.arrayBuffer())
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('The workbook has no worksheet.')
  const matrix: MatrixRow[] = []
  sheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const values: string[] = []
    for (let index = 1; index <= Math.max(row.cellCount, REQUIRED_FIELDS.length); index += 1) {
      values.push(row.getCell(index).text)
    }
    matrix.push({ values, rowNumber })
  })
  return rowsFromMatrix(matrix)
}

async function parseFile(file: File): Promise<ParsedRows | ImportValidation> {
  const extension = file.name.toLowerCase().split('.').pop()
  if (extension === 'xlsx') return parseXlsx(file)
  const text = await file.text()
  if (extension === 'csv') return rowsFromMatrix(parseCsv(text))
  if (extension === 'json') {
    const value = JSON.parse(text) as unknown
    if (!Array.isArray(value)) throw new Error('JSON must be a top-level array.')
    for (let index = 0; index < value.length; index += 1) {
      const row = value[index]
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return fileError(`Row ${index + 2} must be an object.`, index + 2)
      }
      const keys = Object.keys(row).sort()
      if (keys.join(',') !== [...REQUIRED_FIELDS].sort().join(',')) {
        return fileError(`Row ${index + 2} must contain exactly name, student_id, and position.`, index + 2)
      }
    }
    return { rows: value as RawRosterRow[], rowNumbers: value.map((_, index) => index + 2) }
  }
  throw new Error('Use an XLSX, CSV, or JSON file.')
}

function validateRows(
  rawRows: RawRosterRow[],
  rowNumbers: number[],
  validPositions: Set<string>,
): ImportValidation {
  if (rawRows.length > MAX_ROWS) return fileError('Imports are limited to 5,000 data rows.')
  const errors: RosterImportError[] = []
  const rows: CanonicalRosterRow[] = []
  const seen = new Map<string, number>()

  rawRows.forEach((raw, index) => {
    const rowNumber = rowNumbers[index]
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    const studentId = normalizeStudentId(raw.student_id)
    const position = typeof raw.position === 'string' ? raw.position.trim() : ''
    if (!name) errors.push({ row: rowNumber, field: 'name', message: 'Name is required.' })
    if (!studentId) errors.push({ row: rowNumber, field: 'student_id', message: 'Enter a valid student ID.' })
    if (!position || !validPositions.has(position)) {
      errors.push({ row: rowNumber, field: 'position', message: 'Choose a configured committee position.' })
    }
    if (studentId) {
      const firstRow = seen.get(studentId)
      if (firstRow !== undefined) {
        errors.push({ row: rowNumber, field: 'student_id', message: `Duplicate student ID; first used on row ${firstRow}.` })
      } else {
        seen.set(studentId, rowNumber)
      }
    }
    if (name && studentId && position && validPositions.has(position)) {
      rows.push({ rowNumber, name, student_id: studentId, position })
    }
  })

  return errors.length > 0 ? { rows: [], errors } : { rows, errors: [] }
}

export async function parsePracticeRosterFile(
  file: File,
  validPositions: Set<string>,
): Promise<ImportValidation> {
  if (file.size > MAX_FILE_BYTES) return fileError('The import file must be 5 MB or smaller.')
  try {
    const parsed = await parseFile(file)
    if ('errors' in parsed) return parsed
    return validateRows(parsed.rows, parsed.rowNumbers, validPositions)
  } catch (error) {
    return fileError(
      error instanceof RosterParseError ? error.message : 'The import file could not be parsed. Check its format and headers.',
      error instanceof RosterParseError ? error.row : null,
    )
  }
}
