/**
 * Account Penetration Score — the only KPI that matters for A-grade warfare.
 *
 * An account is NOT "found an email". It is PENETRATED only when:
 *   1. ≥3 buying stakeholders identified (Founder/CEO · Sourcing · Production ·
 *      Merchandising · Product Dev · Operations)
 *   2. ≥2 verified contact channels per stakeholder (email / LinkedIn / mobile)
 *   3. supplier situation understood
 *   4. switching probability estimated
 *   5. attack plan generated
 *
 * This turns the buying committee into a measurable target and tells the rep the
 * single next action to keep penetrating. Pure/deterministic — no LLM.
 */
import { computeCredibility, isReachableTier, type CredibilityInput } from '@/lib/contacts/credibility'

export interface PenetrationContact extends CredibilityInput {
  full_name?: string | null
  title?: string | null
  role_type?: string | null
  decision_level?: string | null
  linkedin_url?: string | null
  phone?: string | null
  whatsapp?: string | null
}

export type PenetrationStatus = 'not_penetrated' | 'partial' | 'penetrated'

export interface Penetration {
  score: number                 // 0-100
  status: PenetrationStatus
  stakeholders: number          // distinct buying-relevant named people
  multiChannelStakeholders: number // those with ≥2 channels
  supplierUnderstood: boolean
  switchingEstimated: boolean
  attackPlanReady: boolean
  missing: string[]
  nextAction: string            // the single highest-priority gap to close
}

/** Roles that sit on the activewear buying committee. */
const BUYING_ROLES = new Set(['founder', 'sourcing', 'production', 'product', 'operations'])
const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '')

function isStakeholder(c: PenetrationContact): boolean {
  const named = !!(c.full_name && String(c.full_name).trim())
  if (!named) return false
  return BUYING_ROLES.has((c.role_type ?? '').toLowerCase()) || (c.decision_level ?? '') === 'decision_maker'
}

/** Count verified channels for a stakeholder: reachable email + LinkedIn + mobile. */
function channelCount(c: PenetrationContact): number {
  let n = 0
  if (isReachableTier(computeCredibility(c).tier)) n++          // verified/trusted email
  if (c.linkedin_url && String(c.linkedin_url).trim()) n++       // LinkedIn
  if (digits(c.phone).length >= 6 || digits(c.whatsapp).length >= 6) n++ // mobile/WhatsApp
  return n
}

export function computePenetration(
  contacts: PenetrationContact[],
  opts?: { supplierUnderstood?: boolean; switchingEstimated?: boolean; attackPlanReady?: boolean },
): Penetration {
  const list = contacts ?? []
  const stakeholderList = list.filter(isStakeholder)
  const stakeholders = stakeholderList.length
  const multiChannelStakeholders = stakeholderList.filter((c) => channelCount(c) >= 2).length

  const supplierUnderstood = !!opts?.supplierUnderstood
  const switchingEstimated = !!opts?.switchingEstimated
  const attackPlanReady = !!opts?.attackPlanReady

  const score =
    (Math.min(stakeholders, 3) / 3) * 25 +
    (Math.min(multiChannelStakeholders, 3) / 3) * 25 +
    (supplierUnderstood ? 20 : 0) +
    (switchingEstimated ? 15 : 0) +
    (attackPlanReady ? 15 : 0)

  const fullyPenetrated =
    stakeholders >= 3 && multiChannelStakeholders >= 3 && supplierUnderstood && switchingEstimated && attackPlanReady
  const status: PenetrationStatus = fullyPenetrated ? 'penetrated' : stakeholders >= 1 ? 'partial' : 'not_penetrated'

  // Ordered gaps → the single next action a rep should take.
  const missing: string[] = []
  if (stakeholders < 3) missing.push(`找齐买家委员会:还差 ${3 - stakeholders} 个关键人(Sourcing/Production/Founder)`)
  if (multiChannelStakeholders < 3) missing.push(`补联系方式:${3 - multiChannelStakeholders} 个关键人不足 2 通道(邮箱/LinkedIn/手机)`)
  if (!supplierUnderstood) missing.push('查现供应商(海关 ImportYeti/Panjiva)')
  if (!switchingEstimated) missing.push('评估换厂概率')
  if (!attackPlanReady) missing.push('生成攻击计划(简报)')

  const nextAction = missing[0] ?? '已渗透 → 进攻:联系决策人 / 寄样 / 报价'

  return {
    score: Math.round(score),
    status,
    stakeholders,
    multiChannelStakeholders,
    supplierUnderstood,
    switchingEstimated,
    attackPlanReady,
    missing,
    nextAction,
  }
}
