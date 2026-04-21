import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { scrapeWebsite } from '@/agents/discovery/scrapers/website-scraper'
import { createServiceClient } from '@/lib/supabase/server'

const ENRICH_SYSTEM_PROMPT = `You are an expert at finding business decision-makers and contacts.
Given company information, identify the most likely contacts and their details.
Focus on: founders, co-founders, CEOs, buyers, sourcing managers, brand managers, e-commerce leads.
Return ONLY valid JSON.`

interface EnrichInput {
  companyId: string
}

export class EnrichAgent extends BaseAgent {
  constructor() {
    super('enrich_agent')
  }

  async execute(context: AgentContext, input: EnrichInput): Promise<AgentResult> {
    const startTime = Date.now()
    const supabase = await createServiceClient()

    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', input.companyId)
      .single()

    if (!company) return { success: false, error: 'Company not found' }

    // 1. Scrape website for deeper data
    let websiteData = null
    if (company.website) {
      websiteData = await scrapeWebsite(company.website)
    }

    // 2. Try common contact pages
    const contactData = await this.scrapeContactPages(company.website)

    // 3. AI: infer contacts from all available data
    const contacts = await this.inferContacts(company, websiteData, contactData)

    // 4. Update company with enriched social data
    const updates: Record<string, unknown> = {
      status: 'enriched',
      enriched_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    if (websiteData) {
      if (!company.instagram_handle && websiteData.instagramHandle) {
        updates.instagram_handle = websiteData.instagramHandle
      }
      if (!company.tiktok_handle && websiteData.tiktokHandle) {
        updates.tiktok_handle = websiteData.tiktokHandle
      }
      if (!company.linkedin_url && websiteData.linkedinUrl) {
        updates.linkedin_url = websiteData.linkedinUrl
      }
      if (!company.description && websiteData.description) {
        updates.description = websiteData.description
      }
      updates.shopify_detected = websiteData.shopifyDetected
    }

    await supabase.from('companies').update(updates).eq('id', input.companyId)

    // 5. Save inferred contacts
    let contactsSaved = 0
    for (const contact of contacts) {
      const { error } = await supabase.from('contacts').insert({
        company_id: input.companyId,
        full_name: contact.fullName,
        first_name: contact.firstName,
        last_name: contact.lastName,
        title: contact.title,
        role_type: contact.roleType,
        decision_level: contact.decisionLevel,
        email: contact.email,
        linkedin_url: contact.linkedinUrl,
        contact_priority: contact.priority,
        reply_probability: contact.replyProbability,
        source: 'ai_inferred',
        status: 'uncontacted',
      })
      if (!error) contactsSaved++
    }

    // 6. Queue scoring
    await this.enqueueJob('score_company', { companyId: input.companyId }, 3)

    await this.logAction({
      companyId: input.companyId,
      actionType: 'enrich_company',
      outputData: { contactsSaved, websiteScraped: !!websiteData },
      status: 'completed',
      durationMs: Date.now() - startTime,
    })

    return { success: true, data: { contactsSaved } }
  }

  private async scrapeContactPages(website: string | null): Promise<string> {
    if (!website) return ''

    const pages = ['/about', '/about-us', '/team', '/contact']
    const texts: string[] = []

    for (const page of pages.slice(0, 2)) {
      try {
        const url = new URL(page, website).toString()
        const data = await scrapeWebsite(url)
        if (data) texts.push(data.bodyText.slice(0, 1000))
      } catch {}
    }

    return texts.join('\n')
  }

  private async inferContacts(
    company: Record<string, unknown>,
    websiteData: Awaited<ReturnType<typeof scrapeWebsite>>,
    contactPageText: string
  ): Promise<Array<{
    fullName: string
    firstName: string
    lastName: string
    title: string
    roleType: string
    decisionLevel: string
    email?: string
    linkedinUrl?: string
    priority: number
    replyProbability: number
  }>> {
    const userMessage = `Find decision-maker contacts for this company:

Company: ${company.name}
Domain: ${company.domain}
Type: ${company.company_type}
Instagram: @${company.instagram_handle ?? 'none'}
LinkedIn: ${company.linkedin_url ?? 'none'}
Website text: ${websiteData?.bodyText?.slice(0, 800) ?? 'none'}
Contact page text: ${contactPageText.slice(0, 800)}
Emails found on site: ${websiteData?.emails?.join(', ') ?? 'none'}

Return JSON array of contacts (max 3):
[{
  "fullName": "Jane Smith",
  "firstName": "Jane",
  "lastName": "Smith",
  "title": "Founder & CEO",
  "roleType": "founder",
  "decisionLevel": "decision_maker",
  "email": "jane@domain.com or null",
  "linkedinUrl": "https://linkedin.com/in/... or null",
  "priority": 1-10,
  "replyProbability": 0.0-1.0,
  "reasoning": "why this person"
}]`

    try {
      const raw = await this.callLLM(ENRICH_SYSTEM_PROMPT, userMessage, {
        maxTokens: 800,
        temperature: 0.3,
      })
      return JSON.parse(raw)
    } catch {
      // Fallback: create generic contact if we have email from website
      const email = websiteData?.emails?.[0]
      if (email) {
        return [{
          fullName: 'Founder / Buyer',
          firstName: 'Founder',
          lastName: '',
          title: 'Founder / Buyer',
          roleType: 'founder',
          decisionLevel: 'decision_maker',
          email,
          linkedinUrl: undefined,
          priority: 5,
          replyProbability: 0.3,
        }]
      }
      return []
    }
  }
}
