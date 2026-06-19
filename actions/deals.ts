'use server'

import { createDirectClient } from '@/lib/supabase/server'
import { getBdIdentity } from '@/lib/bd/shared'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  checkStageGate, defaultWinProb, STAGE_LABELS, type DealStage,
} from '@/lib/deals/stage'
import { logEvent, type EventType } from '@/lib/events/log'

type Row = Record<string, unknown>
const str = (fd: FormData, k: string) => ((fd.get(k) as string) ?? '').trim()
const num = (fd: FormData, k: string) => { const v = str(fd, k); return v === '' ? null : Number(v) }

/** Create a deal (from the company page; may be pre-filled by an AI suggestion the salesperson confirmed). */
export async function createDeal(formData: FormData): Promise<void> {
  const companyId = str(formData, 'companyId')
  const title = str(formData, 'title')
  if (!companyId || !title) redirect(`/companies/${companyId}?dealError=title`)
  const stage = (str(formData, 'stage') || 'lead') as DealStage
  const { who } = await getBdIdentity()
  const owner = str(formData, 'owner') || (who && who !== 'me' ? who : null)

  const sb = createDirectClient()
  const { data: deal, error } = await sb.from('deals').insert({
    company_id: companyId,
    title,
    stage,
    stage_entered_at: new Date().toISOString(),
    status: 'open',
    owner,
    product_category: str(formData, 'product_category') || null,
    qty: num(formData, 'qty'),
    est_value_usd: num(formData, 'est_value_usd'),
    expected_close_date: str(formData, 'expected_close_date') || null,
    win_prob: defaultWinProb(stage),
    champion_contact_id: str(formData, 'champion_contact_id') || null,
    decision_maker_contact_id: str(formData, 'decision_maker_contact_id') || null,
  }).select('id').single()
  if (error || !deal?.id) redirect(`/companies/${companyId}?dealError=create`)

  await logEvent({
    companyId, dealId: deal!.id, eventType: 'stage_change', direction: 'internal',
    title: `创建机会「${title}」· 阶段 ${STAGE_LABELS[stage]}`, owner: owner ?? undefined, source: 'manual',
    metadata: { from: null, to: stage },
  })
  revalidatePath(`/companies/${companyId}`)
  redirect(`/deals/${deal!.id}?created=1`)
}

/**
 * Set a deal's stage (advance or manual adjust), enforcing the gates:
 *  - replied+ key stages require Owner + Next Action + Due Date
 *  - won requires Annual Potential ; lost requires Lost Reason
 * Inline gate fields may be passed on the form to satisfy the gate in one step.
 */
export async function setDealStage(formData: FormData): Promise<void> {
  const dealId = str(formData, 'dealId')
  const target = str(formData, 'stage') as DealStage
  if (!dealId || !target) return
  const sb = createDirectClient()
  const { data: deal } = await sb.from('deals').select('*').eq('id', dealId).single()
  if (!deal) return
  const d = deal as Row

  // Merge any inline-provided gate fields with existing values.
  const owner = str(formData, 'owner') || (d.owner as string) || null
  const nextAction = str(formData, 'next_action') || (d.next_action as string) || null
  const nextDue = str(formData, 'next_action_due_at') || (d.next_action_due_at as string) || null
  const annual = num(formData, 'annual_potential_usd') ?? (d.annual_potential_usd as number | null)
  const lostReason = str(formData, 'lost_reason') || (d.lost_reason as string) || null

  const gate = checkStageGate(target, {
    owner, next_action: nextAction, next_action_due_at: nextDue,
    annual_potential_usd: annual, lost_reason: lostReason,
  })
  if (!gate.ok) redirect(`/deals/${dealId}?error=${encodeURIComponent(gate.error!)}`)

  // win_prob: track the stage default UNTIL the salesperson overrides it.
  const oldStage = d.stage as DealStage
  const curProb = d.win_prob as number | null
  const winProb = (curProb == null || curProb === defaultWinProb(oldStage)) ? defaultWinProb(target) : curProb

  const status = target === 'won' ? 'won' : target === 'lost' ? 'lost' : 'open'
  await sb.from('deals').update({
    stage: target,
    stage_entered_at: new Date().toISOString(),
    status,
    owner, next_action: nextAction, next_action_due_at: nextDue,
    annual_potential_usd: annual, lost_reason: target === 'lost' ? lostReason : (d.lost_reason ?? null),
    win_prob: winProb,
    closed_at: status === 'open' ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', dealId)

  await logEvent({
    companyId: d.company_id as string, dealId, eventType: 'stage_change', direction: 'internal',
    title: `阶段 ${STAGE_LABELS[oldStage]} → ${STAGE_LABELS[target]}`, owner: owner ?? undefined, source: 'manual',
    metadata: { from: oldStage, to: target, lost_reason: target === 'lost' ? lostReason : undefined, annual_potential_usd: target === 'won' ? annual : undefined },
  })
  revalidatePath(`/deals/${dealId}`)
  revalidatePath(`/companies/${d.company_id}`)
  redirect(`/deals/${dealId}`)
}

/** Set / edit a deal's Next Action (owner + action + due). */
export async function setDealNextAction(formData: FormData): Promise<void> {
  const dealId = str(formData, 'dealId')
  if (!dealId) return
  const sb = createDirectClient()
  const { data: deal } = await sb.from('deals').select('company_id, owner').eq('id', dealId).single()
  const { who } = await getBdIdentity()
  await sb.from('deals').update({
    next_action: str(formData, 'next_action') || null,
    next_action_due_at: str(formData, 'next_action_due_at') || null,
    owner: str(formData, 'owner') || (deal?.owner as string) || (who && who !== 'me' ? who : null),
    updated_at: new Date().toISOString(),
  }).eq('id', dealId)
  revalidatePath(`/deals/${dealId}`)
  if (deal?.company_id) revalidatePath(`/companies/${deal.company_id}`)
}

/** Edit deal economics / roles (value, close date, win%, category, qty, champion, decision maker, title). */
export async function updateDeal(formData: FormData): Promise<void> {
  const dealId = str(formData, 'dealId')
  if (!dealId) return
  const sb = createDirectClient()
  const { data: deal } = await sb.from('deals').select('company_id').eq('id', dealId).single()
  const patch: Row = { updated_at: new Date().toISOString() }
  const title = str(formData, 'title'); if (title) patch.title = title
  patch.est_value_usd = num(formData, 'est_value_usd')
  patch.expected_close_date = str(formData, 'expected_close_date') || null
  const wp = num(formData, 'win_prob'); if (wp != null) patch.win_prob = Math.max(0, Math.min(100, wp))
  patch.product_category = str(formData, 'product_category') || null
  patch.qty = num(formData, 'qty')
  patch.champion_contact_id = str(formData, 'champion_contact_id') || null
  patch.decision_maker_contact_id = str(formData, 'decision_maker_contact_id') || null
  await sb.from('deals').update(patch).eq('id', dealId)
  revalidatePath(`/deals/${dealId}`)
  if (deal?.company_id) revalidatePath(`/companies/${deal.company_id}`)
}

/** Manually record an interaction (offline channels: WhatsApp / call / meeting / visit / exhibition / payment / complaint / note). */
export async function recordInteraction(formData: FormData): Promise<void> {
  const companyId = str(formData, 'companyId')
  const eventType = str(formData, 'event_type') as EventType
  const title = str(formData, 'title')
  if (!companyId || !eventType || !title) return
  const { who } = await getBdIdentity()
  await logEvent({
    companyId,
    dealId: str(formData, 'deal_id') || null,
    contactId: str(formData, 'contact_id') || null,
    eventType,
    direction: (str(formData, 'direction') as 'out' | 'in' | 'internal') || 'out',
    occurredAt: str(formData, 'occurred_at') ? new Date(str(formData, 'occurred_at')).toISOString() : undefined,
    title,
    body: str(formData, 'body') || null,
    owner: who && who !== 'me' ? who : undefined,
    source: 'manual',
  })
  revalidatePath(`/companies/${companyId}`)
  const dealId = str(formData, 'deal_id')
  if (dealId) revalidatePath(`/deals/${dealId}`)
}
