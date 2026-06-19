/**
 * Unified customer event bus (Conversion OS P0).
 *
 * Every interaction / milestone / stage change is appended to `customer_events`.
 * Auto-emitted by actions/agents (email/reply/sample/quote/order/stage) and by
 * manual "record interaction". This is the single source for the customer timeline,
 * stage-change history, and (P1) relationship-band counts.
 *
 * logEvent NEVER throws into the caller — an event-logging failure must not break
 * the business action (sending mail, creating a sample, etc.).
 */
import { createDirectClient } from '@/lib/supabase/server'

export const EVENT_TYPES = [
  'email_out', 'email_in', 'whatsapp', 'call', 'meeting', 'exhibition', 'office_visit',
  'sample', 'quote', 'negotiation', 'po', 'payment', 'complaint', 'stage_change', 'note', 'task',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

/** Channels offered in the manual "记录互动" form (auto types like email/sample are emitted by the system). */
export const MANUAL_EVENT_TYPES: EventType[] = ['whatsapp', 'call', 'meeting', 'office_visit', 'exhibition', 'payment', 'complaint', 'note']

export const EVENT_LABELS: Record<EventType, string> = {
  email_out: '邮件(发)', email_in: '邮件(收)', whatsapp: 'WhatsApp', call: '电话',
  meeting: '会议', exhibition: '展会', office_visit: '拜访', sample: '样品',
  quote: '报价', negotiation: '议价', po: '订单/PO', payment: '收款',
  complaint: '投诉', stage_change: '阶段变更', note: '备注', task: '任务',
}

function channelForType(t: EventType): string {
  if (t === 'email_out' || t === 'email_in') return 'email'
  if (t === 'whatsapp') return 'whatsapp'
  if (t === 'call') return 'phone'
  if (t === 'meeting' || t === 'exhibition' || t === 'office_visit') return 'in_person'
  return 'system'
}

export interface LogEventInput {
  companyId: string
  dealId?: string | null
  contactId?: string | null
  eventType: EventType
  direction?: 'out' | 'in' | 'internal'
  channel?: string
  occurredAt?: string            // ISO; defaults to now
  title: string
  body?: string | null
  owner?: string | null
  source?: 'system' | 'manual'
  refTable?: string | null
  refId?: string | null
  metadata?: Record<string, unknown> | null
}

export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    const sb = createDirectClient()
    await sb.from('customer_events').insert({
      company_id:  input.companyId,
      deal_id:     input.dealId ?? null,
      contact_id:  input.contactId ?? null,
      event_type:  input.eventType,
      direction:   input.direction ?? null,
      channel:     input.channel ?? channelForType(input.eventType),
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      title:       input.title,
      body:        input.body ?? null,
      owner:       input.owner ?? null,
      source:      input.source ?? 'system',
      ref_table:   input.refTable ?? null,
      ref_id:      input.refId ?? null,
      metadata:    input.metadata ?? null,
    })
  } catch (err) {
    console.error('[logEvent] failed (non-fatal):', err)
  }
}
