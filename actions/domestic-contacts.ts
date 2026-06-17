'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { findDomesticContacts } from '@/lib/enrichment/domestic-contacts'
import { revalidatePath } from 'next/cache'

/**
 * Find domestic (China) contact details via Serper + website, then save them.
 * Creates/updates a "网络检索" contact with the best phone / email / WeChat and
 * stashes everything found on the company for reference.
 */
export async function triggerDomesticContactLookup(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) return
  try {
    const sb = await createServiceClient()
    const { data: company } = await sb.from('companies').select('name, website, source_raw').eq('id', companyId).single()
    if (!company) return

    const found = await findDomesticContacts(company.name, company.website)
    const total = found.phones.length + found.emails.length + found.wechats.length

    // Stash the full result on the company for transparency.
    const sourceRaw = (company.source_raw as Record<string, unknown> | null) ?? {}
    await sb.from('companies').update({
      source_raw: { ...sourceRaw, domestic_contacts: found },
      updated_at: new Date().toISOString(),
    }).eq('id', companyId)

    if (total > 0) {
      // Upsert a single "web-search" contact carrying the best channels.
      const { data: existing } = await sb.from('contacts')
        .select('id').eq('company_id', companyId).eq('email_source', 'serper_domestic').limit(1).maybeSingle()
      const row = {
        company_id: companyId,
        full_name: null as string | null,
        title: '网络检索联系方式',
        email: found.emails[0] ?? null,
        phone: found.phones[0] ?? null,
        whatsapp: found.wechats[0] ?? null,   // store WeChat id here
        email_source: 'serper_domestic',
        email_verified: false,
        contact_priority: 2,
        status: 'uncontacted',
      }
      if (existing) await sb.from('contacts').update(row).eq('id', existing.id)
      else await sb.from('contacts').insert(row)
    }
  } catch (err) {
    console.error('[triggerDomesticContactLookup]', err)
  }
  revalidatePath(`/companies/${companyId}`)
}
