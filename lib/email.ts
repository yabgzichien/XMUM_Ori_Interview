import nodemailer from 'nodemailer'
import { formatDateHeading, formatTimeRange, toLocalDateIso } from './booking-helpers'

type BookingDetails = {
  id: string
  applicant_name: string
  applicant_email: string
  track: string
  starts_at: string
  ends_at: string
  created_at: string
  venue?: string
}

function formatTrack(track: string | undefined | null): string {
  if (!track) return '-'
  if (track === 'game_master') return 'Game Master'
  if (track === 'facilitator') return 'Facilitator'
  return track.charAt(0).toUpperCase() + track.slice(1)
}

async function getTransporter(): Promise<{
  transporter: nodemailer.Transporter
  from: string
}> {
  const host = process.env.SMTP_HOST
  const port = Number(process.env.SMTP_PORT || '587')
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASSWORD
  const from = process.env.SMTP_FROM || `"XMUM Orientation Committee" <noreply@xmu.edu.my>`

  if (!host || !user || !pass) {
    console.warn('SMTP configuration is missing. Falling back to Ethereal SMTP test service...')
    const testAccount = await nodemailer.createTestAccount()
    const transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    })
    return { transporter, from: `"XMUM Orientation (Test)" <${testAccount.user}>` }
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
  })
  return { transporter, from }
}

export async function sendBookingConfirmation(
  details: BookingDetails
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { transporter, from } = await getTransporter()

  const dateStr = formatDateHeading(toLocalDateIso(details.starts_at))
  const timeStr = formatTimeRange(details.starts_at, details.ends_at)
  const trackStr = formatTrack(details.track)

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XMUM Orientation Interview Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F6F8FC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F6F8FC; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="560" style="max-width: 560px; background-color: #ffffff; border: 1px solid #EAEEF4; border-radius: 20px; border-collapse: separate; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.03), 0 8px 10px -6px rgba(0, 0, 0, 0.02); overflow: hidden;">
          <!-- Brand Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563EB, #4F46E5); padding: 32px 40px; text-align: left;">
              <span style="display: inline-block; padding: 4px 10px; border-radius: 99px; background: rgba(255, 255, 255, 0.15); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1);">Confirmed</span>
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.02em;">Interview Booking</h1>
              <p style="color: rgba(255, 255, 255, 0.85); font-size: 13.5px; margin: 6px 0 0 0; font-weight: 500;">Orientation Committee Recruitment</p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">Hi <strong>${details.applicant_name}</strong>,</p>
              <p style="margin: 0 0 32px 0; font-size: 15px; line-height: 1.6; color: #52617A;">Your interview slot is confirmed. Below are the details for your recruitment interview:</p>

              <!-- Details Grid Table -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F8FAFC; border: 1px solid #EAEEF4; border-radius: 12px; padding: 20px 24px; margin-bottom: 32px;">
                <tr>
                  <td style="padding-bottom: 16px;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Position / Track</div>
                    <div style="font-size: 14.5px; font-weight: 700; color: #0F172A;">${trackStr}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 16px;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Interview Date</div>
                    <div style="font-size: 14.5px; font-weight: 700; color: #0F172A;">${dateStr}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding-bottom: 16px;">
                    <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Interview Time</div>
                    <div style="font-size: 14.5px; font-weight: 700; color: #0F172A;">${timeStr}</div>
                  </td>
                </tr>
                <tr>
                  <td>
                    <div style="font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;">Venue</div>
                    <div style="font-size: 14.5px; font-weight: 700; color: #0F172A;">${details.venue || 'TBA'}</div>
                  </td>
                </tr>
              </table>

              <!-- Reminders -->
              <div style="border-left: 4px solid #2563EB; padding-left: 18px; margin-bottom: 32px;">
                <h3 style="font-size: 14px; font-weight: 700; color: #0F172A; margin: 0 0 6px 0;">Important Reminders</h3>
                <ul style="margin: 0; padding: 0 0 0 16px; font-size: 13.5px; line-height: 1.55; color: #52617A;">
                  <li style="margin-bottom: 6px;">Please bring your <strong>Student ID Card</strong>.</li>
                  <li style="margin-bottom: 6px;">Arrive at least <strong>10 minutes early</strong> before your session starts.</li>
                  <li>If you need to reschedule or cancel, please contact the Committee team.</li>
                </ul>
              </div>

              <p style="margin: 0; font-size: 14px; color: #64748B;">All the best,<br><strong>XMUM Orientation Committee</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFBFD; border-top: 1px solid #EAEEF4; padding: 24px 40px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.5;">This is an automated email confirmation from the XMUM Orientation Interview Booking platform. Please do not reply directly to this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `

  try {
    const info = await transporter.sendMail({
      from,
      to: details.applicant_email,
      subject: `[XMUM Orientation] Interview Confirmation - ${trackStr}`,
      html: htmlContent,
    })

    const testUrl = nodemailer.getTestMessageUrl(info)
    if (testUrl) {
      console.log(`[TEST EMAIL SENT] View message: ${testUrl}`)
    }
    return { success: true, messageId: info.messageId }
  } catch (err: any) {
    console.error('Failed to send booking confirmation email:', err)
    return { success: false, error: err.message || String(err) }
  }
}

function formatBodyToHtml(text: string, name: string, track: string): string {
  const resolved = text
    .replace(/{name}/g, name)
    .replace(/{track}/g, track)
  
  const blocks = resolved.split('\n\n')
  return blocks.map(block => {
    const trimmed = block.trim()
    if (!trimmed) return ''
    
    if (/^\d+\./.test(trimmed)) {
      const items = trimmed.split(/\n(?=\d+\.)/)
      const listItems = items.map(item => {
        const content = item.replace(/^\d+\.\s*/, '')
        return `<li style="margin-bottom: 8px;">${content.replace(/\n/g, '<br>')}</li>`
      }).join('')
      return `<ol style="margin: 0 0 16px 0; padding-left: 20px; font-size: 14.5px; line-height: 1.6; color: #52617A;">${listItems}</ol>`
    }
    
    if (trimmed.length < 40 && !trimmed.endsWith('.') && !trimmed.includes('\n')) {
      return `<h3 style="font-size: 16px; font-weight: 700; color: #0F172A; margin: 24px 0 12px 0;">${trimmed}</h3>`
    }
    
    return `<p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #52617A;">${trimmed.replace(/\n/g, '<br>')}</p>`
  }).join('')
}

export async function sendWelcomeEmail(
  details: {
    applicant_name: string
    applicant_email: string
    track: string
    customSubject?: string
    customBody?: string
  }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { transporter, from } = await getTransporter()

  const trackStr = formatTrack(details.track)

  const rawSubject = details.customSubject || `[XMUM Orientation] Welcome to the Committee! - {track}`
  const subject = rawSubject
    .replace(/{name}/g, details.applicant_name)
    .replace(/{track}/g, trackStr)

  const defaultBody = `Dear {name},

Congratulations! We are absolutely thrilled to inform you that you have been approved to join the XMUM Orientation Committee as a {track}!

The recruitment team was incredibly impressed by your interview performance, experiences, and enthusiasm. We believe you will be a fantastic addition to the team.

What's Next?

1. Onboarding Session: Keep an eye on your inbox for our official onboarding invitation, where we will share the project timeline and introduce the subcommittee leads.
2. Committee Chat: We will invite you to the main Committee communication channels (WhatsApp/Discord) within the next few days.
3. Get Ready: Get ready for an exciting journey of planning, teamwork, and welcoming the new freshmen!

Once again, welcome onboard! We are excited to work with you.`

  const bodyHtml = formatBodyToHtml(details.customBody || defaultBody, details.applicant_name, trackStr)

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F6F8FC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F6F8FC; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="560" style="max-width: 560px; background-color: #ffffff; border: 1px solid #EAEEF4; border-radius: 20px; border-collapse: separate; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.03), 0 8px 10px -6px rgba(0, 0, 0, 0.02); overflow: hidden;">
          <!-- Brand Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #10B981, #059669); padding: 32px 40px; text-align: left;">
              <span style="display: inline-block; padding: 4px 10px; border-radius: 99px; background: rgba(255, 255, 255, 0.15); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1);">Welcome</span>
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.02em;">Welcome to the Team!</h1>
              <p style="color: rgba(255, 255, 255, 0.85); font-size: 13.5px; margin: 6px 0 0 0; font-weight: 500;">Orientation Committee 2026</p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 40px;">
              ${bodyHtml}
              <p style="margin: 24px 0 0 0; font-size: 14px; color: #64748B; line-height: 1.5;">Warm regards,<br><strong>XMUM Orientation Committee</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFBFD; border-top: 1px solid #EAEEF4; padding: 24px 40px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.5;">This email was sent to ${details.applicant_email} by the XMUM Orientation Committee.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `

  try {
    const info = await transporter.sendMail({
      from,
      to: details.applicant_email,
      subject,
      html: htmlContent,
    })

    const testUrl = nodemailer.getTestMessageUrl(info)
    if (testUrl) {
      console.log(`[TEST EMAIL SENT] View message: ${testUrl}`)
    }
    return { success: true, messageId: info.messageId }
  } catch (err: any) {
    console.error('Failed to send welcome email:', err)
    return { success: false, error: err.message || String(err) }
  }
}

export async function sendInvitationEmail(
  details: { name: string; email: string; code: string; activationLink: string }
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { transporter, from } = await getTransporter()

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>XMUM Orientation Committee Invitation</title>
</head>
<body style="margin: 0; padding: 0; background-color: #F6F8FC; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #F6F8FC; padding: 40px 10px;">
    <tr>
      <td align="center">
        <table width="100%" max-width="560" style="max-width: 560px; background-color: #ffffff; border: 1px solid #EAEEF4; border-radius: 20px; border-collapse: separate; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.03), 0 8px 10px -6px rgba(0, 0, 0, 0.02); overflow: hidden;">
          <!-- Brand Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #2563EB, #4F46E5); padding: 32px 40px; text-align: left;">
              <span style="display: inline-block; padding: 4px 10px; border-radius: 99px; background: rgba(255, 255, 255, 0.15); color: #ffffff; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.1);">Invitation</span>
              <h1 style="color: #ffffff; font-size: 22px; font-weight: 800; margin: 0; letter-spacing: -0.02em;">Join the Orientation Committee</h1>
              <p style="color: rgba(255, 255, 255, 0.85); font-size: 13.5px; margin: 6px 0 0 0; font-weight: 500;">Orientation Committee 2026</p>
            </td>
          </tr>

          <!-- Content Body -->
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">Hi <strong>${details.name}</strong>,</p>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #52617A;">You have been invited to join the <strong>XMUM Orientation Committee</strong>. To activate your account and set up your dashboard password, click the button below:</p>

              <!-- Call to Action Button -->
              <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 32px; text-align: center;">
                <tr>
                  <td align="center">
                    <a href="${details.activationLink}" target="_blank" style="display: inline-block; padding: 14px 28px; border-radius: 12px; background-color: #2563EB; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; box-shadow: 0 8px 18px -6px rgba(37,99,235,0.45); transition: background-color 0.15s;">Activate Account →</a>
                  </td>
                </tr>
              </table>

              <!-- Alternate Code Box -->
              <div style="background-color: #F8FAFC; border: 1px solid #EAEEF4; border-radius: 12px; padding: 18px 22px; margin-bottom: 32px;">
                <h3 style="font-size: 13px; font-weight: 700; color: #334155; margin: 0 0 8px 0;">Manually Activate</h3>
                <p style="margin: 0 0 10px 0; font-size: 13.5px; line-height: 1.5; color: #64748B;">If the button above does not work, visit <a href="${details.activationLink.split('?')[0]}" style="color: #2563EB; text-decoration: none; font-weight: 600;">/register</a> and enter your email along with the following invite code:</p>
                <div style="font-size: 15px; font-family: 'JetBrains Mono', 'Courier New', monospace; font-weight: 700; color: #0F172A; letter-spacing: 0.05em; background: #fff; border: 1px solid #E2E8F0; padding: 10px 14px; border-radius: 8px; width: fit-content;">${details.code}</div>
              </div>

              <p style="margin: 0; font-size: 14px; color: #64748B;">Welcome to the team!<br><strong>XMUM Orientation Committee</strong></p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #FAFBFD; border-top: 1px solid #EAEEF4; padding: 24px 40px; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94A3B8; line-height: 1.5;">This invitation was sent to ${details.email}. If you believe you received this in error, please disregard this email.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `

  try {
    const info = await transporter.sendMail({
      from,
      to: details.email,
      subject: `[XMUM Orientation] Committee Invitation`,
      html: htmlContent,
    })

    const testUrl = nodemailer.getTestMessageUrl(info)
    if (testUrl) {
      console.log(`[TEST EMAIL SENT] View message: ${testUrl}`)
    }
    return { success: true, messageId: info.messageId }
  } catch (err: any) {
    console.error('Failed to send invitation email:', err)
    return { success: false, error: err.message || String(err) }
  }
}
