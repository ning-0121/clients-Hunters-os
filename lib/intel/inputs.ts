/**
 * Map DB rows → the pure inference layer's inputs. Keeps buildBrief decoupled
 * from the database shape (and unit-testable with synthetic inputs).
 */
import type { BriefContact, CompanyFacts, ProductMatchItem, Rating } from '@/lib/intel/types'

const numOrNull = (v: unknown): number | null =>
  typeof v === 'number' ? v : v == null ? null : Number.isNaN(Number(v)) ? null : Number(v)

export function companyFactsFromRow(row: Record<string, unknown>): CompanyFacts {
  const sourceRaw = (row.source_raw ?? {}) as Record<string, unknown>
  const tier = row.customer_tier
  return {
    name: (row.name as string) ?? '',
    domain: (row.domain as string) ?? null,
    website: (row.website as string) ?? null,
    country: (row.country as string) ?? null,
    companyType: (row.company_type as string) ?? null,
    productCategories: Array.isArray(row.product_categories) ? (row.product_categories as string[]) : [],
    pricePoint: (row.price_point as string) ?? null,
    employeeRange: (row.employee_count_range as string) ?? null,
    instagramFollowers: numOrNull(row.instagram_followers),
    tiktokFollowers: numOrNull(row.tiktok_followers),
    shopifyDetected: (row.shopify_detected as boolean) ?? null,
    techStack: Array.isArray(row.tech_stack) ? (row.tech_stack as string[]) : [],
    customerTier: (tier === 'A' || tier === 'B' || tier === 'C' || tier === 'D') ? (tier as Rating) : null,
    productMatch: Array.isArray(row.product_match) ? (row.product_match as ProductMatchItem[]) : [],
    customerScaleScore: numOrNull(row.customer_scale_score),
    productMatchScore: numOrNull(row.product_match_score),
    strategicValueScore: numOrNull(row.strategic_value_score),
    conversionFeasibilityScore: numOrNull(row.conversion_feasibility_score),
    paymentRiskScore: numOrNull(row.payment_risk_score),
    description: (row.description as string) ?? null,
    customsEvidence: !!sourceRaw.customs,
    customsText: ((sourceRaw.customs as { snippets?: string[] } | undefined)?.snippets ?? []).join(' | ') || null,
    city: (row.city as string) ?? null,
    region: (row.region as string) ?? null,
    complianceLevel: (row.compliance_level as string) ?? null,
    complianceRequirements: Array.isArray(row.compliance_requirements) ? (row.compliance_requirements as string[]) : [],
    complianceBlockers: Array.isArray(row.compliance_blockers) ? (row.compliance_blockers as string[]) : [],
    currentSuppliers: Array.isArray(row.current_supplier_hints) ? (row.current_supplier_hints as string[]) : [],
    fundingDetected: !!row.funding_detected,
    foundedYear: numOrNull(row.founded_year),
    estimatedAnnualRevenue: (row.estimated_annual_revenue as string) ?? null,
    hqAddress: (sourceRaw.hqAddress as string) ?? null,
    customsOrigins: Array.isArray((sourceRaw.importYeti as { originCountries?: string[] } | undefined)?.originCountries)
      ? ((sourceRaw.importYeti as { originCountries: string[] }).originCountries)
      : [],
    customsShipments: numOrNull((sourceRaw.importYeti as { totalShipments?: number } | undefined)?.totalShipments),
  }
}

export function briefContactsFromRows(rows: Record<string, unknown>[]): BriefContact[] {
  return (rows ?? []).map((r) => ({
    id: (r.id as string) ?? null,
    fullName: (r.full_name as string) ?? null,
    title: (r.title as string) ?? null,
    roleType: (r.role_type as string) ?? null,
    decisionLevel: (r.decision_level as string) ?? null,
    email: (r.email as string) ?? null,
    emailVerified: (r.email_verified as boolean) ?? null,
    emailSource: (r.email_source as string) ?? null,
    emailConfidence: numOrNull(r.email_confidence),
    linkedin: (r.linkedin_url as string) ?? null,
    phone: (r.phone as string) ?? null,
    status: (r.status as string) ?? null,
  }))
}
