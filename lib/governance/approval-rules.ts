import type { Grade, ApprovalLevel } from '@/types'

export interface ActionContext {
  grade?: Grade
  channel?: string
  sampleValue?: number
  dealValue?: number
  discount?: number
  followupCount?: number
  noReplyDays?: number
  isScheduled?: boolean
}

interface GovernanceRule {
  action: string
  condition: (ctx: ActionContext) => boolean
}

export const L1_AUTO: GovernanceRule[] = [
  { action: 'enrich_contact',     condition: () => true },
  { action: 'score_company',      condition: () => true },
  { action: 'discovery_run',      condition: (c) => !!c.isScheduled },
  { action: 'email_first_touch',  condition: (c) => c.grade !== 'A' },
  { action: 'linkedin_connect',   condition: (c) => c.grade !== 'A' },
  { action: 'email_followup',     condition: (c) => (c.followupCount ?? 0) <= 3 && c.grade !== 'A' },
  { action: 'linkedin_followup',  condition: (c) => (c.followupCount ?? 0) <= 2 && c.grade !== 'A' },
  { action: 'mark_lost',          condition: (c) => (c.noReplyDays ?? 0) > 30 && c.grade === 'C' },
]

export const L2_SALES: GovernanceRule[] = [
  { action: 'whatsapp_first_touch', condition: () => true },
  { action: 'catalog_send',         condition: () => true },
  { action: 'instagram_dm',         condition: () => true },
  { action: 'meeting_invite',       condition: (c) => c.grade !== 'A' },
  { action: 'sample_offer',         condition: (c) => (c.sampleValue ?? 0) < 500 && c.grade !== 'A' },
  { action: 'quote_draft',          condition: (c) => (c.dealValue ?? 0) < 10000 },
  { action: 'email_first_touch',    condition: (c) => c.grade === 'A' },
]

export const L3_BOSS: GovernanceRule[] = [
  { action: 'special_price',      condition: (c) => (c.discount ?? 0) > 10 },
  { action: 'payment_terms',      condition: () => true },
  { action: 'large_sample',       condition: (c) => (c.sampleValue ?? 0) >= 500 },
  { action: 'exclusive_deal',     condition: () => true },
  { action: 'nda_sign',           condition: () => true },
  { action: 'vip_first_touch',    condition: (c) => c.grade === 'A' },
  { action: 'quote_draft',        condition: (c) => (c.dealValue ?? 0) >= 10000 },
  { action: 'mark_lost',          condition: (c) => c.grade === 'A' },
]

export function getApprovalLevel(action: string, ctx: ActionContext): ApprovalLevel {
  const matchesL3 = L3_BOSS.find((r) => r.action === action && r.condition(ctx))
  if (matchesL3) return 'L3'

  const matchesL2 = L2_SALES.find((r) => r.action === action && r.condition(ctx))
  if (matchesL2) return 'L2'

  return 'L1'
}

export function canAutoExecute(action: string, ctx: ActionContext): boolean {
  return getApprovalLevel(action, ctx) === 'L1'
}
