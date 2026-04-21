import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { getApprovalLevel } from '@/lib/governance/approval-rules'
import type { Company, Contact, Grade } from '@/types'

const OUTREACH_SYSTEM_PROMPT = `You are a world-class business development expert writing on behalf of a Chinese activewear OEM/ODM factory.

FACTORY STRENGTHS:
- Specializes in activewear, sportswear, yoga wear, tennis wear, golf wear, athleisure
- Offers OEM, ODM, and White Label services
- Supports small MOQ for new clients (starting from 50-100pcs per style)
- 15+ years manufacturing experience
- Fast turnaround: 30-45 days for repeat orders
- In-house design team for ODM
- Sustainable materials available

YOUR WRITING RULES (CRITICAL):
1. NEVER start with "I hope this finds you well" or any generic opener
2. Reference something SPECIFIC about their brand — a product, a style, their market position, their social content
3. The email must sound like it was written by someone who actually looked at their brand for 10 minutes
4. Keep first touch under 150 words
5. One specific compliment + one precise value proposition + one soft CTA
6. No bullet points in first touch emails
7. Don't pitch everything — pick ONE angle that fits them best
8. Match language to recipient's country (English default, Spanish for LATAM, Portuguese for Brazil)
9. Subject line: specific, curious, NOT salesy. No "Partnership Opportunity" or "Collaboration"
10. Sign off naturally, not "Best regards" — use the context

Return ONLY valid JSON, no markdown.`

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

    const { data: scoreData } = await supabase
      .from('customer_scores')
      .select('*')
      .eq('company_id', input.companyId)
      .single()

    const grade = (company.grade as Grade) ?? 'C'
    const approvalLevel = getApprovalLevel('email_first_touch', { grade })

    const draft = await this.draftEmail(company, primaryContact, scoreData?.recommended_strategy)

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
        description: `AI drafted email to ${primaryContact?.full_name ?? 'contact'} at ${company.name}`,
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
      outputData: { outreachLogId: log?.id, grade, approvalLevel },
      status: 'completed',
    })

    return {
      success: true,
      needsApproval: approvalLevel !== 'L1',
      approvalType: approvalLevel !== 'L1' ? 'email_first_touch' : undefined,
      data: { draft, outreachLogId: log?.id },
    }
  }

  private async draftEmail(
    company: Company,
    contact: Contact | null,
    strategy?: string
  ): Promise<{ subject: string; body: string; personalizationData: Record<string, unknown> }> {
    const userMessage = `Draft a first-touch outreach email for this prospect:

COMPANY: ${company.name}
Website: ${company.website ?? 'N/A'}
Type: ${company.company_type ?? 'unknown'}
Country: ${company.country ?? 'unknown'}
Instagram: @${company.instagram_handle ?? 'N/A'} (${company.instagram_followers ?? 0} followers)
TikTok: @${company.tiktok_handle ?? 'N/A'} (${company.tiktok_followers ?? 0} followers)
Price point: ${company.price_point ?? 'unknown'}
Categories: ${company.product_categories?.join(', ') ?? 'unknown'}
Description: ${company.description ?? 'N/A'}

CONTACT: ${contact?.full_name ?? 'Founder/Buyer'}
Title: ${contact?.title ?? 'unknown'}

RECOMMENDED STRATEGY: ${strategy ?? 'Focus on small MOQ and fast turnaround'}

Return JSON:
{
  "subject": "email subject line",
  "body": "full email body (plain text, no HTML)",
  "personalizationData": {
    "hook": "what specific thing you referenced",
    "angle": "value prop angle used",
    "language": "en/es/pt"
  }
}`

    const raw = await this.callLLM(OUTREACH_SYSTEM_PROMPT, userMessage, {
      maxTokens: 800,
      temperature: 0.8,
    })

    try {
      return JSON.parse(raw)
    } catch {
      return {
        subject: `Quick question about ${company.name}'s sourcing`,
        body: raw,
        personalizationData: { hook: 'brand', angle: 'manufacturing', language: 'en' },
      }
    }
  }
}
