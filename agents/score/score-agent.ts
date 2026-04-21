import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import type { Company } from '@/types'

const SCORING_SYSTEM_PROMPT = `You are an expert business development analyst for a Chinese activewear OEM/ODM factory.
Your job is to score potential customers across multiple dimensions to prioritize outreach.

The factory specializes in: activewear, sportswear, yoga wear, tennis wear, golf wear, athleisure.
Target customers: small-mid DTC brands, private label buyers, Amazon sellers, TikTok Shop sellers, wholesalers.
Key markets: USA, Canada, Europe, Brazil, Mexico, Australia.

Score each dimension from 0-10. Be analytical and specific.
Return ONLY valid JSON, no markdown, no explanation outside the JSON.`

interface ScoringOutput {
  icp_fit_score: number
  size_score: number
  profit_potential_score: number
  reply_probability_score: number
  category_match_score: number
  risk_score: number
  ltv_potential_score: number
  white_label_fit: number
  small_order_fit: number
  dtc_potential: number
  tiktok_fit: number
  latam_priority: number
  score_reasoning: string
  recommended_strategy: string
  recommended_channels: string[]
  recommended_assignee: string
  recommended_priority: number
}

export class ScoreAgent extends BaseAgent {
  constructor() {
    super('score_agent')
  }

  async execute(context: AgentContext, input: { companyId: string }): Promise<AgentResult> {
    const startTime = Date.now()
    const supabase = await createServiceClient()

    const { data: company, error } = await supabase
      .from('companies')
      .select('*')
      .eq('id', input.companyId)
      .single()

    if (error || !company) {
      return { success: false, error: 'Company not found' }
    }

    const userMessage = this.buildScoringPrompt(company)
    let raw: string
    try {
      raw = await this.callLLM(SCORING_SYSTEM_PROMPT, userMessage, { maxTokens: 1500, temperature: 0.3 })
    } catch (err) {
      await this.logAction({
        companyId: input.companyId,
        actionType: 'score_company',
        inputData: { companyId: input.companyId },
        status: 'failed',
        errorMessage: String(err),
      })
      return { success: false, error: String(err) }
    }

    let scores: ScoringOutput
    try {
      scores = JSON.parse(raw)
    } catch {
      return { success: false, error: 'Failed to parse scoring response' }
    }

    const total = this.calculateTotal(scores)
    const grade = this.calculateGrade(total)

    await supabase.from('customer_scores').upsert({
      company_id: input.companyId,
      ...scores,
      total_score: total,
      grade,
      model_version: this.defaultModel,
      scored_at: new Date().toISOString(),
      scored_by: 'ai',
    }, { onConflict: 'company_id' })

    await supabase
      .from('companies')
      .update({
        total_score: total,
        grade,
        status: 'scored',
        scored_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', input.companyId)

    if (grade !== 'D') {
      await this.enqueueJob('draft_outreach', { companyId: input.companyId }, grade === 'A' ? 2 : 3)
    }

    await this.logAction({
      companyId: input.companyId,
      actionType: 'score_company',
      inputData: { companyId: input.companyId },
      outputData: { total, grade, scores },
      status: 'completed',
      durationMs: Date.now() - startTime,
    })

    return { success: true, data: { total, grade, scores } }
  }

  private buildScoringPrompt(company: Company): string {
    return `Score this potential customer for our activewear OEM/ODM factory:

Company: ${company.name}
Website: ${company.website ?? 'unknown'}
Type: ${company.company_type ?? 'unknown'}
Categories: ${company.product_categories?.join(', ') ?? 'unknown'}
Employees: ${company.employee_count_range ?? 'unknown'}
Country: ${company.country ?? 'unknown'}
Instagram followers: ${company.instagram_followers ?? 'unknown'}
TikTok followers: ${company.tiktok_followers ?? 'unknown'}
Price point: ${company.price_point ?? 'unknown'}
Has sourcing need: ${company.has_sourcing_need ?? 'unknown'}
Shopify detected: ${company.shopify_detected ?? false}
Description: ${company.description ?? 'none'}
Source: ${company.source ?? 'unknown'}

Return JSON with this exact structure:
{
  "icp_fit_score": 0-10,
  "size_score": 0-10,
  "profit_potential_score": 0-10,
  "reply_probability_score": 0-10,
  "category_match_score": 0-10,
  "risk_score": 0-10,
  "ltv_potential_score": 0-10,
  "white_label_fit": 0-10,
  "small_order_fit": 0-10,
  "dtc_potential": 0-10,
  "tiktok_fit": 0-10,
  "latam_priority": 0-10,
  "score_reasoning": "2-3 sentence explanation",
  "recommended_strategy": "specific outreach strategy",
  "recommended_channels": ["email", "linkedin"],
  "recommended_assignee": "sales_manager or junior_sdra",
  "recommended_priority": 1-10
}`
  }

  private calculateTotal(scores: ScoringOutput): number {
    const weights = {
      icp_fit_score: 2.0,
      size_score: 1.0,
      profit_potential_score: 1.5,
      reply_probability_score: 1.5,
      category_match_score: 1.5,
      risk_score: -1.0,
      ltv_potential_score: 1.0,
      white_label_fit: 0.5,
      small_order_fit: 0.5,
      dtc_potential: 0.5,
      tiktok_fit: 0.5,
      latam_priority: 0.5,
    }
    let total = 0
    let weightSum = 0
    for (const [key, weight] of Object.entries(weights)) {
      const val = scores[key as keyof ScoringOutput] as number
      if (typeof val === 'number') {
        total += val * Math.abs(weight) * (weight < 0 ? -1 : 1)
        weightSum += Math.abs(weight)
      }
    }
    return Math.max(0, Math.min(100, (total / (weightSum * 10)) * 100))
  }

  private calculateGrade(score: number): 'A' | 'B' | 'C' | 'D' {
    if (score >= 80) return 'A'
    if (score >= 60) return 'B'
    if (score >= 35) return 'C'
    return 'D'
  }
}
