/**
 * Account Access — "can we reach the person who can actually give us business?"
 *
 * A pure, account-level dimension INDEPENDENT of ICP / Strategic / Timing scores.
 * Computed from contacts we already store (role_type, decision_level, and the
 * email credibility derived from email_verified/confidence/source). No new column.
 *
 * Coverage is by BUYING ROLE, not contact count:
 *   - Buyer          sourcing / product / production (places & shapes orders)
 *   - Decision Maker has authority (VP/Director/Head/Founder…)
 *   - Champion       an internal advocate (engaged / linked on a deal)
 *   - Influencer     other known roles
 *
 * "Reachable" = a Verified OR Trusted email (people-database sources count even
 * when a catch-all domain blocks SMTP). North Star per account =
 * a REACHABLE Champion OR Decision-Maker.
 */
import { computeCredibility, credibilityRank, isReachableTier, type CredibilityInput, type CredibilityTier } from '@/lib/contacts/credibility'

export interface AccessContact extends CredibilityInput {
  id?: string
  role_type?: string | null
  decision_level?: string | null
  status?: string | null
  is_champion?: boolean | null
}

export type CoverageState = 'verified' | 'trusted' | 'probable' | 'guessed' | 'missing'

export interface Coverage {
  champion: CoverageState
  decisionMaker: CoverageState
  buyer: CoverageState
  influencer: CoverageState
}

export interface AccessResult {
  /** 0-100 reachability. */
  score: number
  coverage: Coverage
  totalContacts: number
  /** Contacts that are reachable (Verified OR Trusted). */
  reachableContacts: number
  /** Human labels of buying roles still missing a reachable contact — "find next". */
  missingRoles: string[]
  /** The North Star boolean: a reachable (verified/trusted) champion or decision-maker. */
  hasReachableChampionOrDM: boolean
  label: string
}

const BUYER_ROLES = new Set(['sourcing', 'product', 'production'])
const ENGAGED_STATUS = new Set(['replied', 'engaged', 'meeting', 'customer', 'active'])

/** A coverage state that counts as reachable for the North Star. */
export const isReachableState = (s: CoverageState): boolean => s === 'verified' || s === 'trusted'

function isChampion(c: AccessContact, championIds: Set<string>): boolean {
  return c.is_champion === true || (!!c.id && championIds.has(c.id)) || ENGAGED_STATUS.has((c.status ?? '').toLowerCase())
}

function rankToState(rank: number): CoverageState {
  return rank >= 4 ? 'verified' : rank === 3 ? 'trusted' : rank === 2 ? 'probable' : rank === 1 ? 'guessed' : 'missing'
}

/** Best credibility state among contacts in a bucket ('missing' if the bucket is empty). */
function bestState(contacts: AccessContact[], inBucket: (c: AccessContact) => boolean): CoverageState {
  let best = -1
  for (const c of contacts) {
    if (!inBucket(c)) continue
    best = Math.max(best, credibilityRank(computeCredibility(c).tier))
  }
  return rankToState(best)
}

export function computeAccess(contacts: AccessContact[], opts?: { championContactIds?: string[] }): AccessResult {
  const list = contacts ?? []
  const championIds = new Set(opts?.championContactIds ?? [])

  const champion = bestState(list, (c) => isChampion(c, championIds))
  const decisionMaker = bestState(list, (c) => (c.decision_level ?? '') === 'decision_maker')
  const buyer = bestState(list, (c) => BUYER_ROLES.has((c.role_type ?? '').toLowerCase()))
  const influencer = bestState(list, (c) => (c.decision_level ?? '') === 'influencer')

  const tiers: CredibilityTier[] = list.map((c) => computeCredibility(c).tier)
  const reachableContacts = tiers.filter(isReachableTier).length
  const anyEmail = list.some((c) => !!(c.email && c.email.trim()))
  const anyContact = list.length > 0

  const reachableChampion = isReachableState(champion)
  const reachableDM = isReachableState(decisionMaker)
  const reachableBuyer = isReachableState(buyer)
  const anyReachable = reachableContacts > 0

  // Score ladder (monotonic). "Reachable" = Verified OR Trusted, so catch-all
  // domains no longer permanently suppress access quality.
  let score = 0
  if (anyContact) score = 10                  // we know who exists, but no usable email yet
  if (anyEmail) score = 20                     // at least a guessed/probable email
  if (anyReachable) score = 40                 // a reachable contact (any role)
  if (reachableBuyer) score = 60               // reachable buyer (sourcing/product/production)
  if (reachableChampion || reachableDM) score = 80
  if (reachableChampion && reachableDM) score = 100

  const missingRoles: string[] = []
  if (!reachableDM) missingRoles.push('Decision Maker')
  if (!reachableBuyer) missingRoles.push('Buyer (Sourcing/Production)')
  if (!reachableChampion) missingRoles.push('Champion')

  const hasReachableChampionOrDM = reachableChampion || reachableDM

  const label =
    score >= 100 ? '完全可达(Champion+决策人)' :
    score >= 80 ? '可达(决策人/Champion · 验证或可信)' :
    score >= 60 ? '可达买手' :
    score >= 40 ? '有可达联系人' :
    score >= 20 ? '仅推测邮箱' :
    score >= 10 ? '知人未可达' : '无联系人'

  return {
    score,
    coverage: { champion, decisionMaker, buyer, influencer },
    totalContacts: list.length,
    reachableContacts,
    missingRoles,
    hasReachableChampionOrDM,
    label,
  }
}
