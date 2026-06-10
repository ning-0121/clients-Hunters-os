import nodemailer from 'nodemailer'

async function main() {
  const user = process.env.GMAIL_USER!
  const pass = process.env.GMAIL_APP_PASSWORD!
  const host = process.env.SMTP_HOST ?? 'smtp.gmail.com'
  const port = parseInt(process.env.SMTP_PORT ?? '587')

  console.log(`[Test] Connecting to ${host}:${port} as ${user}`)

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
  })

  try {
    await transporter.verify()
    console.log('[Test] ✅ SMTP connection verified')

    const info = await transporter.sendMail({
      from: `"Alex" <${user}>`,
      to: user,
      subject: 'ARAOS Email Test ✅',
      text: 'This is a test email from the ARAOS system.\n\nIf you see this, Gmail sending is working!\n\nTalk soon,\nAlex\njojofashion.us',
    })

    console.log('[Test] ✅ Email sent! MessageID:', info.messageId)
  } catch (err) {
    console.error('[Test] ❌ Failed:', String(err))
  }
}

main()
