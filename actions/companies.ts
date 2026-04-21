'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function triggerEnrichCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  const supabase = await createServiceClient()

  await supabase.from('agent_queue').insert({
    job_type: 'enrich_company',
    payload: { companyId },
    priority: 3,
  })

  revalidatePath(`/companies/${companyId}`)
}

export async function triggerScoreCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  const supabase = await createServiceClient()

  await supabase.from('agent_queue').insert({
    job_type: 'score_company',
    payload: { companyId },
    priority: 3,
  })

  revalidatePath(`/companies/${companyId}`)
}

export async function triggerDraftOutreach(formData: FormData) {
  const companyId = formData.get('companyId') as string
  const supabase = await createServiceClient()

  await supabase.from('agent_queue').insert({
    job_type: 'draft_outreach',
    payload: { companyId },
    priority: 2,
  })

  revalidatePath(`/companies/${companyId}`)
}
