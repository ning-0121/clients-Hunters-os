/**
 * DomesticScoreAgent — scores domestic Chinese foreign-trade companies.
 *
 * Separate from overseas ScoreAgent: domestic trading companies are evaluated
 * as (1) order-cooperation / channel partners and (2) software customers for
 * ARAOS / Order Metronome / Trade OS — NOT as overseas brand buyers.
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { computeDomesticScores, type DomesticSignals } from '@/lib/scoring/domestic'
import { extractJson } from '@/lib/llm/json'

const DOMESTIC_SYSTEM_PROMPT = `你是 QIMO / Jojofashion 的国内市场业务分析师。
我们既是服装 OEM/ODM 工厂（运动服、瑜伽服、leggings、运动内衣、无缝、卫衣套装等），
也在做外贸客户开发软件（ARAOS / 订单节拍器 Order Metronome / Trade OS）。

国内外贸公司对我们有两类价值：
1）订单合作 / 渠道合作（他们下服装订单或做分销渠道）
2）软件客户（他们需要外贸订单管理 / 客户开发 / CRM / ERP 系统）

请对每个维度按 0-10 打分，务实评估，不要虚高。只返回 JSON，不要 markdown。`

interface DomesticOutput {
  apparel_relevance: number
  export_relevance: number
  region_relevance: number
  hiring_expansion_signal: number
  management_pain_signal: number
  order_coop_potential: number
  software_sales_potential: number
  channel_partner_potential: number
  domestic_company_type: string
  domestic_region: string
  management_pain_signals: string[]
  recruitment_signals: string[]
  recommended_domestic_strategy: string
}

export class DomesticScoreAgent extends BaseAgent {
  constructor() { super('score_agent') }

  async execute(context: AgentContext, input: unknown): Promise<AgentResult> {
    const { companyId, queueReport = true } = input as { companyId: string; queueReport?: boolean }
    const startTime = Date.now()
    const supabase = await createServiceClient()

    const { data: company, error } = await supabase
      .from('companies').select('*').eq('id', companyId).single()
    if (error || !company) return { success: false, error: 'Company not found' }

    let raw: string
    try {
      raw = await this.callLLM(DOMESTIC_SYSTEM_PROMPT, this.buildPrompt(company), { maxTokens: 1200, temperature: 0.3 })
    } catch (err) {
      await this.logAction({ companyId, actionType: 'score_domestic', status: 'failed', errorMessage: String(err) })
      return { success: false, error: String(err) }
    }

    let out: DomesticOutput
    try {
      out = JSON.parse(extractJson(raw))
    } catch {
      return { success: false, error: 'Failed to parse domestic scoring response' }
    }

    const signals: DomesticSignals = {
      apparelRelevance:        out.apparel_relevance,
      exportRelevance:         out.export_relevance,
      regionRelevance:         out.region_relevance,
      hiringExpansionSignal:   out.hiring_expansion_signal,
      managementPainSignal:    out.management_pain_signal,
      orderCoopPotential:      out.order_coop_potential,
      softwareSalesPotential:  out.software_sales_potential,
      channelPartnerPotential: out.channel_partner_potential,
    }
    const scores = computeDomesticScores(signals)

    await supabase.from('companies').update({
      target_customer_segment:           'domestic_trading_company',
      domestic_company_type:             out.domestic_company_type ?? company.domestic_company_type ?? null,
      domestic_region:                   out.domestic_region ?? company.domestic_region ?? null,
      development_purpose:               scores.recommendedPurpose,
      order_partner_potential_score:     scores.orderPartnerPotential,
      software_customer_potential_score: scores.softwareCustomerPotential,
      management_pain_signals:           out.management_pain_signals ?? [],
      recruitment_signals:               out.recruitment_signals ?? [],
      recommended_domestic_strategy:     out.recommended_domestic_strategy ?? null,
      total_score:                       scores.overall,
      grade:                             scores.grade,
      customer_tier:                     scores.grade,   // mirror so tier filters still surface them
      status:                            'scored',
      scored_at:                         new Date().toISOString(),
      updated_at:                        new Date().toISOString(),
    }).eq('id', companyId)

    if (queueReport && scores.grade !== 'D') {
      await this.enqueueJob('generate_report', { companyId }, scores.grade === 'A' ? 2 : 4)
    }

    await this.logAction({
      companyId, actionType: 'score_domestic',
      inputData: { companyId },
      outputData: { ...scores, type: out.domestic_company_type },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { ...scores, domesticCompanyType: out.domestic_company_type } }
  }

  private buildPrompt(company: Record<string, unknown>): string {
    return `评估这家国内外贸/贸易公司：

公司名称：${company.name}
网站：${company.website ?? '未知'}
描述：${company.description ?? '无'}
已知品类：${(company.product_categories as string[] | null)?.join('、') ?? '未知'}
地区线索：${company.domestic_region ?? company.city ?? company.region ?? '未知'}
公司类型线索：${company.domestic_company_type ?? company.company_type ?? '未知'}

domestic_company_type 只能取以下之一：
"apparel_trading_company" | "activewear_trading_company" | "general_import_export_company" |
"cross_border_ecommerce_seller" | "sourcing_agent" | "factory_with_export_department" | "software_prospect"

返回 JSON：
{
  "apparel_relevance": 0-10,
  "export_relevance": 0-10,
  "region_relevance": 0-10,
  "hiring_expansion_signal": 0-10,
  "management_pain_signal": 0-10,
  "order_coop_potential": 0-10,
  "software_sales_potential": 0-10,
  "channel_partner_potential": 0-10,
  "domestic_company_type": "...",
  "domestic_region": "如 义乌 / 杭州 / 宁波 / 广州 / 深圳 / 上海",
  "management_pain_signals": ["如 订单跟单混乱、Excel管理、缺少CRM"],
  "recruitment_signals": ["如 招聘外贸业务员、招聘跟单"],
  "recommended_domestic_strategy": "一句话：优先做订单合作还是软件销售还是渠道合作，以及理由"
}`
  }
}
