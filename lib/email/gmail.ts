/**
 * Email sender via Nodemailer
 *
 * Supports two modes:
 * A) Gmail App Password (if GMAIL_USER ends with @gmail.com or @googlemail.com)
 * B) Custom SMTP (for custom domains like @jojofashion.us)
 *
 * For @jojofashion.us — add these to .env.local:
 *   GMAIL_USER=alex@jojofashion.us
 *   GMAIL_APP_PASSWORD=your_email_password
 *   SMTP_HOST=mail.jojofashion.us        ← get from your hosting / cPanel / Cloudflare
 *   SMTP_PORT=465                         ← usually 465 (SSL) or 587 (TLS)
 *
 * For Gmail (@gmail.com):
 *   1. Google Account → Security → 2-Step Verification (must be ON)
 *   2. Search "App passwords" → create one for Mail
 *   GMAIL_USER=you@gmail.com
 *   GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
 */
import nodemailer from 'nodemailer'

let _transporter: nodemailer.Transporter | null = null

function getTransporter() {
  if (_transporter) return _transporter

  const user = process.env.GMAIL_USER!
  const pass = process.env.GMAIL_APP_PASSWORD!
  const smtpHost = process.env.SMTP_HOST
  const smtpPort = parseInt(process.env.SMTP_PORT ?? '465')

  if (smtpHost) {
    // Custom SMTP (for non-Gmail domains)
    _transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      requireTLS: smtpPort === 587,
      auth: { user, pass },
    })
  } else if (user.endsWith('@gmail.com') || user.endsWith('@googlemail.com')) {
    // Gmail with App Password
    _transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    })
  } else {
    throw new Error(
      `Custom domain detected (${user}). Please set SMTP_HOST in .env.local.\n` +
      'Get SMTP settings from your email hosting provider (cPanel, Zoho, Google Workspace, etc.)'
    )
  }

  return _transporter
}

export async function sendGmail(params: {
  to: string
  toName?: string
  subject: string
  body: string
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const transporter = getTransporter()
    const fromName  = process.env.SENDER_NAME  ?? 'Alex'
    const fromEmail = process.env.SENDER_EMAIL ?? process.env.GMAIL_USER!

    // CAN-SPAM / GDPR compliance: append unsubscribe footer
    const unsubEmail = fromEmail
    const footer = `\n\n---\nYou're receiving this because your brand was identified as a potential fit for our manufacturing services.\nTo opt out, reply with "unsubscribe" or email ${unsubEmail} directly.\nJojofashion | jojofashion.us`
    const bodyWithFooter = params.body + footer

    const info = await transporter.sendMail({
      from: `"${fromName}" <${fromEmail}>`,
      to: params.toName ? `"${params.toName}" <${params.to}>` : params.to,
      subject: params.subject,
      text: bodyWithFooter,
      headers: {
        'List-Unsubscribe': `<mailto:${unsubEmail}?subject=unsubscribe>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })

    console.log(`[Email] ✅ Sent to ${params.to} — MessageID: ${info.messageId}`)
    return { success: true, messageId: info.messageId }
  } catch (err) {
    console.error('[Email] ❌ Send failed:', err)
    return { success: false, error: String(err) }
  }
}

export function isGmailConfigured(): boolean {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD)
}
