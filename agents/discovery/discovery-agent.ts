/**
 * DiscoveryAgent v2 — 50+ Targeted Search Queries
 *
 * Improvements vs v1:
 *   + 50+ curated queries across 8 segments
 *   + Job board signal searches (brands hiring sourcing = perfect timing)
 *   + Sustainability brand searches (aligns with GOTS/OEKO-TEX strengths)
 *   + TikTok Shop / social commerce brands
 *   + Amazon private label searches
 *   + LATAM (Spanish + Portuguese) markets
 *   + Press/funding signal searches
 *   + "deep" mode runs all 50+ queries in batches
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { googleSearch } from './scrapers/google-scraper'
import { scrapeWebsite } from './scrapers/website-scraper'
import { filterByICP } from './filters/icp-filter'
import { classifyDomesticCompany } from './filters/domestic-filter'
import { createServiceClient } from '@/lib/supabase/server'

export interface DiscoveryInput {
  searchMode: 'quick' | 'deep' | 'targeted'
  targetMarket?: string   // 'US' | 'EU' | 'LATAM' | 'global'
  targetType?: string     // 'activewear_brand' | 'amazon_seller' | 'tiktok_seller' | etc
  customQuery?: string    // override auto-generated queries
  maxLeads?: number
}

// ── Blocklist ───────────────────────────────────────────────────────────────
const DOMAIN_BLOCKLIST = new Set([
  'shopify.com', 'instagram.com', 'facebook.com', 'tiktok.com', 'youtube.com',
  'reddit.com', 'pinterest.com', 'twitter.com', 'x.com', 'linkedin.com',
  'amazon.com', 'amazon.co.uk', 'etsy.com', 'faire.com', 'alibaba.com',
  'aliexpress.com', 'ebay.com', 'walmart.com', 'target.com',
  'forbes.com', 'businessinsider.com', 'entrepreneur.com', 'medium.com',
  'nike.com', 'adidas.com', 'lululemon.com', 'gymshark.com', 'underarmour.com',
  'blog.', 'news.', 'wiki', 'wikipedia.org', 'nytimes.com', 'wsj.com',
])

function isBlocklisted(domain: string): boolean {
  return [...DOMAIN_BLOCKLIST].some((blocked) => domain.includes(blocked))
}

// ── Segment A: Core DTC Activewear (Shopify brands) ─────────────────────────
const QUERIES_DTC_CORE = [
  '"activewear" "yoga wear" "shop now" "free shipping" -site:shopify.com -site:amazon.com -site:instagram.com',
  '"yoga leggings" "sports bra" "free shipping" "shop now" -site:amazon.com -site:shopify.com',
  '"activewear brand" "new arrivals" "leggings" site:*.com -site:shopify.com -site:amazon.com',
  '"athleisure" "workout wear" "women" "shop our collection" -site:shopify.com',
  '"gym wear" "women" "leggings" "sports bra" "shop" "our story" -site:amazon.com',
  '"yoga sets" "women" "shop" "new collection" "founded" -site:amazon.com',
  '"activewear" "workout sets" "women" "free shipping" "shop" -site:amazon.com -site:alibaba.com',
  '"sportswear" "women" "DTC" OR "direct to consumer" "activewear" -site:amazon.com',
]

// ── Segment B: TikTok Shop / Social Commerce ─────────────────────────────────
const QUERIES_TIKTOK = [
  '"activewear" "tiktok" "link in bio" "shop" -site:tiktok.com -site:instagram.com',
  '"yoga wear" "as seen on tiktok" "shop" -site:tiktok.com',
  '"gym sets" "tiktok made me buy" activewear -site:tiktok.com',
  '"viral activewear" "gym leggings" "shop" -site:tiktok.com -site:amazon.com',
  '"tiktok shop" activewear brand women leggings yoga -site:tiktok.com',
  '"workout sets" "tiktok" "viral" "women" "shop" -site:tiktok.com -site:instagram.com',
]

// ── Segment C: Amazon Private Label ─────────────────────────────────────────
const QUERIES_AMAZON = [
  'site:amazon.com "activewear" "Visit the" Store "yoga" "leggings" women',
  'site:amazon.com "sportswear" "women" "Visit the" Store "athleisure"',
  'site:amazon.com "yoga pants" "Visit the" Store women brand "high waist"',
  'site:amazon.com "workout sets" women "Visit the" Store "matching set"',
  'site:amazon.com "gym wear" "Visit the" Store women brand activewear',
  'site:amazon.com "sports bra" "leggings set" "Visit the" Store brand women',
]

// ── Segment D: Sustainability / Eco-Conscious Brands ────────────────────────
// High value — aligns with GOTS/OEKO-TEX factory strengths
const QUERIES_SUSTAINABILITY = [
  '"organic activewear" "women" "shop" -site:amazon.com -site:shopify.com',
  '"sustainable activewear" "women" "recycled" "shop" -site:amazon.com',
  '"organic cotton" "activewear" "yoga" "women" "certified" -site:amazon.com',
  '"recycled fabric" "activewear" "women" "shop now" -site:amazon.com',
  '"eco friendly" "activewear" "yoga" "women" "sustainable" "shop" -site:amazon.com',
  '"bamboo" "activewear" "yoga wear" "women" "shop" -site:amazon.com',
  '"GOTS certified" OR "OEKO-TEX" activewear brand women -site:amazon.com -site:alibaba.com',
  '"carbon neutral" OR "B Corp" activewear yoga "women" brand -site:amazon.com',
]

// ── Segment E: Hiring Signal Searches (perfect timing) ───────────────────────
// Brands actively building their supply chain team = highest-urgency leads
const QUERIES_HIRING = [
  '"sourcing manager" "activewear" OR "apparel" OR "sportswear" -site:linkedin.com',
  '"production coordinator" "apparel" OR "activewear" OR "clothing" brand -site:linkedin.com',
  '"supply chain" "activewear brand" "hiring" OR "job" OR "career" -site:linkedin.com',
  '"head of sourcing" "fashion" OR "apparel" OR "activewear" -site:linkedin.com',
  '"garment technologist" OR "technical designer" "activewear" brand -site:linkedin.com',
  'site:greenhouse.io "sourcing" OR "production" "activewear" OR "apparel"',
  'site:lever.co "sourcing manager" OR "production coordinator" activewear',
  'site:boards.greenhouse.io "apparel" "sourcing" OR "production" brand',
]

// ── Segment F: Press / Funding Signal Searches ───────────────────────────────
const QUERIES_SIGNALS = [
  '"activewear brand" "raised" "$" "million" -site:linkedin.com -site:amazon.com',
  '"yoga wear" OR "athleisure" "seed round" OR "series A" brand -site:linkedin.com',
  '"activewear" "DTC brand" "funding" OR "investment" 2024 OR 2025',
  '"as seen in" "Forbes" OR "Vogue" OR "Shape" "activewear" brand women',
  '"featured in" "Women\'s Health" OR "Runner\'s World" activewear brand',
  '"activewear brand" "press" OR "media coverage" "new collection" 2025',
]

// ── Segment G: LATAM Markets (Spanish + Portuguese) ─────────────────────────
const QUERIES_LATAM = [
  '"ropa deportiva" "mujer" "leggings" "tienda" -site:instagram.com -site:amazon.com',
  '"roupas fitness" "feminino" "loja" "leggings" -site:instagram.com',
  '"ropa deportiva" marca propia OEM mexico colombia fabricante',
  '"yoga" "ropa deportiva" "mujer" "envío gratis" "tienda" -site:amazon.com',
  '"fitness" "moda deportiva" "mujer" "nueva colección" -site:amazon.com -site:instagram.com',
  '"roupas esportivas" "feminino" "yoga" "loja online" -site:instagram.com',
  '"ropa gym" "mujer" "colección nueva" "tienda online" -site:amazon.com',
  '"activewear" "Brasil" OR "Mexico" OR "Colombia" "marca" "loja" OR "tienda"',
]

// ── Segment H: EU / UK / AU Markets ─────────────────────────────────────────
const QUERIES_INTL = [
  '"activewear" "women" "UK" OR "United Kingdom" "shop" "yoga" -site:amazon.co.uk',
  '"yoga wear" "Germany" OR "Deutschland" "women" "shop" -site:amazon.de',
  '"activewear brand" "Australia" "women" "yoga" "shop" -site:amazon.com.au',
  '"gym wear" "women" "Canada" "shop" "leggings" -site:amazon.ca',
  '"yoga wear" "Europe" OR "EU" "women" "shop" "sustainable" -site:amazon.com',
  '"activewear" "France" OR "Italy" "femme" OR "donna" "boutique" yoga',
]

// ── Segment I: Domestic Chinese foreign-trade companies (CN + EN) ────────────
// Targets for (1) order/channel cooperation and (2) trade-software sales.
const QUERIES_DOMESTIC = [
  '义乌 服装外贸公司', '义乌 运动服外贸公司', '杭州 服装外贸公司', '宁波 服装外贸公司',
  '广州 运动服贸易公司', '深圳 服装外贸公司', '上海 服装贸易公司',
  '瑜伽服 外贸公司', '运动服 外贸公司', 'leggings 外贸公司', 'activewear 外贸公司 中国',
  '外贸公司 招聘 跟单', '服装外贸公司 招聘 业务员', '外贸公司 招聘 生产跟单',
  '外贸公司 订单管理', '外贸客户开发 系统', '服装外贸 ERP', '外贸公司 CRM',
]

// Domains that are aggregators / job boards / marketplaces — skip as company records.
const DOMESTIC_SKIP = [
  'zhipin.com', 'liepin.com', '58.com', 'zhaopin.com', 'lagou.com', 'job', 'baidu.com',
  'zhihu.com', 'weibo.com', 'xiaohongshu.com', 'douyin.com', '1688.com', 'taobao.com',
  'tmall.com', 'jd.com', 'alibaba', 'made-in-china.com', 'globalsources.com', 'sina.com',
  'qcc.com', 'tianyancha.com', 'gov.cn',
]

// ── Recruitment-signal lead discovery (BOSS alternative via Serper) ──────────
// Companies hiring 外贸跟单/业务员 are expanding → good domestic trade-company leads.
const QUERIES_RECRUITMENT = [
  'site:zhipin.com 服装 外贸 跟单',
  'site:zhipin.com 运动服 外贸 业务员',
  'site:zhipin.com 瑜伽服 外贸',
  'site:liepin.com 服装外贸 跟单',
  'site:liepin.com 外贸 业务员 服装',
  '义乌 服装 外贸 招聘 跟单',
  '杭州 运动服 外贸 招聘 业务员',
  '广州 服装外贸 招聘 跟单',
  '宁波 服装 外贸 招聘 跟单',
  '深圳 服装 外贸 招聘 业务员',
]

const CN_REGIONS = ['义乌', '杭州', '宁波', '广州', '深圳', '上海', '温州', '泉州', '青岛', '苏州', '南通', '东莞', '佛山', '福州', '厦门']

// ── All queries by segment ───────────────────────────────────────────────────
const ALL_QUERIES_MAP: Record<string, string[]> = {
  dtc_core:       QUERIES_DTC_CORE,
  tiktok:         QUERIES_TIKTOK,
  amazon_seller:  QUERIES_AMAZON,
  sustainability: QUERIES_SUSTAINABILITY,
  hiring_signal:  QUERIES_HIRING,
  press_funding:  QUERIES_SIGNALS,
  latam:          QUERIES_LATAM,
  international:  QUERIES_INTL,
}

// TYPE_QUERIES maps targetType parameter to specific query sets
const TYPE_QUERIES: Record<string, string[]> = {
  amazon_seller:    QUERIES_AMAZON,
  tiktok_seller:    QUERIES_TIKTOK,
  latam:            QUERIES_LATAM,
  dtc_brand:        QUERIES_DTC_CORE,
  sustainability:   QUERIES_SUSTAINABILITY,
  hiring_signal:    QUERIES_HIRING,
  press_funding:    QUERIES_SIGNALS,
  international:    QUERIES_INTL,
  domestic_trade:   QUERIES_DOMESTIC,
  recruitment:      QUERIES_RECRUITMENT,
}

// Quick mode: 8 highest-signal queries
const QUICK_QUERIES = [
  ...QUERIES_DTC_CORE.slice(0, 2),
  ...QUERIES_TIKTOK.slice(0, 1),
  ...QUERIES_SUSTAINABILITY.slice(0, 2),
  ...QUERIES_HIRING.slice(0, 1),
  ...QUERIES_AMAZON.slice(0, 2),
]

// Targeted mode: ~20 queries
const TARGETED_QUERIES = [
  ...QUERIES_DTC_CORE.slice(0, 3),
  ...QUERIES_TIKTOK.slice(0, 2),
  ...QUERIES_SUSTAINABILITY.slice(0, 3),
  ...QUERIES_HIRING.slice(0, 3),
  ...QUERIES_AMAZON.slice(0, 3),
  ...QUERIES_SIGNALS.slice(0, 2),
  ...QUERIES_LATAM.slice(0, 2),
  ...QUERIES_INTL.slice(0, 2),
]

// Deep mode: all 50+ queries
const DEEP_QUERIES = Object.values(ALL_QUERIES_MAP).flat()

/** Decode common HTML entities in scraped text */
function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

export class DiscoveryAgent extends BaseAgent {
  constructor() {
    super('discovery_agent')
  }

  async execute(context: AgentContext, input: DiscoveryInput): Promise<AgentResult> {
    if (input.targetType === 'domestic_trade') return this.runDomestic(input)
    if (input.targetType === 'recruitment') return this.runRecruitment(input)

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

    console.log(`[DiscoveryAgent v2] Running ${queries.length} queries (mode: ${input.searchMode})...`)

    // 2. Run searches in parallel batches of 3
    const allResults: Array<{ title: string; link: string; snippet: string; domain: string }> = []
    for (let i = 0; i < queries.length; i += 3) {
      const batch = queries.slice(i, i + 3)
      const batchResults = await Promise.allSettled(
        batch.map((q) => googleSearch(q, 10))
      )
      batchResults.forEach((r) => {
        if (r.status === 'fulfilled') allResults.push(...r.value)
      })
      if (allResults.length >= maxLeads * 4) break  // enough candidates
    }

    // 3. Deduplicate by domain + blocklist filter
    const seen = new Set<string>()
    const deduped = allResults.filter((r) => {
      if (!r.domain || seen.has(r.domain)) return false
      if (isBlocklisted(r.domain)) return false
      seen.add(r.domain)
      return true
    })

    // 4. Filter against existing companies
    const { data: existing } = await supabase
      .from('companies')
      .select('domain')
      .in('domain', deduped.map((r) => r.domain))

    const existingDomains = new Set((existing ?? []).map((e) => e.domain))
    const newLeads = deduped.filter((r) => !existingDomains.has(r.domain))

    console.log(`[DiscoveryAgent v2] ${newLeads.length} new domains to evaluate (${deduped.length - newLeads.length} already in DB)`)

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
            name:             decodeHtml(siteData?.title ?? lead.title),
            domain:           lead.domain,
            description:      siteData?.description ?? lead.snippet,
            bodyText:         siteData?.bodyText ?? lead.snippet,
            source:           'google',
            website:          lead.link,
            instagramHandle:  siteData?.instagramHandle,
            tiktokHandle:     siteData?.tiktokHandle,
            linkedinUrl:      siteData?.linkedinUrl,
            shopifyDetected:  siteData?.shopifyDetected ?? false,
            emails:           siteData?.emails ?? [],
          }
        })
      )
      results.forEach((r) => {
        if (r.status === 'fulfilled') scrapedData.push(r.value)
      })
      // Brief pause between batches to avoid IP bans from Cloudflare/Shopify
      if (i + 5 < toEvaluate.length) {
        await new Promise(r => setTimeout(r, 600))
      }
    }

    // 6. AI ICP filter
    const qualified = await filterByICP(scrapedData)
    console.log(`[DiscoveryAgent v2] ${qualified.length}/${scrapedData.length} passed ICP filter`)

    // 7. Persist to companies table
    let saved = 0
    for (const company of qualified.slice(0, maxLeads)) {
      const { data, error } = await supabase
        .from('companies')
        .insert({
          name:                company.name,
          domain:              company.domain,
          website:             company.website,
          description:         company.description,
          company_type:        company.icpResult.companyType,
          product_categories:  company.icpResult.productCategories,
          price_point:         company.icpResult.pricePoint,
          has_sourcing_need:   company.icpResult.hasSourcingNeed,
          employee_count_range: company.icpResult.employeeCountRange,
          instagram_handle:    company.instagramHandle,
          tiktok_handle:       company.tiktokHandle,
          linkedin_url:        company.linkedinUrl,
          shopify_detected:    company.shopifyDetected,
          source:              company.source,
          status:              'raw',
          country:             detectCountry(company.domain, company.bodyText),
          region:              detectRegion(company.domain, company.bodyText),
        })
        .select('id')
        .single()

      if (!error && data?.id) {
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
        deduped: deduped.length,
        newDomains: newLeads.length,
        scraped: scrapedData.length,
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

  /** Domestic Chinese foreign-trade company discovery — separate pipeline. */
  private async runDomestic(input: DiscoveryInput): Promise<AgentResult> {
    const startTime = Date.now()
    const maxLeads = input.maxLeads ?? 20
    const supabase = await createServiceClient()

    await this.logAction({
      actionType: 'discovery_start',
      inputData: { ...input, segment: 'domestic_trade' } as unknown as Record<string, unknown>,
      status: 'running',
    })

    const queries = input.customQuery ? [input.customQuery]
      : input.searchMode === 'quick' ? QUERIES_DOMESTIC.slice(0, 6)
      : QUERIES_DOMESTIC

    const allResults: Array<{ title: string; link: string; snippet: string; domain: string }> = []
    for (let i = 0; i < queries.length; i += 3) {
      const batch = queries.slice(i, i + 3)
      const batchResults = await Promise.allSettled(batch.map((q) => googleSearch(q, 10)))
      batchResults.forEach((r) => { if (r.status === 'fulfilled') allResults.push(...r.value) })
      if (allResults.length >= maxLeads * 4) break
    }

    // Dedup by domain + skip aggregators/job-boards/marketplaces
    const seen = new Set<string>()
    const deduped = allResults.filter((r) => {
      if (!r.domain || seen.has(r.domain)) return false
      if (DOMESTIC_SKIP.some((s) => r.domain.includes(s))) return false
      seen.add(r.domain)
      return true
    })

    // Skip domains already in DB
    const { data: existing } = await supabase.from('companies').select('domain')
      .in('domain', deduped.map((r) => r.domain))
    const existingDomains = new Set((existing ?? []).map((e) => e.domain))
    const newLeads = deduped.filter((r) => !existingDomains.has(r.domain))

    // Scrape + classify (domestic classifier, NOT overseas ICP)
    let saved = 0
    let evaluated = 0
    const toEvaluate = newLeads.slice(0, maxLeads * 2)
    for (let i = 0; i < toEvaluate.length; i += 4) {
      const batch = toEvaluate.slice(i, i + 4)
      const results = await Promise.allSettled(batch.map(async (lead) => {
        const site = await scrapeWebsite(lead.link)
        const classification = await classifyDomesticCompany({
          name: decodeHtml(site?.title ?? lead.title),
          domain: lead.domain,
          snippet: lead.snippet,
          bodyText: site?.bodyText ?? lead.snippet,
        })
        return { lead, site, classification }
      }))

      for (const r of results) {
        if (r.status !== 'fulfilled') continue
        evaluated++
        const { lead, site, classification: c } = r.value
        if (!c.isDomesticTarget) continue
        if (saved >= maxLeads) continue

        const { data, error } = await supabase.from('companies').insert({
          name:                    decodeHtml(site?.title ?? lead.title),
          domain:                  lead.domain,
          website:                 lead.link,
          description:             site?.description ?? lead.snippet,
          country:                 'China',
          source:                  'google_domestic',
          status:                  'raw',
          target_customer_segment: 'domestic_trading_company',
          domestic_company_type:   c.domesticCompanyType,
          domestic_region:         c.region,
          product_categories:      c.mainCategories,
          management_pain_signals: c.painSignals,
          recruitment_signals:     c.recruitmentSignals,
        }).select('id').single()

        if (!error && data?.id) {
          await this.enqueueJob('score_domestic', { companyId: data.id }, 4)
          saved++
        }
      }
      if (i + 4 < toEvaluate.length) await new Promise((res) => setTimeout(res, 500))
    }

    await this.logAction({
      actionType: 'discovery_complete',
      inputData: { ...input, segment: 'domestic_trade' } as unknown as Record<string, unknown>,
      outputData: { queriesRun: queries.length, rawResults: allResults.length, newDomains: newLeads.length, evaluated, saved },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { queriesRun: queries.length, rawResults: allResults.length, qualified: saved, saved } }
  }

  /** Recruitment-signal lead discovery — find domestic trade companies that are hiring. */
  private async runRecruitment(input: DiscoveryInput): Promise<AgentResult> {
    const startTime = Date.now()
    const maxLeads = input.maxLeads ?? 20
    const supabase = await createServiceClient()

    await this.logAction({
      actionType: 'discovery_start',
      inputData: { ...input, segment: 'recruitment' } as unknown as Record<string, unknown>,
      status: 'running',
    })

    const queries = input.customQuery ? [input.customQuery]
      : input.searchMode === 'quick' ? QUERIES_RECRUITMENT.slice(0, 5)
      : QUERIES_RECRUITMENT

    const allResults: Array<{ title: string; link: string; snippet: string; domain: string }> = []
    for (let i = 0; i < queries.length; i += 3) {
      const batchResults = await Promise.allSettled(queries.slice(i, i + 3).map((q) => googleSearch(q, 10)))
      batchResults.forEach((r) => { if (r.status === 'fulfilled') allResults.push(...r.value) })
      if (allResults.length >= maxLeads * 5) break
    }

    // Extract company names from the job-posting titles/snippets.
    const seen = new Set<string>()
    const candidates: { name: string; region: string; signal: string; url: string }[] = []
    for (const r of allResults) {
      const blob = `${decodeHtml(r.title)} ${decodeHtml(r.snippet)}`
      const name = extractCnCompanyName(blob)
      if (!name || seen.has(name)) continue
      seen.add(name)
      candidates.push({ name, region: extractCnRegion(blob), signal: decodeHtml(r.title).slice(0, 120), url: r.link })
    }

    // Skip names already in the DB.
    const { data: existing } = await supabase.from('companies').select('name').in('name', candidates.map((c) => c.name))
    const existingNames = new Set((existing ?? []).map((e) => e.name))

    let saved = 0
    for (const c of candidates) {
      if (saved >= maxLeads) break
      if (existingNames.has(c.name)) continue
      const { data, error } = await supabase.from('companies').insert({
        name:                    c.name,
        country:                 'China',
        source:                  'recruitment_serper',
        source_url:              c.url,
        status:                  'raw',
        target_customer_segment: 'domestic_trading_company',
        domestic_region:         c.region || null,
        description:             `招聘信号（正在扩张/招人）：${c.signal}`,
        recruitment_signals:     [c.signal],
      }).select('id').single()
      if (!error && data?.id) {
        await this.enqueueJob('score_domestic', { companyId: data.id }, 4)
        saved++
      }
    }

    await this.logAction({
      actionType: 'discovery_complete',
      inputData: { ...input, segment: 'recruitment' } as unknown as Record<string, unknown>,
      outputData: { queriesRun: queries.length, rawResults: allResults.length, candidates: candidates.length, saved },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { queriesRun: queries.length, rawResults: allResults.length, qualified: saved, saved } }
  }

  private buildQueries(input: DiscoveryInput): string[] {
    // Explicit type override
    if (input.targetType && TYPE_QUERIES[input.targetType]) {
      return TYPE_QUERIES[input.targetType]
    }

    // Market-specific overrides
    if (input.targetMarket === 'LATAM') {
      return input.searchMode === 'deep'
        ? [...QUERIES_LATAM, ...QUERIES_DTC_CORE.slice(0, 3)]
        : QUERIES_LATAM
    }
    if (input.targetMarket === 'EU') {
      return input.searchMode === 'deep'
        ? [...QUERIES_INTL, ...QUERIES_SUSTAINABILITY.slice(0, 3)]
        : QUERIES_INTL
    }

    // Mode-based query set
    switch (input.searchMode) {
      case 'quick':   return QUICK_QUERIES
      case 'deep':    return DEEP_QUERIES
      case 'targeted':
      default:        return TARGETED_QUERIES
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract a Chinese company name from a job-posting title/snippet.
 *
 * BOSS hides employer names, so most snippets yield noise. We keep only names
 * with a STRONG legal suffix (有限公司 …) AND that mention a trade hub or an
 * apparel/trade keyword — which filters out generic phrases like "维护和开发公司"
 * or "某上海…公司". Fewer leads, but real ones.
 */
const APPAREL_TRADE_KW = /服饰|服装|纺织|针织|针纺|内衣|贸易|外贸|进出口|实业|运动|制衣|时尚|国际/
const BAD_PREFIX = /^(某|我[们們]|这[家个]|該|该|一[间間]|本|贵|某某)/

function extractCnCompanyName(text: string): string | null {
  const re = /([一-鿿]{2,16}(?:股份有限公司|有限责任公司|有限公司|进出口公司|贸易公司|实业公司|服饰有限公司))/g
  const matches = [...text.matchAll(re)]
    .map((m) => m[1].trim())
    .filter((n) => n.length >= 6 && !BAD_PREFIX.test(n) &&
      (APPAREL_TRADE_KW.test(n) || CN_REGIONS.some((r) => n.includes(r))))
  if (!matches.length) return null
  const pref = matches.find((n) => APPAREL_TRADE_KW.test(n))
  return pref ?? matches.sort((a, b) => b.length - a.length)[0]
}

/** Detect a Chinese trade-hub region mentioned in the text. */
function extractCnRegion(text: string): string {
  return CN_REGIONS.find((r) => text.includes(r)) ?? ''
}

function detectCountry(domain: string, text: string): string | null {
  if (domain.endsWith('.br'))    return 'Brazil'
  if (domain.endsWith('.mx'))    return 'Mexico'
  if (domain.endsWith('.co.uk')) return 'United Kingdom'
  if (domain.endsWith('.au'))    return 'Australia'
  if (domain.endsWith('.ca'))    return 'Canada'
  if (domain.endsWith('.de'))    return 'Germany'
  if (domain.endsWith('.fr'))    return 'France'
  if (domain.endsWith('.it'))    return 'Italy'
  if (domain.endsWith('.es'))    return 'Spain'
  if (domain.endsWith('.co') && (text.toLowerCase().includes('colombia') || text.toLowerCase().includes('bogotá'))) return 'Colombia'

  const lower = text.toLowerCase()
  if (lower.includes('united states') || lower.includes(' usa ') || lower.includes('u.s.')) return 'United States'
  if (lower.includes('brasil') || lower.includes('brazil')) return 'Brazil'
  if (lower.includes('mexico') || lower.includes('méxico')) return 'Mexico'
  if (lower.includes('united kingdom') || lower.includes(' uk ')) return 'United Kingdom'
  if (lower.includes('australia')) return 'Australia'
  if (lower.includes('canada')) return 'Canada'
  if (lower.includes('germany') || lower.includes('deutschland')) return 'Germany'

  return 'United States' // default
}

function detectRegion(domain: string, text: string): string {
  const lower = text.toLowerCase()
  if (
    lower.includes('brasil') || lower.includes('brazil') ||
    lower.includes('mexico') || lower.includes('colombia') ||
    lower.includes('peru') || lower.includes('argentina') ||
    domain.endsWith('.br') || domain.endsWith('.mx') || domain.endsWith('.co')
  ) return 'LATAM'
  if (
    lower.includes('europe') || lower.includes('european') ||
    domain.endsWith('.de') || domain.endsWith('.fr') || domain.endsWith('.it') ||
    domain.endsWith('.es') || domain.endsWith('.nl') || domain.endsWith('.be')
  ) return 'EU'
  if (lower.includes('australia') || domain.endsWith('.au')) return 'APAC'
  if (lower.includes('canada') || domain.endsWith('.ca')) return 'NA'
  return 'NA'
}
