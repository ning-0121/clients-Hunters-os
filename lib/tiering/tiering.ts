/**
 * Customer Tiering — business-feasibility classification for QIMO / Jojofashion.
 *
 * `customer_tier` is DISTINCT from the generic ICP `grade` produced by ScoreAgent.
 * A grade-A (great ICP fit) brand can still be tier-C if we cannot realistically
 * serve or convert it. Tiering blends six business dimensions:
 *
 *   - customer scale         (brand size / order potential)
 *   - product match          (do they buy what we make: activewear/seamless/etc.)
 *   - conversion feasibility  (can we win them soon with current/partner factory)
 *   - strategic value         (market entry, repeat orders, long-term position)
 *   - compliance difficulty   (audits / portals required before first order)
 *   - payment / country risk
 *
 * Tier meaning:
 *   A — large / high-brand-value strategic account. Often strict compliance,
 *       long cycle. Nurture even if not convertible now.
 *   B — main short-term development target. Real order potential, manageable
 *       compliance, serveable by current or partner factory.
 *   C — small / early-stage. Quick test, samples, cash flow. Limit time spent.
 *   D — poor fit / unclear buyer / very-low-price-only / high risk. Deprioritize.
 *
 * The classification here is deterministic and unit-tested so a tier never
 * depends solely on an LLM's opinion.
 */

export type CustomerTier = 'A' | 'B' | 'C' | 'D'

export type ComplianceLevel =
  | 'none'           // no audit required
  | 'basic_docs'     // company registration / basic documents
  | 'bsci_wrap'      // BSCI / WRAP (our factory had these — renewing)
  | 'sedex_smeta'    // Sedex / SMETA (likely needs audited partner factory)
  | 'oeko_grs'       // OEKO-TEX / GRS material certs
  | 'customer_audit' // customer-owned factory audit
  | 'supplier_portal'// formal vendor portal / supplier registration

/** Recommended factory routing given the compliance bar. */
export type RecommendedFactoryType =
  | 'current'                // current factory is fine as-is
  | 'current_after_renewal'  // OK once BSCI/WRAP renewal completes
  | 'partner_smeta'          // need an audited SMETA/Sedex partner factory
  | 'partner_or_current'     // either, depending on materials/cert
  | 'unknown'

export type ReportDepth = 'short' | 'standard' | 'deep' | 'none'

export interface TierDimensions {
  /** 0-10 — brand size, stores, ecommerce, social, order potential. */
  customerScaleScore: number
  /** 0-10 — overlap with QIMO categories (activewear/seamless/yoga/leggings...). */
  productMatchScore: number
  /** 0-10 — how realistically we can convert them now. Higher = easier. */
  conversionFeasibilityScore: number
  /** 0-10 — strategic value (market entry, repeat orders, positioning). */
  strategicValueScore: number
  /** 0-10 — payment + country + cancellation risk. Higher = riskier. */
  paymentRiskScore: number
  complianceLevel: ComplianceLevel
}

/** Compliance levels that realistically require an audited partner factory. */
const HIGH_COMPLIANCE: ReadonlySet<ComplianceLevel> = new Set([
  'sedex_smeta',
  'customer_audit',
  'supplier_portal',
])

function clamp10(n: number): number {
  if (Number.isNaN(n)) return 0
  return Math.max(0, Math.min(10, n))
}

/**
 * Deterministic tier classification from business-feasibility dimensions.
 * Order of checks matters: disqualifiers first, then A (strategic), then B, then C.
 */
export function classifyTier(d: TierDimensions): CustomerTier {
  const scale = clamp10(d.customerScaleScore)
  const product = clamp10(d.productMatchScore)
  const conversion = clamp10(d.conversionFeasibilityScore)
  const strategic = clamp10(d.strategicValueScore)
  const risk = clamp10(d.paymentRiskScore)
  const highCompliance = HIGH_COMPLIANCE.has(d.complianceLevel)

  // ── D: hard disqualifiers ────────────────────────────────────────────────
  // No clear product match — we cannot make what they buy.
  if (product < 3) return 'D'
  // Unclear / low-value buyer across the board.
  if (scale < 3 && strategic < 3 && conversion < 3) return 'D'
  // Unacceptable risk that scale/strategy can't justify.
  if (risk >= 9 && strategic < 7) return 'D'

  // ── A: large strategic account ───────────────────────────────────────────
  // Big AND strategically valuable — chase long-term regardless of cycle length.
  if (strategic >= 7 && scale >= 7) return 'A'
  // Very large brand behind a strict compliance wall = strategic by definition.
  if (scale >= 8 && highCompliance) return 'A'

  // ── B: best short-term target ────────────────────────────────────────────
  // Winnable now: real order potential, decent match, not a micro-buyer.
  if (conversion >= 5 && product >= 5 && scale >= 4) return 'B'

  // ── C: small / quick-test ────────────────────────────────────────────────
  // Some match and at least a path to a small order.
  if (product >= 4 && conversion >= 3) return 'C'

  return 'D'
}

/** Map a compliance level to the factory we should route the customer through. */
export function deriveFactoryType(level: ComplianceLevel): RecommendedFactoryType {
  switch (level) {
    case 'none':
    case 'basic_docs':
      return 'current'
    case 'bsci_wrap':
      return 'current_after_renewal'
    case 'oeko_grs':
      return 'partner_or_current'
    case 'sedex_smeta':
    case 'customer_audit':
    case 'supplier_portal':
      return 'partner_smeta'
    default:
      return 'unknown'
  }
}

/** Report depth follows tier: A=deep, B=standard, C=short, D=none (unless manual). */
export function reportDepthForTier(tier: CustomerTier): ReportDepth {
  switch (tier) {
    case 'A': return 'deep'
    case 'B': return 'standard'
    case 'C': return 'short'
    case 'D': return 'none'
  }
}

export const COMPLIANCE_LEVELS: ComplianceLevel[] = [
  'none', 'basic_docs', 'bsci_wrap', 'sedex_smeta', 'oeko_grs', 'customer_audit', 'supplier_portal',
]

export function isComplianceLevel(v: unknown): v is ComplianceLevel {
  return typeof v === 'string' && (COMPLIANCE_LEVELS as string[]).includes(v)
}

/** Human-readable labels for UI. */
export const COMPLIANCE_LABELS: Record<ComplianceLevel, string> = {
  none:            'No audit required',
  basic_docs:      'Basic company documents',
  bsci_wrap:       'BSCI / WRAP required',
  sedex_smeta:     'Sedex / SMETA required',
  oeko_grs:        'OEKO-TEX / GRS required',
  customer_audit:  'Customer-owned audit',
  supplier_portal: 'Supplier portal application',
}

export const FACTORY_TYPE_LABELS: Record<RecommendedFactoryType, string> = {
  current:               'Current factory',
  current_after_renewal: 'Current factory (after BSCI/WRAP renewal)',
  partner_smeta:         'Audited SMETA/Sedex partner factory',
  partner_or_current:    'Current or partner factory',
  unknown:               'Needs confirmation',
}

export const TIER_LABELS: Record<CustomerTier, string> = {
  A: 'A — Strategic account',
  B: 'B — Primary target',
  C: 'C — Quick test',
  D: 'D — Deprioritize',
}
