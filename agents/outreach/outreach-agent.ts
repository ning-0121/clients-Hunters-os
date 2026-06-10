/**
 * OutreachAgent v2 — Trigger-Personalized First-Touch Emails
 *
 * Improvements vs v1:
 *   + Reads hiring_signal / trigger_type / tech_stack from enriched company data
 *   + Selects the strongest personalization hook automatically
 *   + Anti-spam guard: skips if email already sent in last 30 days
 *   + Structured "hook_type" tracked in personalizationData for analytics
 *   + Language-aware subject lines for LATAM/Brazil
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { getApprovalLevel } from '@/lib/governance/approval-rules'
import { hiringIcebreaker } from '@/lib/enrichment/hiring-signals'
import type { Company, Contact, Grade } from '@/types'

const OUTREACH_SYSTEM_PROMPT = `You are a world-class business development expert writing on behalf of Qimo Clothing, a Chinese activewear OEM/ODM manufacturer. You write as Alex from Jojofashion (jojofashion.us), the international sales arm.

FACTORY (Qimo Clothing) STRENGTHS:
- Specializes in activewear, sportswear, yoga wear, tennis wear, golf wear, athleisure
- OEM (make to spec), ODM (use our designs), and White Label services
- Small MOQ for new clients: starting from 50pcs per style
- 15+ years manufacturing experience
- Fast turnaround: 30-45 days for repeat orders, 60-75 days for new styles
- In-house design & pattern-making team for ODM
- Sustainable: GOTS organic cotton, OEKO-TEX certified, recycled fabrics, bamboo blends
- Shopify/DTC brand experience — understands fast fashion cycles

YOUR WRITING RULES (CRITICAL):
1. NEVER start with "I hope this finds you well" or any generic opener
2. Use the provided PERSONALIZATION HOOK as the opening sentence — it's already researched, don't rewrite it
3. One specific observation + one precise value prop + one soft CTA
4. Keep total email under 150 words
5. No bullet points in first touch emails
6. Pick ONE angle — don't pitch everything
7. Match language to recipient's country (English default, Spanish for LATAM, Portuguese for Brazil)
8. Subject line: specific and curious, NOT salesy. Never use "Partnership Opportunity" or "Collaboration"
9. Sign as "Alex" — casual, no "Best regards"
10. If hook is about hiring: acknowledge their growth stage, offer to help with the production bottleneck
11. If hook is about sustainability: lead with GOTS/OEKO-TEX alignment
12. If hook is about new products: lead with MOQ flexibility and lead time
13. If hook is about funding: lead with scale-up manufacturing capacity

Return ONLY valid JSON, no markdown.`

interface DraftResult {
  subject: string
  body: string
  personalizationData: Record<string, unknown>
}

// Anti-spam: check if we already contacted this company/contact recently
async function checkAntiSpam(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  companyId: string,
  contactId?: string,
): Promise<{ blocked: boolean; reason?: string }> {
  // Check outreach_logs for sent emails in last 30 days
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const query = supabase
    .from('outreach_logs')
    .select('id, created_at, status')
    .eq('company_id', companyId)
    .eq('channel', 'email')
    .eq('direction', 'outbound')
    .gte('created_at', cutoff)
    .in('status', ['sent', 'approved', 'pending_approval'])

  const { data: recentLogs } = await query
  if (recentLogs && recentLogs.length > 0) {
    return {
      blocked: true,
      reason: `Already has ${recentLogs.length} outreach log(s) in last 30 days (most recent: ${recentLogs[0].created_at})`,
    }
  }

  // Also check if contact was recently emailed
  if (contactId) {
    const { data: contactLogs } = await supabase
      .from('outreach_logs')
      .select('id')
      .eq('contact_id', contactId)
      .eq('direction', 'outbound')
      .gte('created_at', cutoff)
    if (contactLogs && contactLogs.length > 0) {
      return { blocked: true, reason: 'Contact already emailed in last 30 days' }
    }
  }

  return { blocked: false }
}

/**
 * Build the best personalization hook from enriched company signals.
 * Priority: hiring > funding > sustainability > new_product > scaling > tech > generic
 */
function selectPersonalizationHook(company: Record<string, unknown>): {
  hookType: string
  hookText: string
  suggestedAngle: string
} {
  const name = (company.name as string) ?? 'your brand'

  // 1. Hiring signal (highest priority — timing-based)
  if (company.hiring_signal) {
    const roles = (company.hiring_roles as string[]) ?? []
    const hiringData = { detected: true, roles, urgency: 'high' as const, score: 9 }
    const icebreaker = hiringIcebreaker(hiringData, name)
    if (icebreaker) {
      return {
        hookType: 'hiring',
        hookText: icebreaker,
        suggestedAngle: 'production capacity & lead time flexibility',
      }
    }
  }

  // 2. Funding signal
  const triggerType = company.trigger_type as string | null
  if (triggerType === 'funding' || company.funding_detected) {
    return {
      hookType: 'funding',
      hookText: `Congrats on the recent funding — scaling production capacity is usually one of the first operational questions that comes up after a raise.`,
      suggestedAngle: 'scale-up manufacturing with flexible MOQ',
    }
  }

  // 3. Sustainability focus (aligns directly with GOTS/OEKO-TEX)
  if (triggerType === 'sustainability') {
    return {
      hookType: 'sustainability',
      hookText: `The organic/sustainable focus on ${name}'s site caught my attention — we're GOTS and OEKO-TEX certified, which most factories in our MOQ range aren't.`,
      suggestedAngle: 'certified sustainable manufacturing at small MOQ',
    }
  }

  // 4. New product launch
  if (triggerType === 'new_product' || company.new_products_detected) {
    const detail = company.trigger_detail as string | null
    const hookText = detail && detail.includes('new products:')
      ? `Saw the new collection drop (${detail.replace('new products: ', '')}) — launching consistently is exactly where factory relationships matter most for lead time.`
      : `Noticed the recent new product launches on ${name}'s site — lead time predictability is usually the constraint at that stage.`
    return {
      hookType: 'new_product',
      hookText,
      suggestedAngle: 'fast turnaround + small MOQ for new style testing',
    }
  }

  // 5. Press / scaling
  if (triggerType === 'press') {
    return {
      hookType: 'press',
      hookText: `Saw some press coverage on ${name} — brands at that visibility stage usually find MOQ flexibility matters more than price.`,
      suggestedAngle: 'flexible manufacturing partner for growing brand',
    }
  }

  if (triggerType === 'scaling') {
    return {
      hookType: 'scaling',
      hookText: `The expansion into new markets/channels caught my eye — scaling distribution usually creates supply chain pressure faster than expected.`,
      suggestedAngle: 'reliable supply chain partner with fast repeat orders',
    }
  }

  // 6. Tech stack (Shopify/TikTok signal)
  if (company.tiktok_followers && (company.tiktok_followers as number) > 10000) {
    return {
      hookType: 'tiktok',
      hookText: `${name}'s TikTok presence is impressive — DTC brands scaling through social usually hit MOQ constraints with their current factories first.`,
      suggestedAngle: 'small MOQ + fast restock for viral moments',
    }
  }

  if (company.shopify_detected) {
    return {
      hookType: 'shopify_dtc',
      hookText: `Came across ${name} while researching Shopify activewear brands — the range looks well-curated.`,
      suggestedAngle: 'small MOQ white-label manufacturing for DTC brands',
    }
  }

  // 7. Generic (Instagram-based or description-based)
  const followers = (company.instagram_followers as number) ?? 0
  if (followers > 5000) {
    return {
      hookType: 'instagram',
      hookText: `Came across ${name} on Instagram — the brand aesthetic fits really well with what we work on for DTC activewear brands.`,
      suggestedAngle: 'manufacturing partner for growing DTC brand',
    }
  }

  return {
    hookType: 'generic',
    hookText: `Came across ${name} while researching activewear brands — the positioning looks like a good fit for what we do.`,
    suggestedAngle: 'OEM/ODM manufacturing with small MOQ',
  }
}

export class OutreachAgent extends BaseAgent {
  constructor() {
    super('outreach_agent')
  }

  async execute(context: AgentContext, input: { companyId: string }): Promise<AgentResult> {
    const supabase = await createServiceClient()

    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', input.companyId)
      .single()

    if (!company) return { success: false, error: 'Company not found' }

    const { data: contacts } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', input.companyId)
      .eq('status', 'uncontacted')
      .order('contact_priority', { ascending: false })
      .limit(1)

    const primaryContact = contacts?.[0] ?? null

    // Anti-spam check
    const spamCheck = await checkAntiSpam(supabase, input.companyId, primaryContact?.id)
    if (spamCheck.blocked) {
      await this.logAction({
        companyId: input.companyId,
        actionType: 'draft_email',
        outputData: { blocked: true, reason: spamCheck.reason },
        status: 'skipped',
      })
      return { success: false, error: `Anti-spam blocked: ${spamCheck.reason}` }
    }

    const { data: scoreData } = await supabase
      .from('customer_scores')
      .select('*')
      .eq('company_id', input.companyId)
      .single()

    const grade = (company.grade as Grade) ?? 'C'
    const approvalLevel = getApprovalLevel('email_first_touch', { grade })

    // Select best personalization hook from enriched signals
    const hook = selectPersonalizationHook(company as Record<string, unknown>)

    const draft = await this.draftEmail(
      company as unknown as Company,
      primaryContact as Contact | null,
      hook,
      scoreData?.recommended_strategy,
    )

    const { data: log } = await supabase
      .from('outreach_logs')
      .insert({
        company_id: input.companyId,
        contact_id: primaryContact?.id,
        channel: 'email',
        direction: 'outbound',
        subject: draft.subject,
        body: draft.body,
        personalization_data: draft.personalizationData,
        ab_test_group: Math.random() > 0.5 ? 'A' : 'B',
        status: approvalLevel === 'L1' ? 'approved' : 'pending_approval',
        executed_by: 'ai',
      })
      .select('id')
      .single()

    if (approvalLevel !== 'L1' && log?.id) {
      await this.createApproval({
        companyId: input.companyId,
        contactId: primaryContact?.id,
        approvalLevel: approvalLevel as 'L2' | 'L3',
        approvalType: 'email_first_touch',
        title: `Send first touch email to ${company.name}`,
        description: `AI drafted email to ${primaryContact?.full_name ?? 'contact'} at ${company.name} [hook: ${hook.hookType}]`,
        actionPayload: { outreachLogId: log.id, draft },
        riskLevel: grade === 'A' ? 'high' : 'medium',
      })
    }

    if (approvalLevel === 'L1' && log?.id) {
      await this.enqueueJob('send_email', { outreachLogId: log.id }, grade === 'A' ? 2 : 3)
    }

    await this.logAction({
      companyId: input.companyId,
      contactId: primaryContact?.id,
      actionType: 'draft_email',
      outputData: { outreachLogId: log?.id, grade, approvalLevel, hookType: hook.hookType },
      status: 'completed',
    })

    return {
      success: true,
      needsApproval: approvalLevel !== 'L1',
      approvalType: approvalLevel !== 'L1' ? 'email_first_touch' : undefined,
      data: { draft, outreachLogId: log?.id, hookType: hook.hookType },
    }
  }

  private async draftEmail(
    company: Company,
    contact: Contact | null,
    hook: { hookType: string; hookText: string; suggestedAngle: string },
    strategy?: string,
  ): Promise<DraftResult> {
    const country = (company as unknown as Record<string, unknown>).country as string | null
    const isLatam = country && ['Mexico', 'Colombia', 'Brazil', 'Argentina', 'Peru', 'Chile', 'Venezuela'].includes(country)
    const lang = country === 'Brazil' ? 'pt' : isLatam ? 'es' : 'en'

    const userMessage = `Draft a first-touch outreach email for this prospect.

COMPANY: ${company.name}
Website: ${company.website ?? 'N/A'}
Country: ${country ?? 'unknown'}
Instagram: @${(company as unknown as Record<string, unknown>).instagram_handle ?? 'N/A'} (${(company as unknown as Record<string, unknown>).instagram_followers ?? 0} followers)
TikTok: @${(company as unknown as Record<string, unknown>).tiktok_handle ?? 'N/A'} (${(company as unknown as Record<string, unknown>).tiktok_followers ?? 0} followers)
Price point: ${(company as unknown as Record<string, unknown>).price_point ?? 'unknown'}
Categories: ${company.product_categories?.join(', ') ?? 'unknown'}
Description: ${company.description ?? 'N/A'}

CONTACT: ${contact?.full_name ?? 'Founder/Buyer'}
Title: ${contact?.title ?? 'unknown'}

PERSONALIZATION HOOK (use this as your opening sentence, don't rewrite it):
"${hook.hookText}"

SUGGESTED ANGLE: ${hook.suggestedAngle}
RECOMMENDED STRATEGY: ${strategy ?? 'Focus on small MOQ and fast turnaround'}
LANGUAGE: ${lang}

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body (plain text). Start with the personalization hook. Keep under 150 words. Sign as Alex.",
  "personalizationData": {
    "hook": "${hook.hookText.slice(0, 80)}...",
    "hookType": "${hook.hookType}",
    "angle": "${hook.suggestedAngle}",
    "language": "${lang}"
  }
}`

    const raw = await this.callLLM(OUTREACH_SYSTEM_PROMPT, userMessage, {
      maxTokens: 800,
      temperature: 0.75,
    })

    try {
      const cleaned = raw.replace(/```(?:json)?\s*([\s\S]*?)```/, '$1').trim()
      const parsed = JSON.parse(cleaned)
      // Ensure hookType is always tracked
      if (parsed.personalizationData) {
        parsed.personalizationData.hookType = hook.hookType
      }
      return parsed
    } catch {
      return {
        subject: `Quick question about ${company.name}'s sourcing`,
        body: raw,
        personalizationData: { hook: hook.hookText, hookType: hook.hookType, angle: hook.suggestedAngle, language: lang },
      }
    }
  }
}
