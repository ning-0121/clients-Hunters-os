'use server'

import { createDirectClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

/**
 * Enqueue an agent job instead of running it synchronously.
 *
 * Running an agent inline (scrape + LLM) takes 20-90s and exceeds the
 * serverless function timeout on Vercel — the button appears to "do nothing".
 * Enqueueing returns instantly; the background worker (npm run worker) picks
 * the job up from agent_queue and processes it. Refresh to see the result.
 */
async function enqueue(jobType: string, companyId: string, priority = 3, extra: Record<string, unknown> = {}) {
  const supabase = createDirectClient()
  await supabase.from('agent_queue').insert({
    job_type: jobType,
    payload: { companyId, ...extra },
    priority,
  })
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/companies')
}

export async function triggerEnrichCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  if (companyId) await enqueue('enrich_company', companyId, 4)
}

export async function triggerScoreCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  if (companyId) await enqueue('score_company', companyId, 3)
}

export async function triggerDraftOutreach(formData: FormData) {
  const companyId = formData.get('companyId') as string
  if (companyId) await enqueue('draft_outreach', companyId, 3)
}
