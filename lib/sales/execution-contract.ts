/**
 * ACTION EXECUTION CONTRACT — the deterministic safety gate between a card that
 * is valid for RANKING and a card that is safe to EXECUTE. Pure function, no I/O.
 *
 *   executable    → safe for a human-approved send (all send-critical fields present)
 *   allowAutoSend → safe for UNATTENDED send (stricter: warm event + LOW risk + fully traced)
 *
 * Enforced server-side in actions/action-stream.ts so the client cannot bypass it.
 */
import type { ActionCard, LatestEvent } from '@/lib/sales/action-card'

export type ExecutionRiskFlag = 'NO_CONTACT' | 'NO_MESSAGE' | 'NO_EVENT_TRACE' | 'NO_NEXT_STEP'

export interface ExecutionContract {
  executable: boolean
  missingFields: string[]
  riskFlags: ExecutionRiskFlag[]
  allowAutoSend: boolean
}

// A card may auto-send (no human) only when it was triggered by a real, warm
// customer event — never for cold openers / silent re-engagement.
const AUTO_SEND_EVENTS: LatestEvent[] = ['reply_received', 'sample_sent', 'quote_sent', 'positive_intent']

const nonEmpty = (s?: string | null) => !!s && s.trim().length > 0

export function validateActionCard(card: ActionCard): ExecutionContract {
  // 1. Completeness — every field required to execute must be present.
  const missingFields: string[] = []
  const need = (ok: boolean, field: string) => { if (!ok) missingFields.push(field) }
  need(nonEmpty(card.accountId), 'accountId')
  need(nonEmpty(card.companyName), 'companyName')
  need(nonEmpty(card.contactId), 'contactId')
  need(nonEmpty(card.contact?.name) && card.contact?.name !== '（无联系人）', 'contact.name')
  need(nonEmpty(card.message?.subject), 'message.subject')
  need(nonEmpty(card.message?.body), 'message.body')
  need(nonEmpty(card.actionType), 'actionType')
  need(nonEmpty(card.urgency), 'urgency')
  need(nonEmpty(card.nextStepPreview), 'nextStepPreview')
  need(nonEmpty(card.eventTrace), 'eventTrace')
  need(nonEmpty(card.strategyId), 'strategyId') // Strategy OS — every card must be attributed
  need(nonEmpty(card.whyStrategySelected), 'whyStrategySelected') // V7 — no card without causal traceability

  // 2. Risk flags — deterministic hazards, independent of missing fields.
  const riskFlags: ExecutionRiskFlag[] = []
  if (!nonEmpty(card.contactId) || !card.contact?.reachable || card.blocked) riskFlags.push('NO_CONTACT')
  if (!nonEmpty(card.message?.subject) || !nonEmpty(card.message?.body)) riskFlags.push('NO_MESSAGE')
  if (!nonEmpty(card.eventTrace)) riskFlags.push('NO_EVENT_TRACE')
  if (!nonEmpty(card.nextStepPreview)) riskFlags.push('NO_NEXT_STEP')

  // 3. executable — safe for human-approved send: send-critical fields + no send-blocking risk.
  const executable = missingFields.length === 0 && !riskFlags.includes('NO_CONTACT') && !riskFlags.includes('NO_MESSAGE')

  // 4. allowAutoSend — safe WITHOUT human review: stricter (no risk flags at all,
  //    LOW risk, reachable, and mapped from a real warm event).
  const allowAutoSend =
    executable &&
    riskFlags.length === 0 &&
    card.riskLevel === 'LOW' &&
    !!card.contact?.reachable &&
    AUTO_SEND_EVENTS.includes(card.eventTrace)

  return { executable, missingFields, riskFlags, allowAutoSend }
}
