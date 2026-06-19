'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { discoverPeople } from '@/lib/enrichment/contact-discovery'
import { revalidatePath } from 'next/cache'

/**
 * Manual "find decision-makers" action for a company.
 *
 * Runs the full Contact Discovery waterfall (Apollo → RocketReach → X-Ray →
 * GitHub) with email verification, and saves new verified/likely contacts.
 * Dedups by full name / email / LinkedIn URL. Sources without an API key are
 * skipped silently — if none are configured, nothing is found (no-op).
 *
 * (Kept the `triggerApolloLookup` name so existing page forms keep working.)
 */
export async function triggerApolloLookup(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return

  const sb = await createServiceClient()
  const { data: company } = await sb
    .from('companies')
    .select('name, domain, website, source_raw')
    .eq('id', companyId)
    .single()
  if (!company) return

  const discovered = await discoverPeople({
    domain:      company.domain,
    companyName: company.name as string,
    website:     company.website as string,
    limit:       8,
  })

  // Dedup against existing contacts (by full_name / email / linkedin_url).
  const { data: existing } = await sb.from('contacts').select('full_name, email, linkedin_url').eq('company_id', companyId)
  const seenName  = new Set((existing ?? []).map((c) => (c.full_name ?? '').toLowerCase()).filter(Boolean))
  const seenEmail = new Set((existing ?? []).map((c) => (c.email ?? '').toLowerCase()).filter(Boolean))
  const seenUrl   = new Set((existing ?? []).map((c) => c.linkedin_url).filter(Boolean))

  let saved = 0
  let verified = 0
  for (const c of discovered) {
    const nameLc = (c.fullName ?? '').toLowerCase()
    const emailLc = (c.email ?? '').toLowerCase()
    if (nameLc && seenName.has(nameLc)) continue
    if (emailLc && seenEmail.has(emailLc)) continue
    if (c.linkedinUrl && seenUrl.has(c.linkedinUrl)) continue

    const { error } = await sb.from('contacts').insert({
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
    if (!error) {
      saved++
      if (c.emailVerified) verified++
      if (nameLc) seenName.add(nameLc)
      if (emailLc) seenEmail.add(emailLc)
    }
  }

  const sourceRaw = {
    ...((company.source_raw as Record<string, unknown>) ?? {}),
    contact_discovery: { found: discovered.length, saved, verified, at: new Date().toISOString() },
  }
  await sb.from('companies').update({ source_raw: sourceRaw, updated_at: new Date().toISOString() }).eq('id', companyId)

  revalidatePath(`/companies/${companyId}`)
}
