/**
 * TieringAgent — business-feasibility classification (A/B/C/D customer_tier).
 *
 * Distinct from ScoreAgent's generic ICP `grade`. The LLM rates six business
 * dimensions and proposes qualitative guidance; the *tier itself* is decided
 * deterministically by classifyTier() so it always reflects feasibility, not
 * just model opinion. Writes tiering fields onto companies and (for A/B/C)
 * queues a customer intelligence report.
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import {
  classifyTier, deriveFactoryType, reportDepthForTier,
  isComplianceLevel, type ComplianceLevel, type TierDimensions,
} from '@/lib/tiering/tiering'
import { matchFactory } from '@/lib/factory/matcher'
import { loadFactoryPool } from '@/lib/factory/recommend'
import { extractJson } from '@/lib/llm/json'

// Valid target_customer_segment enum values (the column is an enum, NOT free prose).
const SEGMENT_ENUM = new Set([
  'overseas_brand', 'overseas_importer', 'retailer_chain', 'offprice_buyer',
  'domestic_trading_company', 'domestic_factory', 'domestic_ecommerce_seller',
  'domestic_supplier', 'agency_partner',
])

const TIERING_SYSTEM_PROMPT = `You are a senior business development strategist for QIMO / Jojofashion,
an apparel OEM/ODM manufacturer focused on activewear, yoga wear, leggings, sports bras,
seamless products, fleece sets, lounge sets, modest activewear and thermal/performance base layers.

OUR REALITY (be honest about feasibility, not just fit):
- Current factory HAD BSCI and WRAP but the certificates recently EXPIRED (renewal planned).
- We can build a partner-factory pool with valid SMETA / Sedex / BSCI / WRAP if a deal justifies it.
- Many European / UK / Brazil / Italy buyers require BSCI, WRAP, Sedex/SMETA, OEKO-TEX, GRS,
  ISO 9001, supplier code-of-conduct, or a formal supplier portal application.

TIER STRATEGY:
- A = large / high-brand-value STRATEGIC account. Often strict compliance + long cycle. Worth
  nurturing even if not convertible now.
- B = our MAIN short-term target. Real order potential, manageable compliance, serveable now.
- C = small / early-stage. Quick test, samples, cash flow. Limit time spent.
- D = poor fit, unclear buyer, very-low-price-only, high risk, or no product match. Deprioritize.

Rate each dimension 0-10 honestly. conversion_feasibility = how realistically we can win them
SOON with current or partner factory. payment_risk: higher = riskier. Do NOT inflate scores.
Return ONLY valid JSON, no markdown.`

interface TieringOutput {
  customer_scale_score: number
  product_match_score: number
  conversion_feasibility_score: number
  strategic_value_score: number
  payment_risk_score: number
  compliance_level: string
  compliance_requirements: string[]
  compliance_blockers: string[]
  product_match: Array<{ category: string; level: string; suggested_sku: string; reason: string }>
  recommended_development_strategy: string
  recommended_factory_type?: string
  target_customer_segment: string
  next_action: string
  tier_reasoning: string
}

export class TieringAgent extends BaseAgent {
  constructor() { super('tiering_agent') }

  async execute(context: AgentContext, input: unknown): Promise<AgentResult> {
    const { companyId, queueReport = true } = input as { companyId: string; queueReport?: boolean }
    const startTime = Date.now()
    const supabase = await createServiceClient()

    const { data: company, error } = await supabase
      .from('companies').select('*').eq('id', companyId).single()
    if (error || !company) return { success: false, error: 'Company not found' }

    const { data: score } = await supabase
      .from('customer_scores').select('*').eq('company_id', companyId).single()
    const { data: contacts } = await supabase
      .from('contacts').select('full_name, title, email')
      .eq('company_id', companyId).order('contact_priority', { ascending: false }).limit(3)

    const userMessage = this.buildPrompt(company, score, contacts ?? [])

    let raw: string
    try {
      raw = await this.callLLM(TIERING_SYSTEM_PROMPT, userMessage, { maxTokens: 1500, temperature: 0.3 })
    } catch (err) {
      await this.logAction({ companyId, actionType: 'tier_company', status: 'failed', errorMessage: String(err) })
      return { success: false, error: String(err) }
    }

    let out: TieringOutput
    try {
      out = JSON.parse(extractJson(raw))
    } catch {
      return { success: false, error: 'Failed to parse tiering response' }
    }

    // Keep target_customer_segment a valid ENUM. The LLM's free-text segment
    // description goes into target_customer_segment ONLY if it's a real enum;
    // otherwise preserve any existing enum, else default to overseas_brand.
    const existingSeg = company.target_customer_segment as string | undefined
    const segment = SEGMENT_ENUM.has(out.target_customer_segment ?? '')
      ? out.target_customer_segment
      : SEGMENT_ENUM.has(existingSeg ?? '') ? existingSeg : 'overseas_brand'

    const complianceLevel: ComplianceLevel =
      isComplianceLevel(out.compliance_level) ? out.compliance_level : 'basic_docs'

    const dims: TierDimensions = {
      customerScaleScore:         this.clamp(out.customer_scale_score),
      productMatchScore:          this.clamp(out.product_match_score),
      conversionFeasibilityScore: this.clamp(out.conversion_feasibility_score),
      strategicValueScore:        this.clamp(out.strategic_value_score),
      paymentRiskScore:           this.clamp(out.payment_risk_score),
      complianceLevel,
    }

    const tier = classifyTier(dims)                  // deterministic — feasibility, not ICP
    let factoryType = deriveFactoryType(complianceLevel)

    // Match against the real factory pool (own may have expired BSCI/WRAP → partner / not ready).
    let recommendedFactoryId: string | null = null
    const blockers = [...(out.compliance_blockers ?? [])]
    try {
      const pool = await loadFactoryPool()
      if (pool.length > 0) {
        const cats = [
          ...((company.product_categories as string[] | null) ?? []),
          ...((out.product_match ?? []).map(p => p.category).filter(Boolean)),
        ]
        const match = matchFactory({ complianceLevel, categories: cats }, pool)
        recommendedFactoryId = match.factory_id ?? null
        if (match.decision === 'partner') factoryType = 'partner_smeta'
        else if (match.decision === 'not_ready') factoryType = 'unknown'
        else if (match.decision === 'current' && complianceLevel === 'bsci_wrap') factoryType = 'current_after_renewal'
        if (match.action_required) blockers.push(match.action_required)
      }
    } catch (err) {
      console.error('[TieringAgent] factory match failed:', err)
    }

    await supabase.from('companies').update({
      customer_tier:                    tier,
      tier_reasoning:                   out.tier_reasoning ?? null,
      compliance_level:                 complianceLevel,
      compliance_requirements:          out.compliance_requirements ?? [],
      compliance_blockers:              blockers,
      recommended_factory_id:           recommendedFactoryId,
      conversion_feasibility_score:     dims.conversionFeasibilityScore,
      strategic_value_score:            dims.strategicValueScore,
      customer_scale_score:             dims.customerScaleScore,
      product_match_score:              dims.productMatchScore,
      product_match:                    out.product_match ?? [],
      payment_risk_score:               dims.paymentRiskScore,
      recommended_development_strategy: out.recommended_development_strategy ?? null,
      recommended_factory_type:         factoryType,
      target_customer_segment:          segment,
      next_action:                      out.next_action ?? null,
      tiered_at:                        new Date().toISOString(),
      updated_at:                       new Date().toISOString(),
    }).eq('id', companyId)

    // Queue a report for A/B/C (D gets none unless manually requested).
    const depth = reportDepthForTier(tier)
    if (queueReport && depth !== 'none') {
      await this.enqueueJob('generate_report', { companyId, depth }, tier === 'A' ? 2 : 4)
    }

    await this.logAction({
      companyId, actionType: 'tier_company',
      inputData: { companyId },
      outputData: { tier, complianceLevel, factoryType, dims },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { tier, complianceLevel, factoryType, reportDepth: depth, dims } }
  }

  private clamp(n: unknown): number {
    const v = typeof n === 'number' ? n : Number(n)
    if (Number.isNaN(v)) return 5
    return Math.max(0, Math.min(10, v))
  }

  private buildPrompt(
    company: Record<string, unknown>,
    score: Record<string, unknown> | null,
    contacts: Record<string, unknown>[],
  ): string {
    const cats = (company.product_categories as string[] | null)?.join(', ') ?? 'unknown'
    const contactSummary = contacts.length
      ? contacts.map(c => `${c.full_name || 'unnamed'} — ${c.title || 'unknown title'}`).join('; ')
      : 'none found'

    return `Classify this prospect for QIMO apparel OEM/ODM development.

Company: ${company.name}
Website: ${company.website ?? 'unknown'}
Country: ${company.country ?? 'unknown'}
Type: ${company.company_type ?? 'unknown'}
Product categories: ${cats}
Employees: ${company.employee_count_range ?? 'unknown'}
Est. revenue: ${company.estimated_annual_revenue ?? 'unknown'}
Instagram followers: ${company.instagram_followers ?? 'unknown'}
TikTok followers: ${company.tiktok_followers ?? 'unknown'}
Shopify: ${company.shopify_detected ?? false}
Price point: ${company.price_point ?? 'unknown'}
Generic ICP grade (NOT the tier): ${company.grade ?? 'unscored'} / score ${company.total_score ?? '—'}
ICP reasoning: ${score?.score_reasoning ?? 'none'}
Decision-maker contacts: ${contactSummary}
Description: ${company.description ?? 'none'}

compliance_level MUST be one of:
"none" | "basic_docs" | "bsci_wrap" | "sedex_smeta" | "oeko_grs" | "customer_audit" | "supplier_portal"
(pick the HIGHEST bar this customer realistically imposes before a first order).

product_match[].level MUST be "High" | "Medium" | "Low".

Return JSON:
{
  "customer_scale_score": 0-10,
  "product_match_score": 0-10,
  "conversion_feasibility_score": 0-10,
  "strategic_value_score": 0-10,
  "payment_risk_score": 0-10,
  "compliance_level": "...",
  "compliance_requirements": ["BSCI","SMETA", ...],
  "compliance_blockers": ["needs audited SMETA partner factory", ...],
  "product_match": [
    {"category":"Seamless leggings","level":"High","suggested_sku":"seamless high-waist legging","reason":"core QIMO strength"}
  ],
  "recommended_development_strategy": "concrete strategy for how to develop this customer",
  "target_customer_segment": "ONE of: overseas_brand | overseas_importer | retailer_chain | offprice_buyer | agency_partner",
  "next_action": "the single most useful next step for the sales team",
  "tier_reasoning": "2-3 sentences citing the dimensions that drove the tier"
}`
  }
}
