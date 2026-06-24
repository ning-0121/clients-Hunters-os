/**
 * Revenue OS — the engine behind the Daily Revenue Command Center.
 * Not a CRM. Three pure computations over data we already have:
 *   1) Money List  — rank opps by  PO Probability × PO Value × Time Sensitivity
 *   2) Leak Center — opps bleeding revenue; Lost Opportunity Cost = Value × RiskOfLoss
 *   3) Forecast    — conservative / expected / aggressive 90-day revenue
 * Every output exists only to create, accelerate, or protect a PO.
 */
import { followUpDue, nextCadenceDay, type FunnelStage } from '@/lib/sales/order-engine'

// ── PO probability by funnel stage (all-time conversion to a PO from here) ────
export const PO_PROB: Record<FunnelStage, number> = {
  discovered: 0.01, contact_captured: 0.03, outreach_sent: 0.05, replied: 0.18,
  sample_requested: 0.30, sample_sent: 0.38, quotation: 0.52, trial_order: 0.85, scale_order: 0.95,
}
// P(a PO actually lands within the next 90 days from this stage) — used for forecast.
export const PO_PROB_90D: Record<FunnelStage, number> = {
  discovered: 0.005, contact_captured: 0.02, outreach_sent: 0.03, replied: 0.12,
  sample_requested: 0.22, sample_sent: 0.30, quotation: 0.45, trial_order: 0.70, scale_order: 0.80,
}

// ── 3-color development class (kills "fake-A": value without reachability) ────
export type Potential = 'P1' | 'P2' | 'P3' | 'P0'
export type Reachability = 'R1' | 'R2' | 'R3'   // R1 verified DM · R2 contact unverified · R3 none
export type DevClass = 'develop' | 'fill_contact' | 'drop'
export const DEV_CLASS: Record<DevClass, { label: string; dot: string }> = {
  develop: { label: '开发', dot: '🟢' },
  fill_contact: { label: '补联系人', dot: '🟡' },
  drop: { label: '放弃', dot: '⚫' },
}
/** Salesperson sees only 3 colors. P0/P3 → drop; worth-it depends on reachability. */
export function devClass(p: Potential, r: Reachability): DevClass {
  if (p === 'P0' || p === 'P3') return 'drop'
  return r === 'R1' ? 'develop' : 'fill_contact'
}

export interface Opp {
  companyId: string
  brand: string
  stage: FunnelStage
  poValueUsd: number              // estimated order value
  founder: boolean                // a founder/DM is engaged
  dmName?: string | null          // who to contact (best reachable DM)
  potential?: Potential
  reachability?: Reachability
  klass?: DevClass                // 🟢开发 / 🟡补联系人 / ⚫放弃
  ownerAssigned: boolean
  owner?: string | null             // assigned salesperson (for manager rep-health)
  hasNextAction: boolean
  nextActionDueAt?: string | null   // V2: manual due date (null = no due → red)
  whyNoReply?: string | null        // V2: recorded reason a lead went silent
  // time signals (days; null = n/a)
  replyAgeDays: number | null     // age of an unanswered inbound reply
  outreachSentAgeDays?: number | null  // days since last outreach (drives follow-up cadence)
  sampleSentAgeDays: number | null
  sampleHasFeedback: boolean
  quoteSentAgeDays: number | null
  quoteFollowedUp: boolean
  poDiscussionActive: boolean
}

// ── PO value estimate (no new schema — derived from scale/revenue/price) ──────
export function estimatePoValue(c: { customerScaleScore?: number | null; estimatedAnnualRevenue?: string | null; pricePoint?: string | null }): number {
  const scale = c.customerScaleScore ?? null
  let base = scale != null ? (scale >= 8 ? 400_000 : scale >= 6 ? 200_000 : scale >= 4 ? 100_000 : 50_000) : null
  if (base == null) {
    const r = (c.estimatedAnnualRevenue ?? '').toLowerCase()
    base = /b|billion/.test(r) ? 500_000 : /\d{3,}m/.test(r) ? 300_000 : /\d{2}m/.test(r) ? 150_000 : /\dm|\d{3,}k/.test(r) ? 80_000 : 60_000
  }
  const pp = (c.pricePoint ?? '').toLowerCase()
  const mult = pp.includes('premium') || pp.includes('luxury') ? 1.3 : pp.includes('budget') ? 0.8 : 1.0
  return Math.round(base * mult)
}

// ── ① Money List score = PO Probability × PO Value × Time Sensitivity ─────────
export function poProbability(o: Opp): number {
  let p = PO_PROB[o.stage]
  if (o.founder) p = Math.min(0.97, p * 1.3)
  return p
}

/** Time Sensitivity = the cost of waiting. >1 means "acting today matters". */
export function timeSensitivity(o: Opp): number {
  let t = 1.0
  if (o.poDiscussionActive) t = Math.max(t, 1.4)
  if (o.replyAgeDays != null && o.replyAgeDays >= 1) t = Math.max(t, 1.6)        // unanswered reply bleeding
  else if (o.replyAgeDays != null) t = Math.max(t, 1.4)                          // fresh reply, act today
  if (o.quoteSentAgeDays != null && !o.quoteFollowedUp) t = Math.max(t, o.quoteSentAgeDays >= 14 ? 1.5 : o.quoteSentAgeDays >= 7 ? 1.4 : 1.2)
  if (o.sampleSentAgeDays != null && !o.sampleHasFeedback && o.sampleSentAgeDays >= 3) t = Math.max(t, o.sampleSentAgeDays >= 7 ? 1.4 : 1.3)
  // A follow-up coming due (Day 4/9/15/30) is a reply-rate lever → push it up.
  if (o.stage === 'outreach_sent' && o.outreachSentAgeDays != null && followUpDue(o.outreachSentAgeDays)) t = Math.max(t, 1.4)
  return t
}

export interface MoneyRow { o: Opp; prob: number; value: number; timeSens: number; score: number; urgency: 'hot' | 'soon' | 'normal'; action: string; reason: string }

export function moneyRow(o: Opp): MoneyRow {
  const prob = poProbability(o)
  const timeSens = timeSensitivity(o)
  const score = Math.round(prob * o.poValueUsd * timeSens)
  const urgency: MoneyRow['urgency'] = timeSens >= 1.5 ? 'hot' : timeSens >= 1.3 ? 'soon' : 'normal'
  return { o, prob, value: o.poValueUsd, timeSens, score, urgency, action: recommendedAction(o), reason: reasonFor(o) }
}

function reasonFor(o: Opp): string {
  if (o.poDiscussionActive) return 'PO 谈判进行中'
  if (o.replyAgeDays != null) return o.replyAgeDays >= 1 ? `${o.founder ? '创始人' : '对方'}回复 ${o.replyAgeDays} 天未处理` : `${o.founder ? '创始人' : '对方'}今天回复`
  if (o.quoteSentAgeDays != null && !o.quoteFollowedUp) return `报价已发 ${o.quoteSentAgeDays} 天无跟进`
  if (o.sampleSentAgeDays != null && !o.sampleHasFeedback) return `样品已寄 ${o.sampleSentAgeDays} 天无反馈`
  if (o.stage === 'outreach_sent' && o.outreachSentAgeDays != null) {
    const due = followUpDue(o.outreachSentAgeDays)
    return due ? `${due.label}到期（发信 ${o.outreachSentAgeDays} 天无回复）` : `已发信 ${o.outreachSentAgeDays} 天，等回复`
  }
  if (o.stage === 'quotation') return '报价中'
  if (o.stage === 'sample_sent') return '样品已寄'
  if (o.stage === 'replied') return '已回复'
  return '待推进'
}

export function recommendedAction(o: Opp): string {
  if (o.poDiscussionActive) return '确认 MOQ + 条款 → 今天开 PO'
  if (o.replyAgeDays != null) return '立刻回复 → 直接提样品, 要收件地址'
  if (o.quoteSentAgeDays != null && !o.quoteFollowedUp) return '跟进报价 / 处理异议 (无回邮就打电话)'
  if (o.sampleSentAgeDays != null && !o.sampleHasFeedback) return '催样品反馈 → 推报价'
  if (o.stage === 'sample_requested') return '确认地址 + 寄样'
  if (o.stage === 'replied') return '24h 内回复 → 提样品'
  if (o.stage === 'outreach_sent' && o.outreachSentAgeDays != null) {
    const due = followUpDue(o.outreachSentAgeDays)
    const next = nextCadenceDay(o.outreachSentAgeDays)
    return due ? `发${due.label}（距上次 ${o.outreachSentAgeDays} 天）— 再提样品 offer` : `等回复（下次跟进 Day ${next ?? '—'}）`
  }
  if (o.stage === 'contact_captured') return '发样品邀约开发信'
  return '推进下一步'
}

// ── ② Revenue Leak Center ─────────────────────────────────────────────────────
export type LeakType = 'reply_unanswered' | 'sample_no_feedback' | 'quote_silent' | 'missing_owner' | 'missing_next_action' | 'missing_due'
export const LEAK_LABEL: Record<LeakType, string> = {
  reply_unanswered: '回复 >24h 未处理', sample_no_feedback: '寄样 >7天 无反馈', quote_silent: '报价 >14天 无跟进',
  missing_owner: '无负责人', missing_next_action: '无下一步动作', missing_due: '下一步无截止日',
}
const RISK_OF_LOSS: Record<LeakType, number> = {
  reply_unanswered: 0.5, sample_no_feedback: 0.4, quote_silent: 0.45, missing_owner: 0.6, missing_next_action: 0.4, missing_due: 0.3,
}

/** Discipline (V2): which of owner / next-action / due is missing → red. */
export function redFlags(o: Opp): string[] {
  const f: string[] = []
  if (!o.ownerAssigned) f.push('无负责人')
  if (!o.hasNextAction) f.push('无下一步')
  else if (!o.nextActionDueAt) f.push('无截止')
  return f
}

export interface Leak { o: Opp; type: LeakType; daysStalled: number | null; riskOfLoss: number; lostOpportunityCost: number; recovery: string }

/** All leaks for an opp (an opp can leak in several ways). */
export function detectLeaks(o: Opp): Leak[] {
  const out: Leak[] = []
  const add = (type: LeakType, daysStalled: number | null, recovery: string) =>
    out.push({ o, type, daysStalled, riskOfLoss: RISK_OF_LOSS[type], lostOpportunityCost: Math.round(o.poValueUsd * RISK_OF_LOSS[type]), recovery })
  if (o.replyAgeDays != null && o.replyAgeDays >= 1) add('reply_unanswered', o.replyAgeDays, '立刻回复, 致歉延迟, 直接提样品')
  if (o.sampleSentAgeDays != null && !o.sampleHasFeedback && o.sampleSentAgeDays >= 7) add('sample_no_feedback', o.sampleSentAgeDays, '打电话: 样品到了吗? 反馈如何?')
  if (o.quoteSentAgeDays != null && !o.quoteFollowedUp && o.quoteSentAgeDays >= 14) add('quote_silent', o.quoteSentAgeDays, '跟进报价 / 给台阶 / 报备老板')
  if (!o.ownerAssigned) add('missing_owner', null, '立即指派负责人')
  if (!o.hasNextAction) add('missing_next_action', null, '设置下一步动作 + 截止日')
  else if (!o.nextActionDueAt) add('missing_due', null, '给下一步动作设一个截止日')
  return out
}

// ── ③ Future Revenue Forecast (90 days) ───────────────────────────────────────
export interface Forecast { conservative: number; expected: number; aggressive: number; committed: number; byStage: { stage: FunnelStage; count: number; value: number; expected: number }[] }

export function forecast(opps: Opp[]): Forecast {
  let conservative = 0, expected = 0, aggressive = 0, committed = 0
  const byStageMap = new Map<FunnelStage, { count: number; value: number; expected: number }>()
  for (const o of opps) {
    const p90 = PO_PROB_90D[o.stage]
    const exp = o.poValueUsd * p90
    if (o.stage === 'trial_order' || o.stage === 'scale_order') committed += o.poValueUsd
    expected += exp
    conservative += exp * 0.6
    aggressive += Math.min(o.poValueUsd, exp * 1.5)
    const m = byStageMap.get(o.stage) ?? { count: 0, value: 0, expected: 0 }
    m.count++; m.value += o.poValueUsd; m.expected += exp
    byStageMap.set(o.stage, m)
  }
  const byStage = Array.from(byStageMap.entries()).map(([stage, v]) => ({ stage, ...v }))
  return {
    conservative: Math.round(conservative), expected: Math.round(expected),
    aggressive: Math.round(aggressive), committed: Math.round(committed), byStage,
  }
}
