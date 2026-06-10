/**
 * EnrichAgent v2 — Top-Tier Enrichment
 * Pipeline: Scrape → Technographics → Hiring Signals → Triggers → AI Contacts → Email Finder
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { scrapeWebsite }        from '@/agents/discovery/scrapers/website-scraper'
import { createServiceClient }  from '@/lib/supabase/server'
import { detectTechStack, scoreTechStack } from '@/lib/enrichment/technographics'
import { detectHiringSignals }  from '@/lib/enrichment/hiring-signals'
import { detectTriggers }       from '@/lib/enrichment/trigger-detector'
import { findEmails }           from '@/lib/enrichment/email-finder'

const ENRICH_SYSTEM_PROMPT = `You are an expert at identifying business decision-makers for activewear brands.
Given company info, website text, tech stack, and hiring data — identify the most likely contacts.
Look for founders, CEOs, Head of Sourcing, Operations Managers, or buyers.
Use all available signals: About page text, team sections, LinkedIn hints, email patterns.
If you find real names, use them. If not, leave fullName empty.
Return ONLY a raw JSON array — no markdown, no code blocks.`

interface EnrichInput { companyId: string }

interface InferredContact {
  fullName:         string
  firstName:        string
  lastName:         string
  title:            string
  roleType:         string
  decisionLevel:    string
  email?:           string
  linkedinUrl?:     string
  priority:         number
  replyProbability: number
  emailConfidence?: number
  emailSource?:     string
  emailVerified?:   boolean
}

export class EnrichAgent extends BaseAgent {
  constructor() { super('enrich_agent') }

  async execute(context: AgentContext, input: unknown): Promise<AgentResult> {
    const { companyId } = input as EnrichInput
    const startTime = Date.now()
    const supabase  = await createServiceClient()

    const { data: company } = await supabase
      .from('companies').select('*').eq('id', companyId).single()
    if (!company) return { success: false, error: 'Company not found' }

    console.log(`[EnrichAgent v2] 🔍 ${company.name}`)

    // 1. Scrape main page + contact pages
    const websiteData = company.website ? await scrapeWebsite(company.website) : null
    const { contactPageText, contactPageHtml, rawHtml } =
      await this.scrapeContactPages(company.website)
    const namesFromHtml = this.extractNamesFromHtml(contactPageHtml)

    // 2. Technographics
    const allHtml  = (rawHtml ?? '') + (websiteData?.bodyText ?? '')
    const techStack = await detectTechStack(allHtml, company.domain)
    const techScore = scoreTechStack(techStack)
    if (techStack.detected.length) console.log(`[EnrichAgent] 📊 Tech: ${techStack.detected.join(', ')}`)

    // 3. Hiring signals
    const hiringSignal = await detectHiringSignals(company.website ?? '')
    if (hiringSignal.detected) console.log(`[EnrichAgent] 💼 Hiring: ${hiringSignal.roles.join(', ')}`)

    // 4. Triggers
    const triggerResult = await detectTriggers({
      website:  company.website ?? '',
      bodyText: websiteData?.bodyText ?? company.description ?? '',
    })
    if (triggerResult.primaryTrigger) {
      console.log(`[EnrichAgent] 🎯 Trigger: ${triggerResult.primaryTrigger.type}`)
    }

    // 5. AI contact inference
    const contacts = await this.inferContacts(
      company, websiteData, contactPageText, namesFromHtml, techStack, hiringSignal
    )

    // 6. Email finder (Hunter API + SMTP verification waterfall)
    const namedCandidates = contacts
      .filter(c => c.firstName && c.lastName)
      .map(c => ({ firstName: c.firstName, lastName: c.lastName, title: c.title }))

    const emailResults = await findEmails({
      domain:         company.domain ?? '',
      existingEmails: websiteData?.emails ?? [],
      candidates:     namedCandidates,
      skipSmtp:       !company.domain,
    })
    if (emailResults.contacts.length) {
      console.log(`[EnrichAgent] 📧 Emails found: ${emailResults.contacts.length} (${emailResults.domainStatus})`)
    }

    // 7. Update company
    const safeUpdate: Record<string, unknown> = {
      status:          'enriched',
      enriched_at:     new Date().toISOString(),
      updated_at:      new Date().toISOString(),
    }

    // Only update techstack cols if they exist in schema (graceful fallback)
    try {
      Object.assign(safeUpdate, {
        shopify_detected:  techStack.shopify || (websiteData?.shopifyDetected ?? false),
        hiring_signal:     hiringSignal.detected,
        hiring_roles:      hiringSignal.roles,
        trigger_type:      triggerResult.primaryTrigger?.type ?? null,
        trigger_detail:    triggerResult.primaryTrigger?.detail ?? null,
        tech_stack:        techStack.detected,
        klaviyo_detected:  techStack.klaviyo,
        new_products_detected: triggerResult.triggers.some(t => t.type === 'new_product'),
      })
    } catch {}

    if (websiteData) {
      if (!company.instagram_handle && websiteData.instagramHandle)
        safeUpdate.instagram_handle = websiteData.instagramHandle
      if (!company.tiktok_handle && websiteData.tiktokHandle)
        safeUpdate.tiktok_handle = websiteData.tiktokHandle
      if (!company.linkedin_url && websiteData.linkedinUrl)
        safeUpdate.linkedin_url = websiteData.linkedinUrl
      if (!company.description && websiteData.description)
        safeUpdate.description = websiteData.description
    }

    await supabase.from('companies').update(safeUpdate).eq('id', companyId)

    // 8. Save trigger event
    if (triggerResult.primaryTrigger) {
      try {
        await supabase.from('trigger_events').insert({
          company_id:    companyId,
          trigger_type:  triggerResult.primaryTrigger.type,
          trigger_source: 'website',
          detail:        triggerResult.primaryTrigger.detail,
          url:           company.website,
        })
      } catch {}
    }

    // 9. Save contacts
    let contactsSaved = 0
    const merged = this.mergeContactsWithEmails(contacts, emailResults.contacts)

    for (const contact of merged) {
      const genericPrefixes = ['info@','hello@','contact@','support@','admin@','team@','sales@']
      if (!contact.fullName && contact.email && genericPrefixes.some(p => contact.email!.startsWith(p))) continue

      const row: Record<string, unknown> = {
        company_id:       companyId,
        full_name:        contact.fullName || null,
        first_name:       contact.firstName || null,
        last_name:        contact.lastName || null,
        title:            contact.title,
        role_type:        contact.roleType,
        decision_level:   contact.decisionLevel,
        email:            contact.email || null,
        linkedin_url:     contact.linkedinUrl || null,
        contact_priority: contact.priority,
        reply_probability: contact.replyProbability,
        source:           'ai_inferred',
        status:           'uncontacted',
      }

      // Add new cols if schema is upgraded
      try {
        row.email_confidence = contact.emailConfidence ?? null
        row.email_source     = contact.emailSource ?? 'ai_inferred'
        row.email_verified   = contact.emailVerified ?? false
      } catch {}

      const { error } = await supabase.from('contacts').insert(row)
      if (!error) contactsSaved++
    }

    // Fallback: save scraped email
    if (contactsSaved === 0 && websiteData?.emails?.length) {
      const genericPrefixes = ['info@','hello@','support@','admin@','team@','contact@']
      const best = websiteData.emails.find(e => !genericPrefixes.some(p => e.startsWith(p)))
        ?? websiteData.emails[0]
      if (best) {
        await supabase.from('contacts').insert({
          company_id: companyId, full_name: null, title: 'Brand Contact',
          role_type: 'unknown', decision_level: 'unknown', email: best,
          contact_priority: 2, reply_probability: 0.15,
          source: 'website_email', status: 'uncontacted',
        })
        contactsSaved++
      }
    }

    // 10. Queue scoring
    await this.enqueueJob('score_company', { companyId }, 3)

    await this.logAction({
      companyId, actionType: 'enrich_company',
      outputData: {
        contactsSaved, techScore,
        techDetected:     techStack.detected,
        hiringDetected:   hiringSignal.detected,
        triggerType:      triggerResult.primaryTrigger?.type,
        emailsFound:      emailResults.contacts.length,
        enrichmentVersion: 2,
      },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { contactsSaved, techScore, emailsFound: emailResults.contacts.length } }
  }

  private async scrapeContactPages(website: string | null): Promise<{
    contactPageText: string; contactPageHtml: string; rawHtml?: string
  }> {
    if (!website) return { contactPageText: '', contactPageHtml: '' }
    const pages = ['/about', '/about-us', '/team', '/our-story', '/pages/about']
    const texts: string[] = []
    const htmlChunks: string[] = []
    let mainHtml: string | undefined

    try {
      const r = await fetch(website, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      if (r.ok) mainHtml = await r.text()
    } catch {}

    for (const page of pages.slice(0, 3)) {
      try {
        const url = new URL(page, website).toString()
        const res = await fetch(url, {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
          signal: AbortSignal.timeout(6000),
        })
        if (!res.ok) continue
        const html = await res.text()
        htmlChunks.push(html.slice(0, 8000))
        texts.push(html.replace(/<script[\s\S]*?<\/script>/gi, '')
          .replace(/<style[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 2000))
      } catch {}
    }
    return { contactPageText: texts.join('\n'), contactPageHtml: htmlChunks.join('\n'), rawHtml: mainHtml }
  }

  private extractNamesFromHtml(html: string): string[] {
    if (!html) return []
    const names: string[] = []
    for (const m of html.matchAll(/"@type"\s*:\s*"Person"[\s\S]{0,300}"name"\s*:\s*"([^"]+)"/g))
      names.push(m[1])
    const author = html.match(/<meta[^>]+name=["']author["'][^>]+content=["']([^"']+)/i)
    if (author) names.push(author[1])
    for (const m of html.matchAll(
      /(?:founded\s+by|hi,?\s*i'?m|my\s+name\s+is|meet\s+)\s*([A-Z][a-z]+\s+[A-Z][a-z]+)/gi
    )) names.push(m[1])
    for (const m of html.matchAll(
      /([A-Z][a-z]+\s+[A-Z][a-z]+),?\s*<\/?\w*>?\s*(?:Founder|CEO|President|Director|Owner)/g
    )) names.push(m[1])
    return [...new Set(names)].slice(0, 5)
  }

  private async inferContacts(
    company: Record<string, unknown>,
    websiteData: Awaited<ReturnType<typeof scrapeWebsite>>,
    contactPageText: string,
    namesFromHtml: string[],
    techStack: { detected: string[] },
    hiringSignal: { detected: boolean; roles: string[] },
  ): Promise<InferredContact[]> {
    const msg = `Find decision-maker contacts for this activewear brand:

Company: ${company.name as string}
Domain: ${company.domain as string}
Tech stack: ${techStack.detected.join(', ') || 'unknown'}
${hiringSignal.detected ? `Hiring roles: ${hiringSignal.roles.join(', ')}` : ''}
Emails on site: ${websiteData?.emails?.join(', ') ?? 'none'}
Names from HTML: ${namesFromHtml.join(', ') || 'none'}
Website text: ${websiteData?.bodyText?.slice(0, 500) ?? 'none'}
About/Team page: ${contactPageText.slice(0, 800)}

Return JSON array (max 3). Empty string if name unknown.
[{"fullName":"Jane Smith","firstName":"Jane","lastName":"Smith","title":"Founder & CEO",
  "roleType":"founder","decisionLevel":"decision_maker","email":"jane@domain.com",
  "linkedinUrl":null,"priority":9,"replyProbability":0.45}]`

    try {
      const raw     = await this.callLLM(ENRICH_SYSTEM_PROMPT, msg, { maxTokens: 800, temperature: 0.2 })
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
      const parsed  = JSON.parse(cleaned)
      return Array.isArray(parsed) ? parsed as InferredContact[] : []
    } catch { return [] }
  }

  private mergeContactsWithEmails(
    contacts: InferredContact[],
    emailCandidates: Array<{ email: string; confidence: number; source: string }>,
  ): InferredContact[] {
    const result: InferredContact[] = []
    for (const c of contacts) {
      // Match on full first name AND at least 3 chars of last name to avoid spurious 3-char matches
      const found = emailCandidates.find(e => {
        const em = e.email.toLowerCase()
        const fn = c.firstName?.toLowerCase() ?? ''
        const ln = c.lastName?.toLowerCase() ?? ''
        if (!fn || fn.length < 3) return false
        return em.includes(fn) || (ln.length >= 3 && em.includes(fn.slice(0, 4)) && em.includes(ln.slice(0, 4)))
      })
      result.push({
        ...c,
        email:          c.email || found?.email,
        emailConfidence: found?.confidence,
        emailSource:    found?.source,
        emailVerified:  found?.source === 'hunter' || found?.source === 'pattern_smtp',
      })
    }
    for (const ec of emailCandidates) {
      if (result.some(r => r.email === ec.email)) continue
      result.push({
        fullName:'', firstName:'', lastName:'', title:'Brand Contact',
        roleType:'unknown', decisionLevel:'unknown', email: ec.email,
        priority:4, replyProbability: ec.confidence * 0.4,
        emailConfidence: ec.confidence, emailSource: ec.source,
        emailVerified: ec.source === 'hunter',
      })
    }
    return result.slice(0, 5)
  }
}
