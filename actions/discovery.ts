'use server'

import { createDirectClient } from '@/lib/supabase/server'
import type { DiscoveryInput } from '@/agents/discovery/discovery-agent'
import { redirect } from 'next/navigation'

/**
 * Enqueue a discovery run (does NOT run inline). Discovery does Serper +
 * scraping + LLM filtering for 30-180s — far past the serverless function
 * timeout, so running it in the action made the button "do nothing". The
 * background worker (per-minute cron) picks the job up; new leads appear under
 * /leads as they're found.
 */
export async function triggerDiscovery(formData: FormData): Promise<void> {
  const mode = formData.get('mode') as string | null
  const customQuery = formData.get('customQuery') as string | null

  let params: DiscoveryInput
  if (mode === 'custom') {
    if (!customQuery?.trim()) redirect('/leads/discovery')
    params = { searchMode: 'quick', customQuery: customQuery!.trim(), maxLeads: 15 }
  } else {
    const paramsStr = formData.get('params') as string
    try {
      params = JSON.parse(paramsStr) as DiscoveryInput
    } catch {
      redirect('/leads/discovery')
    }
  }

  const supabase = createDirectClient()
  await supabase.from('agent_queue').insert({
    job_type: 'run_discovery',
    payload: params! as unknown as Record<string, unknown>,
    priority: 4,
  })

  redirect('/leads?discovery=queued')
}
