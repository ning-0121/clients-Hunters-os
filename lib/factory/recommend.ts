/**
 * Server-side factory recommendation: loads the factory pool + certs and runs
 * the pure matcher against a company's compliance bar + product categories.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { matchFactory, type FactoryLite, type FactoryMatch } from '@/lib/factory/matcher'
import { isComplianceLevel, type ComplianceLevel } from '@/lib/tiering/tiering'

/** Category synonyms so report/company category strings line up with factory.main_categories. */
function normalizeCategories(categories: string[]): string[] {
  const map: Record<string, string> = {
    'sports bra': 'sports_bra', 'sports bras': 'sports_bra', 'sports_bra': 'sports_bra',
    'leggings': 'leggings', 'legging': 'leggings',
    'yoga': 'yoga', 'yoga wear': 'yoga', 'yogawear': 'yoga',
    'seamless': 'seamless', 'activewear': 'activewear', 'athleisure': 'activewear',
    'fleece': 'fleece', 'fleece sets': 'fleece', 'lounge': 'lounge', 'lounge sets': 'lounge',
  }
  return [...new Set(categories.map((c) => map[c.toLowerCase().trim()] ?? c.toLowerCase().trim()))]
}

export async function loadFactoryPool(): Promise<FactoryLite[]> {
  const sb = await createServiceClient()
  const [{ data: profiles }, { data: certs }] = await Promise.all([
    sb.from('factory_profiles').select('id, name, factory_type, main_categories, price_level'),
    sb.from('factory_certifications').select('factory_id, certification_type, status'),
  ])

  return (profiles ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    factory_type: p.factory_type ?? 'own_factory',
    main_categories: Array.isArray(p.main_categories) ? (p.main_categories as string[]) : [],
    price_level: p.price_level ?? undefined,
    certifications: (certs ?? [])
      .filter((c) => c.factory_id === p.id)
      .map((c) => ({ certification_type: c.certification_type ?? '', status: c.status ?? 'unknown' })),
  }))
}

/** Recommend a factory for a company row (uses compliance_level + product_categories). */
export async function recommendFactoryForCompany(company: {
  compliance_level?: string | null
  product_categories?: string[] | null
  product_match?: Array<{ category?: string }> | null
}): Promise<FactoryMatch | null> {
  const level: ComplianceLevel = isComplianceLevel(company.compliance_level) ? company.compliance_level : 'basic_docs'
  const fromMatch = (company.product_match ?? []).map((m) => m.category ?? '').filter(Boolean)
  const cats = normalizeCategories([...(company.product_categories ?? []), ...fromMatch])

  const factories = await loadFactoryPool()
  if (factories.length === 0) return null
  return matchFactory({ complianceLevel: level, categories: cats }, factories)
}
