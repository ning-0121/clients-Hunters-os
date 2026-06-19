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
import { discoverPeople }       from '@/lib/enrichment/contact-discovery'
import { toPersonCandidate, type PersonCandidate } from '@/lib/enrichment/contact-types'

const ENRICH_SYSTEM_PROMPT = `You are an expert at identifying business decision-makers for activewear brands.
Given company info, website text, tech stack, and hiring data — identify the most likely contacts.
Look for founders, CEOs, Head of Sourcing, Operations Managers, or buyers.
Use all available signals: About page text, team sections, LinkedIn hints, email patterns.
If you find real names, use them. If not, leave fullName empty.
Return ONLY a raw JSON array — no markdown, no code blocks.`

interface EnrichInput { companyId: string; roleTarget?: string[] }

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
    const { companyId, roleTarget } = input as EnrichInput
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

    // 5. AI contact inference (website/about-page derived) — fed into the waterfall.
    const aiContacts = await this.inferContacts(
      company, websiteData, contactPageText, namesFromHtml, techStack, hiringSignal
    )
    const aiCandidates: PersonCandidate[] = aiContacts
      .filter(c => c.firstName && c.lastName)
      .map(c => toPersonCandidate({
        firstName: c.firstName, lastName: c.lastName, fullName: c.fullName,
        title: c.title, email: c.email, linkedinUrl: c.linkedinUrl ?? undefined,
        source: 'ai_inferred',
      }))

    // 6. Contact discovery waterfall: Apollo → RocketReach → X-Ray → GitHub + the
    //    AI/website candidates, all verified in ONE Hunter/SMTP pass. This finds the
    //    real Sourcing/Production decision-maker AND confirms a verified email.
    const discovered = await discoverPeople({
      domain:          company.domain ?? null,
      companyName:     (company.name as string) ?? null,
      website:         (company.website as string) ?? null,
      existingEmails:  websiteData?.emails ?? [],
      roleTarget,
      extraCandidates: aiCandidates,
      limit:           8,
    })
    const verifiedCount = discovered.filter(d => d.emailVerified).length
    if (discovered.length) {
      console.log(`[EnrichAgent] 📇 Contacts: ${discovered.length} (${verifiedCount} verified email)`)
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

    // 9. Save discovered contacts (dedupe against existing by name / email / LinkedIn).
    const { data: existingContacts } = await supabase
      .from('contacts').select('full_name, email, linkedin_url').eq('company_id', companyId)
    const seenName  = new Set((existingContacts ?? []).map(c => (c.full_name ?? '').toLowerCase()).filter(Boolean))
    const seenEmail = new Set((existingContacts ?? []).map(c => (c.email ?? '').toLowerCase()).filter(Boolean))
    const seenUrl   = new Set((existingContacts ?? []).map(c => c.linkedin_url).filter(Boolean))
    const genericPrefixes = ['info@','hello@','contact@','support@','admin@','team@','sales@']

    let contactsSaved = 0
    for (const c of discovered) {
      const nameLc  = (c.fullName ?? '').toLowerCase()
      const emailLc = (c.email ?? '').toLowerCase()
      if (nameLc && seenName.has(nameLc)) continue
      if (emailLc && seenEmail.has(emailLc)) continue
      if (c.linkedinUrl && seenUrl.has(c.linkedinUrl)) continue
      if (!c.fullName && emailLc && genericPrefixes.some(p => emailLc.startsWith(p))) continue

      const { error } = await supabase.from('contacts').insert({
        company_id:        companyId,
        full_name:         c.fullName,
        first_name:        c.firstName,
        last_name:         c.lastName,
        title:             c.title || null,
        role_type:         c.roleType,
        decision_level:    c.decisionLevel,
        email:             c.email,
        linkedin_url:      c.linkedinUrl,
        contact_priority:  c.contactPriority,
        reply_probability: c.replyProbability,
        email_confidence:  c.emailConfidence,
        email_source:      c.emailSource,
        email_verified:    c.emailVerified,
        source:            c.source,
        status:            'uncontacted',
      })
      if (!error) { contactsSaved++; if (nameLc) seenName.add(nameLc); if (emailLc) seenEmail.add(emailLc) }
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
        emailsFound:      discovered.filter(d => d.email).length,
        verifiedContacts: verifiedCount,
        enrichmentVersion: 3,
      },
      status: 'completed', durationMs: Date.now() - startTime,
    })

    return { success: true, data: { contactsSaved, techScore, verifiedContacts: verifiedCount } }
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

}
