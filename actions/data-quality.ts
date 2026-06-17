'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getBdIdentity } from '@/lib/bd/shared'
import { revalidatePath } from 'next/cache'

/**
 * Report bad customer info / contact details. Marks the company and enqueues a
 * re-enrichment so the system self-corrects (re-finds contacts + emails). For
 * "bad_info" it also re-tiers afterwards (enrich → score chain handles it).
 */
export async function flagCompanyData(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  const kindRaw = String(formData.get('kind') ?? 'bad_contact')
  const kind = kindRaw === 'bad_info' ? 'bad_info' : 'bad_contact'
  const note = String(formData.get('note') ?? '').slice(0, 500)
  if (!companyId) return
  const { who } = await getBdIdentity()
  try {
    const sb = await createServiceClient()
    await sb.from('companies').update({
      data_flag: kind,
      data_flag_note: note || null,
      data_flag_by: who,
      data_flag_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', companyId)

    // Self-correct: re-run enrichment (re-discovers contacts + emails).
    await sb.from('agent_queue').insert({
      job_type: 'enrich_company',
      payload: { companyId, reason: `data_flag:${kind}` },
      priority: 3,
    })
  } catch (err) {
    console.error('[flagCompanyData]', err)
  }
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/bd/today')
  revalidatePath('/manager/bd-dashboard')
}

/** Clear a data-quality flag once resolved. */
export async function clearCompanyFlag(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) return
  try {
    const sb = await createServiceClient()
    await sb.from('companies').update({
      data_flag: null, data_flag_note: null, data_flag_by: null, data_flag_at: null,
      updated_at: new Date().toISOString(),
    }).eq('id', companyId)
  } catch (err) {
    console.error('[clearCompanyFlag]', err)
  }
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/manager/bd-dashboard')
}
