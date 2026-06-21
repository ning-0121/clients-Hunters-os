/**
 * Executive decision — the 30-second top card: rating, go/hold/no-go, priority,
 * annual potential, margin band, win probability, resource level.
 */
import type { AccessResult } from '@/lib/contacts/access'
import type { CompanyFacts, CustomerType, CustomerTypeProfile, ExecutiveDecision, MarginBand, Rating, ResourceLevel } from '@/lib/intel/types'

/** Annual purchase potential base band (USD) per type, for a B-grade account. */
const POTENTIAL_BASE: Record<CustomerType, [number, number]> = {
  premium_dtc:         [120_000, 600_000],
  growth_activewear:   [80_000, 400_000],
  off_price_discount:  [200_000, 1_200_000],
  wholesale_trade:     [200_000, 1_000_000],
  retail_private_label:[300_000, 1_500_000],
  ecom_micro:          [10_000, 80_000],
  distributor_importer:[300_000, 2_000_000],
  unqualified:         [0, 0],
}

const MARGIN_BY_TYPE: Record<CustomerType, MarginBand> = {
  premium_dtc: 'high', growth_activewear: 'medium', off_price_discount: 'thin',
  wholesale_trade: 'low', retail_private_label: 'medium', ecom_micro: 'low',
  distributor_importer: 'thin', unqualified: 'thin',
}

function deriveRating(c: CompanyFacts): Rating {
  if (c.customerTier) return c.customerTier
  const scale = c.customerScaleScore ?? 0, match = c.productMatchScore ?? 0, strat = c.strategicValueScore ?? 0
  if (match < 3) return 'D'
  if (match >= 6 && strat >= 7 && scale >= 8) return 'A'
  if (match >= 5 && scale >= 4) return 'B'
  if (match >= 4) return 'C'
  return 'D'
}

const RATING_MULT: Record<Rating, number> = { A: 1.6, B: 1.0, C: 0.5, D: 0.2 }

export function buildExecutiveDecision(
  c: CompanyFacts,
  typeProfile: CustomerTypeProfile,
  access: AccessResult,
  qimoFitScore: number,
): ExecutiveDecision {
  const rating = deriveRating(c)
  const type = typeProfile.type
  const reachable = access.hasReachableChampionOrDM

  // Decision
  let decision: ExecutiveDecision['decision']
  if (type === 'unqualified' || rating === 'D') decision = 'no_go'
  else if (rating === 'A' || (rating === 'B' && qimoFitScore >= 50)) decision = 'go'
  else decision = 'hold'

  // Priority
  let priority: ExecutiveDecision['priority'] = rating === 'A' ? 'high' : rating === 'B' ? 'medium' : 'low'
  if (priority === 'medium' && reachable && qimoFitScore >= 60) priority = 'high'
  if (decision === 'no_go') priority = 'low'

  // Annual potential
  let annualPotentialUsd: ExecutiveDecision['annualPotentialUsd'] = null
  if (decision !== 'no_go') {
    const [lo, hi] = POTENTIAL_BASE[type]
    const m = RATING_MULT[rating]
    const scaleAdj = 0.7 + 0.06 * (c.customerScaleScore ?? 5)   // 0.7..1.3
    annualPotentialUsd = { low: Math.round(lo * m * scaleAdj), high: Math.round(hi * m * scaleAdj) }
  }

  // Win probability
  let win = rating === 'A' ? 35 : rating === 'B' ? 25 : rating === 'C' ? 15 : 5
  if (reachable) win += 20
  else if (access.score >= 40) win += 10
  if (qimoFitScore >= 70) win += 15
  else if (qimoFitScore >= 50) win += 8
  if ((c.conversionFeasibilityScore ?? 5) <= 2) win -= 10
  const winProbability = Math.max(3, Math.min(90, win))

  // Resource level
  let resourceLevel: ResourceLevel
  if (decision === 'no_go') resourceLevel = 'minimal'
  else if (rating === 'A' && reachable) resourceLevel = 'heavy'
  else if (rating === 'A' || rating === 'B') resourceLevel = 'standard'
  else resourceLevel = 'light'

  const decLabel = decision === 'go' ? '开发(Go)' : decision === 'hold' ? '观望(Hold)' : '放弃(No-Go)'
  const pot = annualPotentialUsd ? `~$${Math.round(annualPotentialUsd.low / 1000)}k-${Math.round(annualPotentialUsd.high / 1000)}k/年` : '—'
  const headline = `${rating} 级 · ${typeProfile.label} · ${decLabel} · 赢率 ${winProbability}% · 潜力 ${pot} · 毛利 ${MARGIN_BY_TYPE[type]} · ${reachable ? '已可达决策人' : '决策人待找'}`

  return { rating, decision, priority, annualPotentialUsd, marginBand: MARGIN_BY_TYPE[type], winProbability, resourceLevel, headline }
}
