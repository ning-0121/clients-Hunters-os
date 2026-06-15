'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { apolloFindContacts, apolloPriority, apolloRoleType, apolloConfigured } from '@/lib/enrichment/apollo'
import { revalidatePath } from 'next/cache'

/**
 * Find decision-maker contacts for a company via Apollo and save new ones.
 * Synchronous (Apollo search ~1-3s). Dedups by LinkedIn URL / full name.
 * No-ops with a clear signal if APOLLO_API_KEY isn't set.
 */
export async function triggerApolloLookup(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return

  const sb = await createServiceClient()
  const { data: company } = await sb.from('companies').select('domain, source_raw').eq('id', companyId).single()
  if (!company) return

  if (!apolloConfigured()) {
    // Surface a clear status on the page so it's obvious the key is missing.
    const sourceRaw = { ...((company.source_raw as Record<string, unknown>) ?? {}), apollo: { error: 'APOLLO_API_KEY 未配置', at: new Date().toISOString() } }
    await sb.from('companies').update({ source_raw: sourceRaw }).eq('id', companyId)
    revalidatePath(`/companies/${companyId}`)
    return
  }

  const people = await apolloFindContacts({ domain: company.domain, limit: 8 })

  // Dedup against existing contacts (by linkedin_url or full_name).
  const { data: existing } = await sb.from('contacts').select('full_name, linkedin_url').eq('company_id', companyId)
  const seenName = new Set((existing ?? []).map((c) => (c.full_name ?? '').toLowerCase()).filter(Boolean))
  const seenUrl = new Set((existing ?? []).map((c) => c.linkedin_url).filter(Boolean))

  let saved = 0
  for (const p of people) {
    if ((p.linkedinUrl && seenUrl.has(p.linkedinUrl)) || seenName.has(p.fullName.toLowerCase())) continue
    const { error } = await sb.from('contacts').insert({
      company_id:       companyId,
      full_name:        p.fullName || null,
      first_name:       p.firstName || null,
      last_name:        p.lastName || null,
      title:            p.title || null,
      role_type:        apolloRoleType(p.title),
      decision_level:   apolloPriority(p) >= 8 ? 'decision_maker' : 'influencer',
      email:            p.email || null,
      linkedin_url:     p.linkedinUrl || null,
      contact_priority: apolloPriority(p),
      reply_probability: p.email ? 0.3 : 0.15,
      source:           'apollo',
      status:           'uncontacted',
    })
    if (!error) saved++
  }

  const sourceRaw = { ...((company.source_raw as Record<string, unknown>) ?? {}), apollo: { found: people.length, saved, at: new Date().toISOString() } }
  await sb.from('companies').update({ source_raw: sourceRaw, updated_at: new Date().toISOString() }).eq('id', companyId)

  revalidatePath(`/companies/${companyId}`)
}
