'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { SendEmailAgent } from '@/agents/email/send-email-agent'
import { isGmailConfigured } from '@/lib/email/gmail'
import { loadActionStream } from '@/lib/sales/load-action-stream'
import { validateActionCard } from '@/lib/sales/execution-contract'
import type { ActionCard } from '@/lib/sales/action-card'
import { revalidatePath } from 'next/cache'

/**
 * Insert the OutreachLog (STAMPED with the strategy → this IS the derived
 * StrategyOutcomeLog) + fire the verified-gated send. Shared by single + bulk.
 * The strategyId in personalization_data is what loadStrategies reads back to
 * recompute effectiveness — closing the strategy learning loop.
 */
async function sendCard(sb: Awaited<ReturnType<typeof createServiceClient>>, card: ActionCard): Promise<void> {
  const { data: row } = await sb
    .from('outreach_logs')
    .insert({
      company_id: card.accountId,
      contact_id: card.contactId,
      channel: 'email',
      direction: 'outbound',
      subject: card.message.subject,
      body: card.message.body,
      status: 'approved',
      // Spec §6 — store the learning context on the log; causal attribution is
      // computed live from this + the derived outcome (load-strategies.ts). No new table.
      personalization_data: {
        strategyId: card.strategyId,
        wedge: card.wedge,
        cta: card.cta,
        tone: card.tone,
        expectedOutcome: card.expectedOutcome,
        situationVector: card.situationVector,
        strategyVectorSnapshot: card.strategyVector,
      },
    })
    .select('id')
    .single()
  if (row?.id) await new SendEmailAgent().execute({} as never, { outreachLogId: row.id as string }).catch((e) => console.error('[sendCard]', e))
}

/**
 * Approve & Send an Action Card. Closed loop: write OutreachLog → send via the
 * verified-gated SendEmailAgent (refuses guessed emails, throttles, records the
 * send, auto-schedules follow-ups so the outcome feeds back) → regenerate stream.
 * The (possibly edited) body is submitted from the card's textarea.
 */
export async function approveAndSendCard(formData: FormData): Promise<void> {
  const accountId = formData.get('accountId') as string
  const subject = ((formData.get('subject') as string) || '').trim()
  const body = ((formData.get('body') as string) || '').trim()
  if (!accountId) return
  // Never fake-send: refuse if email isn't configured (agent would simulate).
  if (!isGmailConfigured()) {
    console.warn('[approveAndSendCard] email not configured — refused (no fake-send)')
    return
  }
  // EXECUTION CONTRACT — reload the card (trusted server copy), apply the edited
  // message, and enforce validateActionCard. contactId/reachability/event come
  // from the server, NOT the client, so a blocked/invalid card can't be forced.
  const { stream, blocked } = await loadActionStream()
  const base = [...stream, ...blocked].find((c) => c.accountId === accountId)
  if (!base) {
    console.warn('[approveAndSendCard] card not found — refused')
    return
  }
  const card: ActionCard = { ...base, message: { subject, body } }
  const contract = validateActionCard(card)
  if (!contract.executable) {
    console.warn(`[approveAndSendCard] refused — not executable · flags=${contract.riskFlags.join(',')} · missing=${contract.missingFields.join(',')}`)
    return
  }
  await sendCard(await createServiceClient(), card)
  revalidatePath('/today')
}

/** Skip a card: require a reason, record it (learning signal) and defer 7 days (downgrades PO_SCORE via staleness/friction). */
export async function skipActionCard(formData: FormData): Promise<void> {
  const companyId = formData.get('accountId') as string
  const reason = ((formData.get('reason') as string) || '').trim()
  if (!companyId || !reason) return
  const sb = await createServiceClient()
  const deferTo = new Date(Date.now() + 7 * 86_400_000).toISOString()
  await sb.from('companies').update({ why_no_reply: reason, next_action_due: deferTo, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidatePath('/today')
}

/** Bulk-approve the LOW-risk lane. Regenerates cards server-side and sends each through the throttled agent. */
export async function bulkApproveLowRisk(): Promise<void> {
  if (!isGmailConfigured()) {
    console.warn('[bulkApproveLowRisk] email not configured — refused')
    return
  }
  const { lowRisk } = await loadActionStream()
  const sb = await createServiceClient()
  for (const c of lowRisk) {
    // Contract gate — bulk skips any card that isn't executable (never sends a broken card).
    if (!validateActionCard(c).executable) continue
    await sendCard(sb, c)
  }
  revalidatePath('/today')
}
