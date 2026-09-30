import ExcelJS from 'exceljs'
import { NextResponse } from 'next/server'
import { getCurrentProfile } from '@/lib/auth'

export async function GET() {
  const profile = await getCurrentProfile()
  if (!profile) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (profile.role !== 'admin') return NextResponse.json({ error: 'Not authorized.' }, { status: 403 })

  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Committee Roster')
  sheet.addRow(['name', 'student_id', 'position'])
  sheet.addRow(['Example Member', 'DSC2344112', 'facilitator'])
  sheet.getRow(1).font = { bold: true }
  sheet.columns = [{ width: 28 }, { width: 18 }, { width: 22 }]
  const buffer = await workbook.xlsx.writeBuffer()

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="practice-roster-template.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}
