/**
 * Factory capability / certification matching.
 *
 * Given a customer's compliance bar + product categories, recommend:
 *   - current own factory (if it actually satisfies the bar)
 *   - an audited partner factory (if compliance needs SMETA/Sedex/valid BSCI/WRAP)
 *   - "not ready" (if no factory in the pool matches)
 *
 * Key correctness requirement: an own factory with EXPIRED BSCI/WRAP must NOT
 * be matched to a customer that requires a valid social audit — it falls back
 * to a partner factory, or "not ready" if none qualifies.
 *
 * Pure function — `factories` is loaded by the caller so this is unit-testable.
 */
import type { ComplianceLevel } from '@/lib/tiering/tiering'

export interface FactoryCertLite {
  certification_type: string   // BSCI | WRAP | SMETA | Sedex | OEKO | GRS | ISO9001 | ...
  status: string               // valid | expired | in_renewal | planned | unknown
}

export interface FactoryLite {
  id: string
  name: string
  factory_type: string         // own_factory | partner_factory
  main_categories: string[]
  price_level?: string
  certifications: FactoryCertLite[]
}

export type FactoryDecision = 'current' | 'partner' | 'not_ready'

export interface FactoryMatch {
  decision: FactoryDecision
  factory_id?: string
  factory_name?: string
  factory_type?: string
  /** Required certs the OWN factory lacks a valid copy of (what to renew/obtain). */
  compliance_gap: string[]
  /** Plain action for the sales team before approaching the customer. */
  action_required: string
}

/** Which certs satisfy a given compliance bar (ANY one valid is enough). */
export function requiredCertsFor(level: ComplianceLevel): string[] {
  switch (level) {
    case 'none':
    case 'basic_docs':      return []
    case 'bsci_wrap':       return ['BSCI', 'WRAP']
    case 'sedex_smeta':     return ['SMETA', 'Sedex']
    case 'oeko_grs':        return ['OEKO', 'GRS']
    case 'customer_audit':  return ['SMETA', 'BSCI']
    case 'supplier_portal': return ['BSCI', 'SMETA']
    default:                return []
  }
}

function hasValidCert(factory: FactoryLite, certTypes: string[]): boolean {
  if (certTypes.length === 0) return true
  return factory.certifications.some(
    (c) => certTypes.includes(c.certification_type) && c.status === 'valid',
  )
}

function categoryOverlap(factory: FactoryLite, categories: string[]): boolean {
  if (!categories || categories.length === 0) return true
  const fc = factory.main_categories.map((c) => c.toLowerCase())
  return categories.some((c) => fc.includes(c.toLowerCase()))
}

/** Certs required but NOT valid at this factory — the gap to close. */
function gapFor(factory: FactoryLite | undefined, required: string[]): string[] {
  if (!factory || required.length === 0) return []
  // Only a gap if NONE of the acceptable certs is valid.
  if (hasValidCert(factory, required)) return []
  return required.map((req) => {
    const c = factory.certifications.find((x) => x.certification_type === req)
    return c ? `${req} (${c.status})` : `${req} (missing)`
  })
}

export function matchFactory(
  input: { complianceLevel: ComplianceLevel; categories: string[] },
  factories: FactoryLite[],
): FactoryMatch {
  const required = requiredCertsFor(input.complianceLevel)
  const own = factories.find((f) => f.factory_type === 'own_factory')

  // 1. Own factory satisfies bar + makes the category → use it.
  if (own && hasValidCert(own, required) && categoryOverlap(own, input.categories)) {
    return {
      decision: 'current',
      factory_id: own.id, factory_name: own.name, factory_type: own.factory_type,
      compliance_gap: [],
      action_required: required.length
        ? `Current factory meets the compliance bar (${required.join('/')}). Proceed with own factory.`
        : 'No audit required — proceed with current own factory.',
    }
  }

  // 2. A partner factory satisfies bar + category → route through partner.
  const partner = factories.find(
    (f) => f.factory_type === 'partner_factory' && hasValidCert(f, required) && categoryOverlap(f, input.categories),
  )
  if (partner) {
    const gap = gapFor(own, required)
    return {
      decision: 'partner',
      factory_id: partner.id, factory_name: partner.name, factory_type: partner.factory_type,
      compliance_gap: gap,
      action_required: gap.length
        ? `Own factory cannot satisfy ${gap.join(', ')} — route through audited partner "${partner.name}". Prepare partner audit docs before approaching.`
        : `Route through audited partner "${partner.name}".`,
    }
  }

  // 3. Nothing qualifies → not ready.
  const gap = gapFor(own, required)
  return {
    decision: 'not_ready',
    compliance_gap: gap,
    action_required: required.length
      ? `No factory in the pool currently holds a valid ${required.join('/')}. Not ready — renew certs or add an audited partner factory before approaching this customer.`
      : 'No factory matches this product category yet. Not ready.',
  }
}

export const FACTORY_DECISION_LABELS: Record<FactoryDecision, string> = {
  current:   'Current own factory',
  partner:   'Audited partner factory',
  not_ready: 'Not ready — no matching factory',
}
