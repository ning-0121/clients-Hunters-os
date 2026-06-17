/**
 * ScoreAgent v2 — Top-Tier Multi-Dimensional Scoring
 *
 * New dimensions vs v1:
 *   + tech_stack_score    (Shopify/Klaviyo/ReCharge = sophisticated buyer)
 *   + hiring_signal_score (sourcing/ops hiring = perfect timing)
 *   + trigger_score       (new products/funding/press = momentum)
 *   + contact_quality     (real name + verified email vs info@)
 *   + market_timing       (combined urgency signal)
 *
 * Updated grade thresholds:
 *   A: ≥75  (was 80 — more achievable with better data)
 *   B: ≥55  (was 60)
 *   C: ≥30  (was 35)
 *   D: <30
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import type { Company } from '@/types'

const SCORING_SYSTEM_PROMPT = `You are an expert business development analyst for Jojofashion / Qimo Clothing,
a Chinese activewear OEM/ODM manufacturer serving DTC brands globally.

FACTORY STRENGTHS: activewear/yoga/sportswear/athleisure, 50pcs MOQ, GOTS certified organic cotton,
OEKO-TEX certified, bamboo blends, recycled fabrics, 30-45 day repeat orders, in-house design team.

TARGET CUSTOMER PROFILE (score higher if matches):
- Small-to-mid DTC activewear brand ($200K-$5M revenue range)
- Shopify store, DTC model, or Amazon FBA
- TikTok Shop seller or strong social presence
- Private label / white label buyer
- Markets: USA, Canada, UK, Australia, EU, Brazil, Mexico

NOT GOOD TARGETS (score lower):
- Established brands with locked-in factories (Nike, Adidas, Lululemon, Gymshark)
- Pure resellers / dropshippers with no sourcing relationship
- Non-apparel companies
- Luxury fashion (different manufacturing needs)

Score each dimension 0-10. Be precise and analytical.
Return ONLY valid JSON, no markdown.`

interface ScoringOutput {
  icp_fit_score:          number
  size_score:             number
  profit_potential_score: number
  reply_probability_score: number
  category_match_score:   number
  risk_score:             number
  ltv_potential_score:    number
  white_label_fit:        number
  small_order_fit:        number
  dtc_potential:          number
  tiktok_fit:             number
  latam_priority:         number
  score_reasoning:        string
  recommended_strategy:   string
  recommended_channels:   string[]
  recommended_assignee:   string
  recommended_priority:   number
}

export class ScoreAgent extends BaseAgent {
  constructor() { super('score_agent') }

  async execute(context: AgentContext, input: unknown): Promise<AgentResult> {
    const { companyId } = input as { companyId: string }
    const startTime = Date.now()
    const supabase  = await createServiceClient()

    const { data: company, error } = await supabase
      .from('companies').select('*').eq('id', companyId).single()
    if (error || !company) return { success: false, error: 'Company not found' }

    // Load contact quality signal
    const { data: contacts } = await supabase
      .from('contacts')
      .select('full_name, email, email_verified, email_confidence, reply_probability')
      .eq('company_id', companyId)
      .order('contact_priority', { ascending: false })
      .limit(3)

    const userMessage = this.buildScoringPrompt(company as Company, contacts ?? [])

    let raw: string
    try {
      raw = await this.callLLM(SCORING_SYSTEM_PROMPT, userMessage, { maxTokens: 1500, temperature: 0.3 })
    } catch (err) {
      await this.logAction({ companyId, actionType: 'score_company', inputData: { companyId },
        status: 'failed', errorMessage: String(err) })
      return { success: false, error: String(err) }
    }

    let scores: ScoringOutput
    try {
      const cleaned = raw.replace(/```(?:json)?\s*([\s\S]*?)```/, '$1').trim()
      scores = JSON.parse(cleaned)
    } catch {
      return { success: false, error: 'Failed to parse scoring response' }
    }

    // Clamp AI scores to 0-10
    const aiScoreFields: (keyof ScoringOutput)[] = [
      'icp_fit_score','size_score','profit_potential_score','reply_probability_score',
      'category_match_score','risk_score','ltv_potential_score','white_label_fit',
      'small_order_fit','dtc_potential','tiktok_fit','latam_priority',
    ]
    for (const field of aiScoreFields) {
      const val = scores[field]
      ;(scores as unknown as Record<string, number>)[field] =
        typeof val === 'number' ? Math.max(0, Math.min(10, val)) : 5
    }

    // ── Rule-based bonus scores (from enriched data, not AI) ────────────────
    const techStackScore   = this.computeTechScore(company)
    const hiringScore      = this.computeHiringScore(company)
    const triggerScore     = this.computeTriggerScore(company)
    const contactQuality   = this.computeContactQuality(contacts ?? [])
    const marketTiming     = Math.min(10, (hiringScore + triggerScore) / 2)

    const total = this.calculateTotal(scores, {
      techStackScore, hiringScore, triggerScore, contactQuality, marketTiming
    })
    const grade = this.calculateGrade(total)

    const upsertData: Record<string, unknown> = {
      company_id:             companyId,
      ...scores,
      total_score:            total,
      grade,
      model_version:          this.defaultModel,
      scored_at:              new Date().toISOString(),
      scored_by:              'ai',
    }

    // Add new score columns if schema is upgraded
    try {
      upsertData.tech_stack_score    = techStackScore
      upsertData.hiring_signal_score = hiringScore
      upsertData.trigger_score       = triggerScore
      upsertData.contact_quality_score = contactQuality
      upsertData.market_timing_score = marketTiming
    } catch {}

    await supabase.from('customer_scores').upsert(upsertData, { onConflict: 'company_id' })

    await supabase.from('companies').update({
      total_score: total,
      grade,
      status:      'scored',
      scored_at:   new Date().toISOString(),
      updated_at:  new Date().toISOString(),
    }).eq('id', companyId)

    // NOTE: auto-drafting first-touch emails is intentionally disabled. Auto
    // drafts were generic / made unverified claims and got queued before any
    // research. Emails are now created only via the human-in-the-loop 开发信工作台
    // (/companies/[id]/outreach), which grounds them in real factory caps +
    // collected data and requires approval before send.

    await this.logAction({
      companyId, actionType: 'score_company',
      inputData:  { companyId },
      outputData: { total, grade, techStackScore, hiringScore, triggerScore },
      status:     'completed',
      durationMs: Date.now() - startTime,
    })

    return { success: true, data: { total, grade, scores, techStackScore, hiringScore } }
  }

  private buildScoringPrompt(company: Company, contacts: Record<string, unknown>[]): string {
    const contactSummary = contacts.length > 0
      ? contacts.map(c =>
          `${c.full_name || 'unnamed'} (${c.email || 'no email'})` +
          (c.email_verified ? ' ✓verified' : '')
        ).join(', ')
      : 'No contacts found'

    return `Score this prospect for our activewear OEM/ODM factory:

Company: ${company.name}
Website: ${company.website ?? 'unknown'}
Type: ${company.company_type ?? 'unknown'}
Categories: ${company.product_categories?.join(', ') ?? 'unknown'}
Employees: ${company.employee_count_range ?? 'unknown'}
Country: ${company.country ?? 'unknown'}
Instagram: ${company.instagram_followers ?? 'unknown'} followers
TikTok: ${company.tiktok_followers ?? 'unknown'} followers
Price point: ${company.price_point ?? 'unknown'}
Has sourcing need: ${company.has_sourcing_need ?? 'unknown'}
Shopify: ${company.shopify_detected ?? false}
Description: ${company.description ?? 'none'}
Source: ${company.source ?? 'unknown'}
Contacts: ${contactSummary}

Return JSON:
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
  "score_reasoning": "2-3 sentence explanation with specific observations",
  "recommended_strategy": "specific actionable outreach strategy",
  "recommended_channels": ["email", "linkedin"],
  "recommended_assignee": "sales_manager or junior_sdr",
  "recommended_priority": 1-10
}`
  }

  // ── Rule-based scores ────────────────────────────────────────────────────

  private computeTechScore(company: Record<string, unknown>): number {
    let score = 0
    if (company.shopify_detected)       score += 3
    if (company.klaviyo_detected)       score += 2.5
    if (company.recharg_detected)       score += 2
    if (company.triple_whale_detected)  score += 1.5
    if (company.gorgias_detected)       score += 1
    const techStack = company.tech_stack as string[] | null
    if (techStack && techStack.length > 3) score += 1  // multi-stack = mature brand
    return Math.min(10, score)
  }

  private computeHiringScore(company: Record<string, unknown>): number {
    if (!company.hiring_signal) return 0
    const roles = company.hiring_roles as string[] | null ?? []
    const highUrgency = /sourcing|production|supply.chain|textile|garment|vendor/i
    if (roles.some(r => highUrgency.test(r))) return 9
    return 6
  }

  private computeTriggerScore(company: Record<string, unknown>): number {
    let score = 0
    if (company.funding_detected)        score += 4
    if (company.new_products_detected)   score += 3
    if (company.press_detected)          score += 2
    const triggerType = company.trigger_type as string | null
    if (triggerType === 'sustainability') score += 3  // aligns with GOTS/OEKO-TEX
    return Math.min(10, score)
  }

  private computeContactQuality(contacts: Record<string, unknown>[]): number {
    if (contacts.length === 0) return 0
    const best = contacts[0]
    let score = 0
    if (best.full_name) score += 3
    if (best.email)     score += 2
    if (best.email_verified) score += 3
    if ((best.reply_probability as number ?? 0) > 0.3) score += 2
    return Math.min(10, score)
  }

  private calculateTotal(
    scores: ScoringOutput,
    bonus: { techStackScore: number; hiringScore: number; triggerScore: number; contactQuality: number; marketTiming: number }
  ): number {
    // AI score weights (sum of abs = 11.5)
    const aiWeights: Record<string, number> = {
      icp_fit_score:          2.0,
      size_score:             1.0,
      profit_potential_score: 1.5,
      reply_probability_score: 1.5,
      category_match_score:   1.5,
      risk_score:             -1.0,
      ltv_potential_score:    1.0,
      white_label_fit:        0.5,
      small_order_fit:        0.5,
      dtc_potential:          0.5,
      tiktok_fit:             0.5,
      latam_priority:         0.5,
    }

    let aiTotal = 0; let aiWeightSum = 0
    for (const [key, weight] of Object.entries(aiWeights)) {
      const val = (scores as unknown as Record<string, number>)[key]
      if (typeof val === 'number') {
        aiTotal    += val * Math.abs(weight) * (weight < 0 ? -1 : 1)
        aiWeightSum += Math.abs(weight)
      }
    }
    const aiScore = (aiTotal / (aiWeightSum * 10)) * 100

    // Bonus scores (0-10 each, contribute up to 25 pts total)
    const bonusScore = (
      bonus.techStackScore  * 0.8 +   // up to 8 pts
      bonus.hiringScore     * 0.8 +   // up to 8 pts  ← timing signal
      bonus.triggerScore    * 0.5 +   // up to 5 pts
      bonus.contactQuality  * 0.3 +   // up to 3 pts
      bonus.marketTiming    * 0.2     // up to 2 pts  (overlap)
    ) / (0.8+0.8+0.5+0.3+0.2) * 25   // normalize to 25 pts

    // Final = 75% AI + 25% bonus signals
    return Math.max(0, Math.min(100, aiScore * 0.75 + bonusScore))
  }

  private calculateGrade(score: number): 'A' | 'B' | 'C' | 'D' {
    if (score >= 75) return 'A'
    if (score >= 55) return 'B'
    if (score >= 30) return 'C'
    return 'D'
  }
}
