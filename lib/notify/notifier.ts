/**
 * Notifications — alert the team on high-value events.
 *
 * Channels (all optional, configured via .env.local):
 *   SLACK_WEBHOOK_URL   — Slack incoming webhook
 *   NOTIFY_EMAIL        — email address to receive alerts (sent via Gmail transport)
 *
 * If neither is set, notifications are logged to console only (safe no-op).
 */

import { sendGmail, isGmailConfigured } from '@/lib/email/gmail'

export interface NotifyParams {
  title: string
  body: string
  url?: string         // deep link (relative or absolute)
  priority?: 'high' | 'normal'
}

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3001'
}

async function notifySlack(p: NotifyParams): Promise<void> {
  const hook = process.env.SLACK_WEBHOOK_URL
  if (!hook) return
  const link = p.url ? (p.url.startsWith('http') ? p.url : `${appBaseUrl()}${p.url}`) : null
  const text = `${p.priority === 'high' ? ':rotating_light: ' : ''}*${p.title}*\n${p.body}${link ? `\n<${link}|Open in ARAOS>` : ''}`
  try {
    await fetch(hook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  } catch (err) {
    console.error('[Notify] Slack error:', err)
  }
}

async function notifyEmail(p: NotifyParams): Promise<void> {
  const to = process.env.NOTIFY_EMAIL
  if (!to || !isGmailConfigured()) return
  const link = p.url ? (p.url.startsWith('http') ? p.url : `${appBaseUrl()}${p.url}`) : null
  try {
    await sendGmail({
      to,
      subject: `[ARAOS] ${p.title}`,
      body: `${p.body}${link ? `\n\nOpen: ${link}` : ''}`,
    })
  } catch (err) {
    console.error('[Notify] Email error:', err)
  }
}

/** Fire a notification across all configured channels. Never throws. */
export async function notify(p: NotifyParams): Promise<void> {
  console.log(`[Notify] ${p.priority === 'high' ? '🚨 ' : ''}${p.title} — ${p.body}`)
  await Promise.allSettled([notifySlack(p), notifyEmail(p)])
}
