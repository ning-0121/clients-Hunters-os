/**
 * CustomerReportAgent — generates a structured Customer Intelligence Report.
 *
 * Practical apparel OEM/ODM research (not generic copy). Uses existing data
 * (company, contacts, score, trigger_events) plus a light supplier/compliance
 * page crawl, then asks the LLM for a schema-validated report. Stores a new
 * versioned row in customer_intelligence_reports.
 *
 * Anti-hallucination: the prompt forbids inventing store counts, CEOs, certs,
 * or supplier requirements. Unknown facts must be null / "needs verification".
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { scrapeWebsite } from '@/agents/discovery/scrapers/website-scraper'
import { validateReport, type CustomerReport } from '@/lib/reports/report-schema'
import { validateDomesticReport, type DomesticReport } from '@/lib/reports/domestic-report-schema'
import { reportDepthForTier, type CustomerTier, type ReportDepth } from '@/lib/tiering/tiering'
import { recommendFactoryForCompany } from '@/lib/factory/recommend'
import { FACTORY_DECISION_LABELS } from '@/lib/factory/matcher'
import { parseJsonWithRepair } from '@/lib/llm/json'

const COMPLIANCE_KEYWORDS = [
  'bsci', 'wrap', 'smeta', 'sedex', 'oeko-tex', 'oeko tex', 'grs', 'iso 9001',
  'reach', 'rsl', 'mrsl', 'code of conduct', 'supplier code', 'social compliance',
  'responsible sourcing', 'vendor portal', 'become a supplier', 'supplier registration',
  'ethical', 'audit', 'gots', 'amfori',
]

const SUPPLIER_PAGE_PATHS = [
  '/suppliers', '/supplier', '/become-a-supplier', '/vendors', '/vendor',
  '/sourcing', '/sustainability', '/responsibility', '/code-of-conduct',
  '/our-suppliers', '/partnerships', '/about/sustainability', '/pages/suppliers',
]

const REPORT_SYSTEM_PROMPT = `You are a senior apparel sourcing analyst preparing a Customer Intelligence Report
for QIMO / Jojofashion — an apparel OEM/ODM manufacturer (activewear, yoga wear, leggings, sports bras,
seamless, fleece sets, lounge sets, modest activewear, thermal/performance base layers).

OUR REALITY:
- Current factory HAD BSCI + WRAP, certificates recently EXPIRED (renewal planned).
- We can assemble an audited SMETA / Sedex / BSCI / WRAP partner factory pool when a deal justifies it.
- High-tier EU / UK / Brazil / Italy buyers often require BSCI, WRAP, Sedex/SMETA, OEKO-TEX, GRS,
  ISO 9001, supplier code-of-conduct, or a formal supplier portal.

CRITICAL ANTI-HALLUCINATION RULES:
- Do NOT invent store counts, founded year, CEO/leadership, certifications, or supplier requirements.
- If a fact is not in the provided data, set it to null and mark related claims "Needs verification".
- Only label something "Confirmed" if it is explicitly in the provided data/sources.
- "Likely" = reasonable inference from the data. "Needs verification" = guess that must be checked.
- Compliance items you did not actually see should be status "Unknown / needs verification", not "Required".

Write for SALESPEOPLE: concrete, actionable, apparel-specific. Return ONLY valid JSON matching the
requested shape. No markdown, no commentary.`

const DOMESTIC_REPORT_SYSTEM_PROMPT = `你是 QIMO / Jojofashion 的国内市场分析师。
我们既是服装 OEM/ODM 工厂，也销售外贸客户开发软件（ARAOS / 订单节拍器 Order Metronome / Trade OS）。
为国内外贸/贸易公司撰写客户情报报告，目标是判断如何发展：订单合作、软件销售、或渠道合作。
务实、面向一线销售。不要编造事实，未知信息写 null 或"待核实"。
只返回合法 JSON，不要 markdown。字符串值内部不要出现真实换行，所有换行必须转义为 \\n。`

const JSON_REPAIR_PROMPT = `You are a JSON repair tool. The user message contains a JSON document that fails to parse.
Return ONLY the corrected, strictly-valid JSON — no markdown, no explanation, no code fences.
Fix these common problems WITHOUT changing meaning or structure:
- Escape every newline inside a string value as \\n (do not leave raw line breaks inside strings).
- Escape every double-quote that appears inside a string value as \\" (Chinese text often contains stray quotes).
- Make sure every string is properly closed and every object/array has its commas and closing brackets.
Keep all keys, values and nesting identical. Return the corrected JSON only.`

interface ReportInput {
  companyId: string
  depth?: ReportDepth
  manual?: boolean   // allow D-tier / forced generation
}

interface ParseOutcome {
  parsed?: unknown
  repairUsed: boolean        // sanitizer and/or LLM repair was needed
  errorMessage?: string      // structured JSON_PARSE_FAILURE message when parsed is undefined
}

export class CustomerReportAgent extends BaseAgent {
  constructor() { super('report_agent') }

  /**
   * Three-stage JSON parse for LLM report output:
   *   1. JSON.parse after extractJson
   *   2. control-char sanitizer (escapes raw newlines inside Chinese strings)
   *   3. one LLM repair retry (strict-JSON re-emit)
   * Returns a structured JSON_PARSE_FAILURE message if all stages fail.
   */
  private async parseReportJson(raw: string, repairMaxTokens: number, kind: 'overseas' | 'domestic'): Promise<ParseOutcome> {
    const first = parseJsonWithRepair(raw)
    if (first.ok) return { parsed: first.value, repairUsed: first.repairUsed }

    // Stage 3 — LLM repair pass (callLLM already retries transient errors).
    // Pass the parse error so the model knows where it broke; up to 2 attempts.
    let repairFailed = first.error ?? 'unknown'
    let repairThrew = false
    let attemptInput = `${raw}\n\n---\nThe JSON above failed to parse with error: ${first.error}\nReturn the corrected JSON only.`
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const repaired = await this.callLLM(JSON_REPAIR_PROMPT, attemptInput, { maxTokens: repairMaxTokens, temperature: 0 })
        const next = parseJsonWithRepair(repaired)
        if (next.ok) return { parsed: next.value, repairUsed: true }
        repairFailed = next.error ?? repairFailed
        attemptInput = `${repaired}\n\n---\nThis still failed to parse with: ${next.error}\nFix it and return only valid JSON.`
      } catch (err) {
        repairThrew = true
        repairFailed = String(err)
        break
      }
    }

    const errorMessage =
      `bucket=JSON_PARSE_FAILURE kind=${kind} len=${raw.length} ` +
      `tail=${JSON.stringify(raw.slice(-120))} ` +
      `parse_error=${JSON.stringify(first.error ?? '')} ` +
      `repair_attempted=true repair_failed_reason=${JSON.stringify(repairThrew ? `llm_repair_threw: ${repairFailed}` : repairFailed)}`
    return { repairUsed: true, errorMessage }
  }

  async execute(context: AgentContext, input: unknown): Promise<AgentResult> {
    const { companyId, depth: depthInput, manual = false } = input as ReportInput
    const startTime = Date.now()
    const supabase = await createServiceClient()

    const { data: company, error } = await supabase
      .from('companies').select('*').eq('id', companyId).single()
    if (error || !company) return { success: false, error: 'Company not found' }

    // Domestic Chinese trading companies use a different (Chinese) report.
    if (company.target_customer_segment === 'domestic_trading_company') {
      return this.generateDomestic(company, context, startTime)
    }

    const tier = (company.customer_tier as CustomerTier | null) ?? 'C'
    const depth: ReportDepth = depthInput ?? reportDepthForTier(tier)
    if (depth === 'none' && !manual) {
      return { success: false, error: 'D-tier customer — report skipped (request manually to override)' }
    }
    const effectiveDepth: ReportDepth = depth === 'none' ? 'short' : depth

    const [{ data: contacts }, { data: score }, { data: triggers }] = await Promise.all([
      supabase.from('contacts').select('full_name, title, email, linkedin_url, role_type, decision_level')
        .eq('company_id', companyId).order('contact_priority', { ascending: false }).limit(5),
      supabase.from('customer_scores').select('*').eq('company_id', companyId).single(),
      supabase.from('trigger_events').select('trigger_type, detail, url')
        .eq('company_id', companyId).order('created_at', { ascending: false }).limit(5),
    ])

    const crawl = await this.crawlSupplierPages(company.website as string | null)
    const factoryMatch = await recommendFactoryForCompany(company).catch(() => null)

    const userMessage = this.buildPrompt(company, contacts ?? [], score, triggers ?? [], crawl, effectiveDepth, factoryMatch)

    let raw: string
    try {
      raw = await this.callLLM(REPORT_SYSTEM_PROMPT, userMessage, {
        maxTokens: effectiveDepth === 'deep' ? 8000 : effectiveDepth === 'standard' ? 6000 : 4500,
        temperature: 0.4,
      })
    } catch (err) {
      await this.logAction({ companyId, actionType: 'generate_report', status: 'failed', errorMessage: String(err) })
      return { success: false, error: String(err) }
    }

    const parse = await this.parseReportJson(raw, effectiveDepth === 'deep' ? 8000 : 6000, 'overseas')
    if (parse.parsed === undefined) {
      await this.logAction({ companyId, actionType: 'generate_report', status: 'failed', errorMessage: parse.errorMessage })
      return { success: false, error: 'Failed to parse report JSON after repair' }
    }
    const parsed = parse.parsed

    const validation = validateReport(parsed)
    if (!validation.ok || !validation.report) {
      await this.logAction({
        companyId, actionType: 'generate_report', status: 'failed',
        errorMessage: `Schema invalid: ${validation.errors?.slice(0, 5).join(' | ')}`,
      })
      return { success: false, error: `Report failed schema validation: ${validation.errors?.slice(0, 5).join('; ')}` }
    }
    const report: CustomerReport = validation.report

    // Merge crawl-discovered source URLs (these are真 — actually fetched).
    const sourceUrls = [
      ...report.source_urls,
      ...crawl.pages.map(p => ({ url: p.url, used_for: 'fetched page (supplier/compliance scan)' })),
    ]

    // Next version number
    const { data: latest } = await supabase
      .from('customer_intelligence_reports')
      .select('report_version').eq('company_id', companyId)
      .order('report_version', { ascending: false }).limit(1).single()
    const nextVersion = (latest?.report_version ?? 0) + 1

    const { data: inserted, error: insertErr } = await supabase
      .from('customer_intelligence_reports')
      .insert({
        company_id:              companyId,
        report_version:          nextVersion,
        report_depth:            effectiveDepth,
        customer_tier:           tier,
        executive_summary:       report.executive_summary,
        company_profile:         report.company_profile,
        business_model:          report.business_model,
        product_lines:           report.product_lines,
        product_match:           report.product_match,
        compliance_requirements: report.compliance_requirements,
        supplier_entry_path:     report.supplier_entry_path,
        contact_strategy:        report.contact_strategy,
        outreach_angles:         report.outreach_angles,
        risk_assessment:         report.risk_assessment,
        recommended_actions:     report.recommended_actions,
        draft_messages:          report.draft_messages,
        source_urls:             sourceUrls,
        confidence_score:        report.confidence_score,
        created_by:              context.userId ?? 'ai',
      })
      .select('id')
      .single()

    if (insertErr) {
      await this.logAction({ companyId, actionType: 'generate_report', status: 'failed', errorMessage: insertErr.message })
      return { success: false, error: insertErr.message }
    }

    await this.logAction({
      companyId, actionType: 'generate_report',
      inputData: { companyId, depth: effectiveDepth },
      outputData: { reportId: inserted?.id, version: nextVersion, confidence: report.confidence_score, repair_used: parse.repairUsed },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { reportId: inserted?.id, version: nextVersion, depth: effectiveDepth, tier } }
  }

  /** Domestic Chinese trading-company report (中文，不同逻辑). */
  private async generateDomestic(
    company: Record<string, unknown>,
    context: AgentContext,
    startTime: number,
  ): Promise<AgentResult> {
    const supabase = await createServiceClient()
    const main = company.website ? await scrapeWebsite(company.website as string).catch(() => null) : null

    let raw: string
    try {
      raw = await this.callLLM(DOMESTIC_REPORT_SYSTEM_PROMPT, this.buildDomesticPrompt(company, main?.bodyText ?? ''), {
        maxTokens: 6000, temperature: 0.4,
      })
    } catch (err) {
      await this.logAction({ companyId: company.id as string, actionType: 'generate_report', status: 'failed', errorMessage: String(err) })
      return { success: false, error: String(err) }
    }

    const parse = await this.parseReportJson(raw, 6000, 'domestic')
    if (parse.parsed === undefined) {
      await this.logAction({ companyId: company.id as string, actionType: 'generate_report', status: 'failed', errorMessage: parse.errorMessage })
      return { success: false, error: 'Failed to parse domestic report JSON after repair' }
    }
    const parsed = parse.parsed

    const validation = validateDomesticReport(parsed)
    if (!validation.ok || !validation.report) {
      await this.logAction({
        companyId: company.id as string, actionType: 'generate_report', status: 'failed',
        errorMessage: `Domestic schema invalid: ${validation.errors?.slice(0, 5).join(' | ')}`,
      })
      return { success: false, error: `Domestic report failed schema validation: ${validation.errors?.slice(0, 5).join('; ')}` }
    }
    const report: DomesticReport = validation.report

    const { data: latest } = await supabase
      .from('customer_intelligence_reports')
      .select('report_version').eq('company_id', company.id as string)
      .order('report_version', { ascending: false }).limit(1).single()
    const nextVersion = (latest?.report_version ?? 0) + 1

    const { data: inserted, error: insertErr } = await supabase
      .from('customer_intelligence_reports')
      .insert({
        company_id:       company.id as string,
        report_version:   nextVersion,
        report_depth:     'standard',
        report_kind:      'domestic',
        customer_tier:    (company.customer_tier as string | null) ?? null,
        domestic_report:  report,
        draft_messages:   report.draft_messages,
        source_urls:      report.source_urls,
        confidence_score: report.confidence_score,
        created_by:       context.userId ?? 'ai',
      })
      .select('id').single()

    if (insertErr) {
      await this.logAction({ companyId: company.id as string, actionType: 'generate_report', status: 'failed', errorMessage: insertErr.message })
      return { success: false, error: insertErr.message }
    }

    await this.logAction({
      companyId: company.id as string, actionType: 'generate_report',
      inputData: { companyId: company.id, kind: 'domestic' },
      outputData: { reportId: inserted?.id, version: nextVersion, repair_used: parse.repairUsed },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { reportId: inserted?.id, version: nextVersion, kind: 'domestic' } }
  }

  private buildDomesticPrompt(company: Record<string, unknown>, bodyText: string): string {
    return `为这家国内外贸/贸易公司生成《客户情报报告》（中文）。

=== 已知结构化数据（视为已确认）===
公司名称：${company.name}
网站：${company.website ?? '未知'}
描述：${company.description ?? '无'}
地区：${company.domestic_region ?? '未知'}
公司类型：${company.domestic_company_type ?? '未知'}
主营品类：${(company.product_categories as string[] | null)?.join('、') ?? '未知'}
管理痛点信号：${(company.management_pain_signals as string[] | null)?.join('、') ?? '无'}
招聘信号：${(company.recruitment_signals as string[] | null)?.join('、') ?? '无'}
订单合作潜力分：${company.order_partner_potential_score ?? '未知'}/10
软件客户潜力分：${company.software_customer_potential_score ?? '未知'}/10
推荐策略：${company.recommended_domestic_strategy ?? '无'}

=== 官网正文摘录 ===
${bodyText.slice(0, 1500) || '无'}

不要编造未知信息（成立年份、规模、出口市场等），未知就写 null 或"待核实"。

严格返回以下 JSON：
{
  "公司基本信息": { "名称": "...", "地区": null|"...", "成立年份": null|"...", "规模": null|"...", "网站": null|"...", "简介": null|"..." },
  "主营品类": ["运动服","瑜伽服",...],
  "出口市场": { "主要市场": ["欧洲","美国",...], "说明": null|"..." },
  "业务模式": "贸易商/工贸一体/采购代理/跨境电商 等，并说明",
  "订单合作可能性": { "评分": 0-10, "说明": "..." },
  "软件系统需求可能性": { "评分": 0-10, "说明": "..." },
  "招聘扩张信号": ["..."],
  "管理痛点推断": ["..."],
  "推荐合作模式": "订单合作 / 软件销售 / 渠道合作 中选主次并说明理由",
  "推荐第一轮沟通话术": "一段实用话术",
  "电话微信开场白": "一句话开场白",
  "下一步动作": ["..."],
  "draft_messages": {
    "wechat_message": "微信开发信，简短口语化",
    "phone_script": "电话开场脚本",
    "formal_email": { "subject": "...", "body": "正式中文邮件" },
    "software_demo_invitation": "软件演示邀约话术",
    "order_cooperation_intro": "订单合作介绍"
  },
  "source_urls": [{ "url": "...", "used_for": "..." }],
  "confidence_score": 0.0-1.0
}`
  }

  /** Fetch a handful of likely supplier/compliance pages; collect text + compliance keyword hits. */
  private async crawlSupplierPages(website: string | null): Promise<{
    pages: Array<{ url: string; text: string }>
    complianceHits: string[]
    mainText: string
  }> {
    if (!website) return { pages: [], complianceHits: [], mainText: '' }

    const main = await scrapeWebsite(website).catch(() => null)
    const pages: Array<{ url: string; text: string }> = []
    const allText: string[] = [main?.bodyText ?? '']

    for (const path of SUPPLIER_PAGE_PATHS) {
      try {
        const url = new URL(path, website).toString()
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
          signal: AbortSignal.timeout(5000),
        })
        if (!res.ok) continue
        const html = await res.text()
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 2500)
        pages.push({ url, text })
        allText.push(text)
        if (pages.length >= 4) break   // keep it light
      } catch { /* ignore unreachable pages */ }
    }

    const haystack = allText.join(' ').toLowerCase()
    const complianceHits = COMPLIANCE_KEYWORDS.filter(k => haystack.includes(k))

    return { pages, complianceHits, mainText: (main?.bodyText ?? '').slice(0, 2000) }
  }

  private buildPrompt(
    company: Record<string, unknown>,
    contacts: Record<string, unknown>[],
    score: Record<string, unknown> | null,
    triggers: Record<string, unknown>[],
    crawl: { pages: Array<{ url: string; text: string }>; complianceHits: string[]; mainText: string },
    depth: ReportDepth,
    factoryMatch: Awaited<ReturnType<typeof recommendFactoryForCompany>>,
  ): string {
    const contactLines = contacts.length
      ? contacts.map(c => `- ${c.full_name || 'unnamed'} | ${c.title || 'unknown'} | ${c.email || 'no email'} | ${c.linkedin_url || 'no linkedin'}`).join('\n')
      : '(none found)'

    const triggerLines = triggers.length
      ? triggers.map(t => `- ${t.trigger_type}: ${t.detail ?? ''} (${t.url ?? ''})`).join('\n')
      : '(none)'

    const pageLines = crawl.pages.length
      ? crawl.pages.map(p => `URL: ${p.url}\n${p.text.slice(0, 800)}`).join('\n---\n')
      : '(no supplier/compliance pages found)'

    const depthGuide = {
      deep:     'DEEP report (A-tier strategic account): fill every section thoroughly, 4-5 outreach angles, detailed supplier entry path.',
      standard: 'STANDARD report (B-tier primary target): cover all sections, 3-4 outreach angles, practical and concise.',
      short:    'SHORT report (C-tier quick test): keep concise, 2-3 outreach angles, focus on the fastest path to a small order.',
      none:     'SHORT report.',
    }[depth]

    return `Generate a Customer Intelligence Report. ${depthGuide}

=== STRUCTURED DATA WE HAVE (treat as Confirmed) ===
Company: ${company.name}
Website: ${company.website ?? 'unknown'}
Domain: ${company.domain ?? 'unknown'}
Country: ${company.country ?? 'unknown'}
Company type: ${company.company_type ?? 'unknown'}
Business model hints: ${(company.business_model as string[] | null)?.join(', ') ?? 'unknown'}
Product categories: ${(company.product_categories as string[] | null)?.join(', ') ?? 'unknown'}
Employees: ${company.employee_count_range ?? 'unknown'}
Est. revenue: ${company.estimated_annual_revenue ?? 'unknown'}
Founded: ${company.founded_year ?? 'unknown'}
Instagram: @${company.instagram_handle ?? '?'} (${company.instagram_followers ?? '?'} followers)
TikTok: @${company.tiktok_handle ?? '?'} (${company.tiktok_followers ?? '?'} followers)
LinkedIn: ${company.linkedin_url ?? 'unknown'}
Shopify detected: ${company.shopify_detected ?? false}
Price point: ${company.price_point ?? 'unknown'}
Customer tier (already classified): ${company.customer_tier ?? 'unset'}
Tier reasoning: ${company.tier_reasoning ?? 'n/a'}
Compliance level (classified): ${company.compliance_level ?? 'unknown'}
Recommended factory type: ${company.recommended_factory_type ?? 'unknown'}
ICP score reasoning: ${score?.score_reasoning ?? 'none'}
Description: ${company.description ?? 'none'}

=== CONTACTS ON FILE ===
${contactLines}

=== TRIGGER EVENTS ===
${triggerLines}

=== COMPLIANCE KEYWORDS DETECTED ON SITE ===
${crawl.complianceHits.length ? crawl.complianceHits.join(', ') : '(none detected — do NOT assume any certification is required)'}

=== FACTORY MATCH (authoritative — from our factory matrix; reflect this in compliance_requirements) ===
${factoryMatch
  ? `Decision: ${FACTORY_DECISION_LABELS[factoryMatch.decision]}${factoryMatch.factory_name ? ` (${factoryMatch.factory_name})` : ''}
Compliance gap at own factory: ${factoryMatch.compliance_gap.length ? factoryMatch.compliance_gap.join(', ') : 'none'}
Action required: ${factoryMatch.action_required}
=> Set current_factory_can_support, partner_factory_needed and smeta_partner_needed CONSISTENT with this.`
  : '(no factory pool data available)'}

=== FETCHED SUPPLIER / COMPLIANCE / SUSTAINABILITY PAGES ===
${pageLines}

=== HOMEPAGE TEXT EXCERPT ===
${crawl.mainText || '(none)'}

Return JSON with EXACTLY these keys:
{
  "executive_summary": {
    "worth_developing": "is this customer worth developing + why",
    "tier": "A|B|C|D",
    "horizon": "short_term|long_term|mixed",
    "best_product_angle": "...",
    "biggest_blocker": "...",
    "next_step": "..."
  },
  "company_profile": {
    "name": "...", "country": null|"...", "headquarters": null|"...", "founded_year": null|"...",
    "leadership": null|"...", "store_count": null|"...", "website": null|"...",
    "ecommerce_channels": ["..."], "market_coverage": null|"...", "brand_positioning": null|"..."
  },
  "business_model": { "classification": ["dtc_brand|retail_chain|importer|distributor|off_price_buyer|marketplace_seller|showroom|sourcing_office|brand_owner|hybrid"], "reasoning": "..." },
  "product_lines": [{ "category": "...", "confidence": "Confirmed|Likely|Needs verification" }],
  "product_match": [{ "category":"...", "match_level":"High|Medium|Low", "suggested_qimo_product":"...", "why_it_matches":"...", "risk_difficulty": null|"...", "recommended_entry_sku": null|"..." }],
  "compliance_requirements": {
    "items": [{ "requirement":"...", "status":"Required|Preferred|Unknown / needs verification", "note": null|"..." }],
    "current_factory_can_support": "...",
    "partner_factory_needed": true|false,
    "bsci_wrap_renewal_enough": null|"...",
    "smeta_partner_needed": true|false
  },
  "supplier_entry_path": {
    "application_url": null|"...", "has_portal": true|false, "required_documents": ["..."],
    "application_sequence": ["..."], "follow_up_method": null|"...", "manual_strategy": null|"..."
  },
  "contact_strategy": { "target_titles": ["Head of Sourcing","Purchasing Manager", ...], "linkedin_search_queries": ["${company.name} sourcing manager", ...], "notes": null|"..." },
  "outreach_angles": [{ "angle":"...", "pitch":"..." }],
  "risk_assessment": [{ "risk":"...", "severity":"low|medium|high", "note": null|"..." }],
  "recommended_actions": [{ "action":"...", "priority":"now|soon|later" }],
  "draft_messages": {
    "first_outreach_email": { "subject":"...", "body":"..." },
    "linkedin_message": "...",
    "follow_up_email": { "subject":"...", "body":"..." },
    "supplier_portal_intro": "..."
  },
  "source_urls": [{ "url":"...", "used_for":"..." }],
  "confidence_score": 0.0-1.0
}`
  }
}
