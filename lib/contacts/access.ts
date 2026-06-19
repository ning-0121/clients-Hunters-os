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
 * North Star per account = a VERIFIED Champion OR VERIFIED Decision Maker.
 */
import { computeCredibility, credibilityRank, type CredibilityInput, type CredibilityTier } from '@/lib/contacts/credibility'

export interface AccessContact extends CredibilityInput {
  id?: string
  role_type?: string | null
  decision_level?: string | null
  status?: string | null
  is_champion?: boolean | null
}

export type CoverageState = 'verified' | 'likely' | 'guessed' | 'missing'

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
  verifiedContacts: number
  /** Human labels of buying roles still missing a verified contact — "find next". */
  missingRoles: string[]
  /** The North Star boolean: do we have a verified champion or decision-maker? */
  hasVerifiedChampionOrDM: boolean
  label: string
}

const BUYER_ROLES = new Set(['sourcing', 'product', 'production'])
const ENGAGED_STATUS = new Set(['replied', 'engaged', 'meeting', 'customer', 'active'])

const tierToState = (t: CredibilityTier): CoverageState => (t === 'none' ? 'missing' : t)

function isChampion(c: AccessContact, championIds: Set<string>): boolean {
  return c.is_champion === true || (!!c.id && championIds.has(c.id)) || ENGAGED_STATUS.has((c.status ?? '').toLowerCase())
}

/** Best credibility state among contacts in a bucket ('missing' if the bucket is empty). */
function bestState(contacts: AccessContact[], inBucket: (c: AccessContact) => boolean): CoverageState {
  let best = -1
  for (const c of contacts) {
    if (!inBucket(c)) continue
    best = Math.max(best, credibilityRank(computeCredibility(c).tier))
  }
  if (best <= 0) return 'missing'   // empty bucket (-1) or only no-email contacts (0)
  return best === 3 ? 'verified' : best === 2 ? 'likely' : 'guessed'
}

export function computeAccess(contacts: AccessContact[], opts?: { championContactIds?: string[] }): AccessResult {
  const list = contacts ?? []
  const championIds = new Set(opts?.championContactIds ?? [])

  const champion = bestState(list, (c) => isChampion(c, championIds))
  const decisionMaker = bestState(list, (c) => (c.decision_level ?? '') === 'decision_maker')
  const buyer = bestState(list, (c) => BUYER_ROLES.has((c.role_type ?? '').toLowerCase()))
  const influencer = bestState(list, (c) => (c.decision_level ?? '') === 'influencer')

  const tiers = list.map((c) => computeCredibility(c).tier)
  const verifiedContacts = tiers.filter((t) => t === 'verified').length
  const anyEmail = list.some((c) => !!(c.email && c.email.trim()))
  const anyContact = list.length > 0

  const verifiedChampion = champion === 'verified'
  const verifiedDM = decisionMaker === 'verified'
  const verifiedBuyer = buyer === 'verified'
  const anyVerified = verifiedContacts > 0

  // Score ladder (monotonic). Mirrors the spec; a verified DM reaches 80 to match
  // the North Star ("verified Champion OR Decision Maker").
  let score = 0
  if (anyContact) score = 10                 // we know who exists, but no usable email yet
  if (anyEmail) score = 20                    // at least a guessed/unverified email
  if (anyVerified) score = 40                 // a verified contact (any role)
  if (verifiedBuyer) score = 60               // verified buyer (sourcing/product/production)
  if (verifiedChampion || verifiedDM) score = 80
  if (verifiedChampion && verifiedDM) score = 100

  const missingRoles: string[] = []
  if (decisionMaker !== 'verified') missingRoles.push('Decision Maker')
  if (buyer !== 'verified') missingRoles.push('Buyer (Sourcing/Production)')
  if (champion !== 'verified') missingRoles.push('Champion')

  const hasVerifiedChampionOrDM = verifiedChampion || verifiedDM

  const label =
    score >= 100 ? '完全可达(Champion+决策人)' :
    score >= 80 ? '可达(已验证决策人/Champion)' :
    score >= 60 ? '可达买手(已验证)' :
    score >= 40 ? '有已验证联系人' :
    score >= 20 ? '仅推测邮箱' :
    score >= 10 ? '知人未可达' : '无联系人'

  return {
    score,
    coverage: { champion, decisionMaker, buyer, influencer },
    totalContacts: list.length,
    verifiedContacts,
    missingRoles,
    hasVerifiedChampionOrDM,
    label,
  }
}
