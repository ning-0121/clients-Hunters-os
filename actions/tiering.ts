'use server'

import { createDirectClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Classify a company into an A/B/C/D customer_tier (business feasibility).
 * Enqueued (not run inline) so the serverless function returns instantly —
 * the background worker processes it. Refresh the page to see the result.
 */
export async function triggerTierCompany(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const supabase = createDirectClient()
  await supabase.from('agent_queue').insert({
    job_type: 'tier_company',
    payload: { companyId, queueReport: false },
    priority: 3,
  })
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/companies')
}
