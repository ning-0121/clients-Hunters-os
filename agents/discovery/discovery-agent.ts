import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { googleSearch, extractDomain } from './scrapers/google-scraper'
import { scrapeWebsite } from './scrapers/website-scraper'
import { filterByICP } from './filters/icp-filter'
import { createServiceClient } from '@/lib/supabase/server'

export interface DiscoveryInput {
  searchMode: 'quick' | 'deep' | 'targeted'
  targetMarket?: string   // 'US' | 'EU' | 'LATAM' | 'global'
  targetType?: string     // 'activewear_brand' | 'amazon_seller' | 'tiktok_seller' | etc
  customQuery?: string    // override auto-generated queries
  maxLeads?: number
}

// ICP-optimized search query templates
const SEARCH_TEMPLATES = [
  // Activewear brands
  'activewear brand "private label" OR "OEM" manufacturer site:instagram.com',
  'yoga wear brand DTC Shopify activewear manufacturer',
  'women activewear brand small business "looking for manufacturer"',
  'athleisure brand Amazon FBA activewear wholesale',
  '"activewear brand" OR "yoga brand" site:faire.com',

  // TikTok / Social commerce
  'TikTok shop activewear seller brand yoga sportswear',
  '"tiktok shop" activewear leggings brand manufacturer',

  // Amazon sellers
  'site:amazon.com activewear brand "sold by" private label yoga leggings',
  'Amazon FBA activewear yoga leggings brand private label wholesale',

  // LATAM markets
  'marca ropa deportiva "fabricante" OR "proveedor" yoga activewear',
  'marca roupas fitness "fabricante" OR "fornecedor" yoga brasil',

  // Emerging brands
  '"new activewear brand" OR "launching activewear" 2023 OR 2024 OEM',
  'fitness influencer "own brand" OR "my brand" activewear leggings',
]

const TYPE_QUERIES: Record<string, string[]> = {
  amazon_seller: [
    'Amazon activewear private label brand yoga leggings FBA',
    'site:amazon.com activewear yoga leggings "visit the store"',
  ],
  tiktok_seller: [
    'TikTok shop activewear yoga leggings brand',
    '"tiktok shop" sportswear leggings athleisure brand',
  ],
  latam: [
    'marca ropa deportiva activewear yoga fabricante OEM mexico brasil',
    'ropa deportiva mayoreo marca propia activewear colombia peru',
    'roupas fitness marca própria fabricante OEM brasil',
  ],
  dtc_brand: [
    'activewear DTC brand Shopify yoga leggings manufacturer OEM',
    'small activewear brand direct to consumer sportswear',
  ],
}

export class DiscoveryAgent extends BaseAgent {
  constructor() {
    super('discovery_agent')
  }

  async execute(context: AgentContext, input: DiscoveryInput): Promise<AgentResult> {
    const startTime = Date.now()
    const maxLeads = input.maxLeads ?? 20
    const supabase = await createServiceClient()

    await this.logAction({
      actionType: 'discovery_start',
      inputData: input as unknown as Record<string, unknown>,
      status: 'running',
    })

    // 1. Generate search queries
    const queries = input.customQuery
      ? [input.customQuery]
      : this.buildQueries(input)

    console.log(`[DiscoveryAgent] Running ${queries.length} queries...`)

    // 2. Run searches in parallel (batches of 3)
    const allResults: Array<{ title: string; link: string; snippet: string; domain: string }> = []
    for (let i = 0; i < queries.length; i += 3) {
      const batch = queries.slice(i, i + 3)
      const batchResults = await Promise.allSettled(
        batch.map((q) => googleSearch(q, 10))
      )
      batchResults.forEach((r) => {
        if (r.status === 'fulfilled') allResults.push(...r.value)
      })
      if (allResults.length >= maxLeads * 3) break
    }

    // 3. Deduplicate by domain
    const seen = new Set<string>()
    const deduped = allResults.filter((r) => {
      if (!r.domain || seen.has(r.domain)) return false
      seen.add(r.domain)
      return true
    })

    // 4. Check against existing companies to avoid duplicates
    const { data: existing } = await supabase
      .from('companies')
      .select('domain')
      .in('domain', deduped.map((r) => r.domain))

    const existingDomains = new Set((existing ?? []).map((e) => e.domain))
    const newLeads = deduped.filter((r) => !existingDomains.has(r.domain))

    console.log(`[DiscoveryAgent] ${newLeads.length} new domains to evaluate`)

    // 5. Scrape websites (parallel, max 5 at a time)
    const toEvaluate = newLeads.slice(0, maxLeads * 2)
    const scrapedData: Array<{
      name: string
      domain: string
      description: string
      bodyText: string
      source: string
      website?: string
      instagramHandle?: string
      tiktokHandle?: string
      linkedinUrl?: string
      shopifyDetected?: boolean
      emails?: string[]
    }> = []

    for (let i = 0; i < toEvaluate.length; i += 5) {
      const batch = toEvaluate.slice(i, i + 5)
      const results = await Promise.allSettled(
        batch.map(async (lead) => {
          const siteData = await scrapeWebsite(lead.link)
          return {
            name: siteData?.title ?? lead.title,
            domain: lead.domain,
            description: siteData?.description ?? lead.snippet,
            bodyText: siteData?.bodyText ?? lead.snippet,
            source: 'google',
            website: lead.link,
            instagramHandle: siteData?.instagramHandle,
            tiktokHandle: siteData?.tiktokHandle,
            linkedinUrl: siteData?.linkedinUrl,
            shopifyDetected: siteData?.shopifyDetected ?? false,
            emails: siteData?.emails ?? [],
          }
        })
      )
      results.forEach((r) => {
        if (r.status === 'fulfilled') scrapedData.push(r.value)
      })
    }

    // 6. AI ICP filter
    const qualified = await filterByICP(scrapedData)
    console.log(`[DiscoveryAgent] ${qualified.length}/${scrapedData.length} passed ICP filter`)

    // 7. Persist to companies table
    let saved = 0
    for (const company of qualified.slice(0, maxLeads)) {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          name: company.name,
          domain: company.domain,
          website: company.website,
          description: company.description,
          company_type: company.icpResult.companyType,
          product_categories: company.icpResult.productCategories,
          price_point: company.icpResult.pricePoint,
          has_sourcing_need: company.icpResult.hasSourcingNeed,
          employee_count_range: company.icpResult.employeeCountRange,
          instagram_handle: company.instagramHandle,
          tiktok_handle: company.tiktokHandle,
          linkedin_url: company.linkedinUrl,
          shopify_detected: company.shopifyDetected,
          source: company.source,
          status: 'raw',
          country: detectCountry(company.domain, company.bodyText),
          region: detectRegion(company.domain, company.bodyText),
        })
        .select('id')
        .single()

      if (!error && data?.id) {
        // Queue enrich + score
        await this.enqueueJob('enrich_company', { companyId: data.id }, 4)
        saved++
      }
    }

    await this.logAction({
      actionType: 'discovery_complete',
      inputData: input as unknown as Record<string, unknown>,
      outputData: {
        queriesRun: queries.length,
        rawResults: allResults.length,
        newDomains: newLeads.length,
        qualified: qualified.length,
        saved,
      },
      status: 'completed',
      durationMs: Date.now() - startTime,
    })

    return {
      success: true,
      data: {
        queriesRun: queries.length,
        rawResults: allResults.length,
        newDomains: newLeads.length,
        qualified: qualified.length,
        saved,
      },
    }
  }

  private buildQueries(input: DiscoveryInput): string[] {
    if (input.targetType && TYPE_QUERIES[input.targetType]) {
      return TYPE_QUERIES[input.targetType]
    }

    const base = SEARCH_TEMPLATES.slice(0, input.searchMode === 'quick' ? 3 : input.searchMode === 'deep' ? 8 : 5)

    if (input.targetMarket === 'LATAM') {
      return [...base.slice(0, 3), ...TYPE_QUERIES.latam]
    }

    return base
  }
}

function detectCountry(domain: string, text: string): string | null {
  if (domain.endsWith('.br')) return 'Brazil'
  if (domain.endsWith('.mx')) return 'Mexico'
  if (domain.endsWith('.co.uk')) return 'United Kingdom'
  if (domain.endsWith('.au')) return 'Australia'
  if (domain.endsWith('.ca')) return 'Canada'
  if (domain.endsWith('.de')) return 'Germany'

  const lower = text.toLowerCase()
  if (lower.includes('united states') || lower.includes('usa') || lower.includes('u.s.')) return 'United States'
  if (lower.includes('brasil') || lower.includes('brazil')) return 'Brazil'
  if (lower.includes('mexico') || lower.includes('méxico')) return 'Mexico'
  if (lower.includes('united kingdom') || lower.includes('uk')) return 'United Kingdom'

  return 'United States' // default assumption
}

function detectRegion(domain: string, text: string): string {
  const lower = text.toLowerCase()
  if (lower.includes('brasil') || lower.includes('mexico') || lower.includes('colombia') || lower.includes('peru') || lower.includes('argentina')) return 'LATAM'
  if (lower.includes('europe') || lower.includes('european') || domain.endsWith('.de') || domain.endsWith('.fr') || domain.endsWith('.it')) return 'EU'
  if (lower.includes('australia') || domain.endsWith('.au')) return 'APAC'
  return 'NA'
}
