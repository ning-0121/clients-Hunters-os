/**
 * ACTION CARD — the only object /today renders. Generation now flows
 * Event → Strategy Selection → Action (Strategy OS): the selected StrategyUnit
 * decides the wedge/cta/tone and the message template; the event decides how to
 * respond. Message = fixed template + variable injection (no free-form AI).
 * No empty states; every card carries a strategy for closed-loop learning.
 */
import type { Opp } from '@/lib/sales/revenue-os'
import type { PoCard } from '@/lib/sales/po-score'
import { stageIndex, type FunnelStage } from '@/lib/sales/order-engine'
import {
  generateStrategyMessage,
  segmentLabel,
  expectedOutcomeFor,
  explainSelection,
  type StrategyUnit,
  type StrategyVector,
  type SituationVector,
  type Wedge,
  type Cta,
  type Tone,
  type StrategyResult,
} from '@/lib/sales/strategy'

export type ActionType =
  | 'reply_follow_up'
  | 'sample_request'
  | 'sample_follow_up'
  | 'quote_follow_up'
  | 'close_po'
  | 're_engagement'
export type Urgency = 'NOW' | 'TODAY' | 'SOON'
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH'
export type LatestEvent = 'reply_received' | 'sample_sent' | 'quote_sent' | 'no_response_48h' | 'positive_intent' | 'none'

export interface ActionCard {
  accountId: string
  companyName: string
  poScore: number
  poImpactUsd: number
  contact: { name: string; role: string; reachable: boolean }
  contactId: string | null // internal — required to execute the send
  actionType: ActionType
  urgency: Urgency
  whyNow: string
  message: { subject: string; body: string }
  nextStepPreview: string
  riskLevel: RiskLevel
  executePayload: { channel: 'email' | 'whatsapp'; prefilled: boolean }
  eventTrace: LatestEvent // event → action traceability
  // — Strategy OS (Feature 7): every card is attributed to a strategy —
  strategyId: string
  strategyName: string
  wedge: Wedge
  cta: Cta
  tone: Tone
  expectedOutcome: StrategyResult
  strategyVector: StrategyVector // V7 — snapshot of the selected strategy's causal vector
  situationVector: SituationVector // V7 — snapshot of the opportunity's situation vector
  whyStrategySelected: string // V7 — 1-line causal reason for this selection
  blocked: boolean // internal — no reachable contact → "Missing Contact" lane
}

export const ACTION_LABEL: Record<ActionType, string> = {
  reply_follow_up: '回复跟进',
  sample_request: '寄样',
  sample_follow_up: '样品跟进',
  quote_follow_up: '报价跟进',
  close_po: '促成 PO',
  re_engagement: '重新触达',
}

/** Detect the latest meaningful event from existing DB-derived signals. */
export function detectEvent(o: Opp): LatestEvent {
  if (o.poDiscussionActive || o.stage === 'trial_order' || o.stage === 'scale_order') return 'positive_intent'
  if (o.quoteSentAgeDays != null || o.stage === 'quotation') return 'quote_sent'
  if (o.sampleSentAgeDays != null || o.stage === 'sample_sent') return 'sample_sent'
  if (o.replyAgeDays != null || o.stage === 'replied' || o.stage === 'sample_requested') return 'reply_received'
  if ((o.outreachSentAgeDays ?? 0) >= 2) return 'no_response_48h'
  return 'none'
}

/** actionType = map(strategy.wedge, event). A live customer event dominates;
 *  otherwise the strategy's wedge decides the opener. */
export function actionTypeFromStrategy(wedge: Wedge, ev: LatestEvent, stage: FunnelStage): ActionType {
  if (stage === 'sample_requested') return 'sample_request'
  switch (ev) {
    case 'reply_received':
      return 'reply_follow_up'
    case 'sample_sent':
      return 'sample_follow_up'
    case 'quote_sent':
      return 'quote_follow_up'
    case 'positive_intent':
      return 'close_po'
    default:
      break
  }
  switch (wedge) {
    case 'sample_first':
      return 'sample_request'
    case 'quote_first':
      return 'quote_follow_up'
    case 'follow_up':
    case 'cold_email':
      return 're_engagement'
  }
}

function urgencyFor(o: Opp): Urgency {
  if (o.poDiscussionActive || o.stage === 'trial_order' || o.stage === 'scale_order') return 'NOW'
  if (o.stage === 'sample_requested') return 'NOW'
  if (o.replyAgeDays != null && o.replyAgeDays < 7) return 'NOW'
  if (o.quoteSentAgeDays != null && o.quoteSentAgeDays > 30) return 'NOW'
  if (o.replyAgeDays != null || o.sampleSentAgeDays != null || o.quoteSentAgeDays != null) return 'TODAY'
  if ((o.outreachSentAgeDays ?? 0) >= 2) return 'TODAY'
  return 'SOON'
}

function riskFor(o: Opp): RiskLevel {
  if (o.reachability === 'R3') return 'HIGH'
  if (o.reachability === 'R2') return 'MEDIUM'
  if ((o.outreachSentAgeDays ?? 0) > 30 || (o.replyAgeDays ?? 0) > 30) return 'MEDIUM'
  return 'LOW'
}

function whyNowFor(o: Opp, ev: LatestEvent): string {
  switch (ev) {
    case 'positive_intent':
      return '买入信号活跃 → 直接推 PO（临门一脚）'
    case 'quote_sent':
      return o.quoteSentAgeDays != null && o.quoteSentAgeDays > 30
        ? `报价已过期 ${o.quoteSentAgeDays} 天 → 更新重报`
        : `已报价${o.quoteSentAgeDays != null ? ` ${o.quoteSentAgeDays} 天` : ''} → 逼向试单`
    case 'sample_sent':
      return `样品已寄${o.sampleSentAgeDays != null ? ` ${o.sampleSentAgeDays} 天` : ''}，无反馈 → 追反馈`
    case 'reply_received':
      return o.stage === 'sample_requested'
        ? '客户主动要样，正在等你 → 立即寄样'
        : `已回复${o.replyAgeDays != null ? ` ${o.replyAgeDays} 天` : ''} → 趁热提样品`
    case 'no_response_48h':
      return `已触达${o.outreachSentAgeDays != null ? ` ${o.outreachSentAgeDays} 天` : ''}无回复 → 换钩子再跟`
    default:
      return '已定位未触达 → 发首封开发信'
  }
}

const MAX_STAGE = stageIndex('scale_order')

/** Build the opportunity's situation vector (spec §C — cosine strategy matching). */
export function buildSituation(o: Opp): SituationVector {
  const u = urgencyFor(o)
  const urgency = u === 'NOW' ? 1 : u === 'TODAY' ? 0.6 : 0.3
  const contactStrength = o.reachability === 'R1' ? 1 : o.reachability === 'R2' ? 0.5 : 0
  const engagement = Math.min(1, Math.max(0, stageIndex(o.stage) / MAX_STAGE))
  return { urgency, contactStrength, engagement }
}

/** Build the single executable Action Card. Event → strategy (vector match) → action. */
export function toActionCard(o: Opp, card: PoCard, strategy: StrategyUnit, situation: SituationVector): ActionCard {
  const ev = detectEvent(o)
  const at = actionTypeFromStrategy(strategy.wedge, ev, o.stage)
  const firstName = (o.dmName || 'there').trim().split(/\s+/)[0]
  const msg = generateStrategyMessage(strategy, {
    name: firstName,
    company: o.brand,
    product_type: 'activewear',
    segmentLabel: segmentLabel(strategy.segment),
  })
  return {
    accountId: o.companyId,
    companyName: o.brand,
    poScore: card.poScore,
    poImpactUsd: card.estimatedPoImpact,
    contact: { name: o.dmName || '（无联系人）', role: o.dmRole || 'unknown', reachable: o.reachability === 'R1' },
    contactId: o.dmContactId ?? null,
    actionType: at,
    urgency: urgencyFor(o),
    whyNow: whyNowFor(o, ev),
    message: msg,
    nextStepPreview: card.nextActionChain[1] ?? card.nextActionChain[0] ?? '',
    riskLevel: riskFor(o),
    executePayload: { channel: 'email', prefilled: true },
    eventTrace: ev,
    strategyId: strategy.id,
    strategyName: strategy.name,
    wedge: strategy.wedge,
    cta: strategy.cta,
    tone: strategy.tone,
    expectedOutcome: expectedOutcomeFor[strategy.cta],
    strategyVector: strategy.vector,
    situationVector: situation,
    whyStrategySelected: explainSelection(strategy, situation),
    blocked: card.blocked,
  }
}
