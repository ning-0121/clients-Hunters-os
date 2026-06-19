/**
 * Deal (opportunity) stage model — pure, no I/O. Conversion OS P0.
 *
 * Stages live on the DEAL, not the Company. Account level (prospect / active /
 * key / strategic) is independent and never enters this flow.
 */
export type DealStage =
  | 'lead' | 'contacted' | 'replied' | 'sample' | 'quotation'
  | 'negotiation' | 'trial_order' | 'won' | 'lost'

/** Forward progression order (lost is terminal, off-order). */
export const STAGE_ORDER: DealStage[] = [
  'lead', 'contacted', 'replied', 'sample', 'quotation', 'negotiation', 'trial_order', 'won',
]

export const STAGE_LABELS: Record<DealStage, string> = {
  lead: 'Lead', contacted: 'Contacted', replied: 'Replied', sample: 'Sample',
  quotation: 'Quotation', negotiation: 'Negotiation', trial_order: 'Trial Order',
  won: 'Won', lost: 'Lost',
}

/** Initial win probability by stage (% ; sales may override per deal). */
export const STAGE_DEFAULT_WIN_PROB: Record<DealStage, number> = {
  lead: 5, contacted: 10, replied: 20, sample: 30, quotation: 40,
  negotiation: 60, trial_order: 85, won: 100, lost: 0,
}

/** From Replied onward, a deal must carry Owner + Next Action + Due Date. */
export const KEY_STAGES: ReadonlySet<DealStage> = new Set<DealStage>([
  'replied', 'sample', 'quotation', 'negotiation', 'trial_order',
])

export const LOST_REASONS = ['price', 'payment_terms', 'lead_time', 'competitor', 'no_response', 'moq', 'compliance', 'other'] as const
export type LostReason = (typeof LOST_REASONS)[number]
export const LOST_REASON_LABELS: Record<LostReason, string> = {
  price: '价格', payment_terms: '付款方式', lead_time: '交期', competitor: '竞争对手',
  no_response: '无反馈', moq: '起订量', compliance: '合规/认证', other: '其他',
}

export const ACCOUNT_STATUSES = ['prospect', 'active_customer', 'key_account', 'strategic_account'] as const
export const RELATIONSHIP_BANDS = ['cold', 'warm', 'hot', 'champion', 'dormant', 'risk'] as const

export const isKeyStage = (s: DealStage) => KEY_STAGES.has(s)
export const defaultWinProb = (s: DealStage) => STAGE_DEFAULT_WIN_PROB[s] ?? 0
export const stageIndex = (s: DealStage) => STAGE_ORDER.indexOf(s)
export function nextStage(s: DealStage): DealStage | null {
  const i = stageIndex(s)
  return i >= 0 && i < STAGE_ORDER.length - 1 ? STAGE_ORDER[i + 1] : null
}

/** What a deal must have for a given target stage. Pure. */
export interface DealGateInput {
  owner?: string | null
  next_action?: string | null
  next_action_due_at?: string | null
  lost_reason?: string | null
  annual_potential_usd?: number | null
}

export interface GateResult { ok: boolean; error?: string }

/**
 * Can a deal enter/stay in `target`? Enforces:
 *  - key stages (replied+) need Owner + Next Action + Due Date
 *  - won needs Annual Potential
 *  - lost needs Lost Reason
 */
export function checkStageGate(target: DealStage, d: DealGateInput): GateResult {
  if (isKeyStage(target)) {
    const missing: string[] = []
    if (!d.owner?.trim()) missing.push('Owner')
    if (!d.next_action?.trim()) missing.push('Next Action')
    if (!d.next_action_due_at) missing.push('Due Date')
    if (missing.length) return { ok: false, error: `进入「${STAGE_LABELS[target]}」需先填写：${missing.join(' / ')}` }
  }
  if (target === 'won' && d.annual_potential_usd == null) {
    return { ok: false, error: '标记 Won 必须填写「预计年采购额」(Annual Potential)' }
  }
  if (target === 'lost' && !d.lost_reason?.trim()) {
    return { ok: false, error: '标记 Lost 必须选择「流失原因」(Lost Reason)' }
  }
  return { ok: true }
}
