'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { SendEmailAgent } from '@/agents/email/send-email-agent'
import { isGmailConfigured } from '@/lib/email/gmail'
import { revalidatePath } from 'next/cache'

function revalidate(companyId: string) {
  for (const p of [`/companies/${companyId}`, '/today', '/command']) revalidatePath(p)
}

/** Discipline (V2): set the next action + due date so the lead never stalls (clears red flag). */
export async function setNextAction(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const text = (formData.get('nextAction') as string)?.trim()
  if (!companyId || !text) return
  const due = (formData.get('nextActionDue') as string)?.trim() || null
  const sb = await createServiceClient()
  await sb.from('companies').update({ next_action: text, next_action_due: due, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidate(companyId)
}

/** Learning loop (V2): record WHY there is no reply — accumulates real sales intelligence. */
export async function setWhyNoReply(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const reason = (formData.get('whyNoReply') as string)?.trim()
  if (!companyId || !reason) return
  const sb = await createServiceClient()
  await sb.from('companies').update({ why_no_reply: reason, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidate(companyId)
}

/**
 * Execution OS (V3): approve a pre-generated draft → SEND it. Routes through the
 * safe SendEmailAgent — verified-email-gated (refuses guesses → no bounces),
 * warmup-throttled, records the send, and auto-schedules the follow-up cadence.
 * The human is the judgment gate; the system did the writing.
 */
export async function approveAndSend(formData: FormData): Promise<void> {
  const outreachLogId = formData.get('outreachLogId') as string
  if (!outreachLogId) return
  // Safeguard: if email isn't configured, REFUSE — never let SendEmailAgent
  // silently "simulate" a send (which would mark the draft sent + schedule
  // follow-ups without an email ever leaving). False funnel state is worse than
  // a no-op. Real send only when SMTP/Gmail env is actually populated.
  if (!isGmailConfigured()) { console.warn('[approveAndSend] email not configured — refused (no fake-send)'); return }
  await new SendEmailAgent().execute({} as never, { outreachLogId }).catch((e) => console.error('[approveAndSend]', e))
  revalidatePath('/approve'); revalidatePath('/today')
}

/** Skip a draft → off the approve queue (back to 'draft'), with no send. */
export async function skipDraft(formData: FormData): Promise<void> {
  const outreachLogId = formData.get('outreachLogId') as string
  if (!outreachLogId) return
  const sb = await createServiceClient()
  await sb.from('outreach_logs').update({ status: 'draft' }).eq('id', outreachLogId)
  revalidatePath('/approve')
}
