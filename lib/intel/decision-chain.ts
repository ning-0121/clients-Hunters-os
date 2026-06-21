/**
 * Decision-chain intelligence — never stops at "not found". When a real contact
 * isn't present, it INFERS the likely org role from the customer type + size and
 * names the next role to pursue (by the buying-influence ladder). Reuses the
 * Contact-Intelligence access result for coverage.
 */
import type { AccessResult } from '@/lib/contacts/access'
import type { BriefContact, ChainRole, CustomerTypeProfile, DecisionChain } from '@/lib/intel/types'

export const CONTACT_PRIORITY_LADDER = [
  'VP / Director of Sourcing',
  'Director of Production',
  'Director of Merchandising',
  'Supply Chain / Operations',
  '(Senior) Buyer',
  'Founder / Owner',
  '客服(仅作兜底接入)',
]

const TRUSTED_SRC = new Set(['apollo', 'rocketreach', 'zoominfo', 'hunter', 'pattern_smtp'])
const isReachable = (c: BriefContact) =>
  c.emailVerified === true || TRUSTED_SRC.has((c.emailSource ?? '').toLowerCase())

const GENERIC_RE = /^(info|hello|contact|support|admin|team|sales|help|service|cs)@/i

/** First contact matching `pred`, reachable ones first. */
function pick(contacts: BriefContact[], pred: (c: BriefContact) => boolean): BriefContact | undefined {
  const hits = contacts.filter(pred)
  return hits.find(isReachable) ?? hits[0]
}

function found(c: BriefContact, fallbackTitle: string): ChainRole {
  return {
    status: 'found',
    name: c.fullName ?? null,
    title: c.title || fallbackTitle,
    note: isReachable(c) ? '已找到,可达(verified/trusted)' : '已找到,邮箱待验证',
  }
}
const inferred = (title: string, note: string): ChainRole => ({ status: 'inferred', title, note })

export function buildDecisionChain(
  contacts: BriefContact[],
  access: AccessResult,
  typeProfile: CustomerTypeProfile,
): DecisionChain {
  const role = (c: BriefContact) => (c.roleType ?? '').toLowerCase()
  const level = (c: BriefContact) => (c.decisionLevel ?? '').toLowerCase()

  const dmHit = pick(contacts, (c) => level(c) === 'decision_maker')
  const buyerHit = pick(contacts, (c) => ['sourcing', 'product', 'production', 'buyer'].includes(role(c)))
  const inflHit = pick(contacts, (c) => level(c) === 'influencer')
  const gateHit = pick(contacts, (c) => role(c) === 'other' || role(c) === 'unknown' || GENERIC_RE.test(c.email ?? ''))

  const decisionMaker = dmHit
    ? found(dmHit, typeProfile.likelyDecisionMaker)
    : inferred(typeProfile.likelyDecisionMaker, '未找到 → 按客户类型推断的决策人画像,优先寻找')
  const buyer = buyerHit
    ? found(buyerHit, 'Sourcing / Production')
    : inferred('Sourcing / Production Manager', '未找到 → 实际下单买手,需定位')
  const influencer = inflHit
    ? found(inflHit, 'Merchandising / Product')
    : inferred('Merchandising / Product / Ops', '未找到 → 影响选品与供应商的角色')
  const gatekeeper = gateHit
    ? found(gateHit, '客服 / 前台')
    : inferred('客服 / 前台', '通用邮箱/客服 — 仅作兜底接入,不是成功')

  const missingRoles: string[] = []
  if (decisionMaker.status !== 'found') missingRoles.push('决策人(Sourcing/Production Director)')
  if (buyer.status !== 'found') missingRoles.push('买手(Sourcing/Production Manager)')
  if (influencer.status !== 'found') missingRoles.push('影响者(Merchandising/Ops)')

  let recommendedNextContact: string
  if (decisionMaker.status !== 'found') recommendedNextContact = CONTACT_PRIORITY_LADDER[0]
  else if (buyer.status !== 'found') recommendedNextContact = '(Senior) Buyer / Sourcing Manager'
  else if (influencer.status !== 'found') recommendedNextContact = 'Merchandising / Production 影响者'
  else recommendedNextContact = '关键角色已覆盖 — 补充第二联系人以降单点风险'

  return {
    decisionMaker, influencer, buyer, gatekeeper,
    missingRoles,
    accessScore: access.score,
    accessCoverage: access.label,
    recommendedNextContact,
    contactPriorityLadder: CONTACT_PRIORITY_LADDER,
  }
}
