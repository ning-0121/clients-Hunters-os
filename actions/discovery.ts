'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { DiscoveryAgent } from '@/agents/discovery/discovery-agent'
import { redirect } from 'next/navigation'

export async function triggerDiscovery(formData: FormData) {
  const mode = formData.get('mode') as string
  const customQuery = formData.get('customQuery') as string | null

  let params: Record<string, unknown>

  if (mode === 'custom' && customQuery) {
    params = {
      searchMode: 'quick',
      customQuery,
      maxLeads: 15,
    }
  } else {
    const paramsStr = formData.get('params') as string
    params = JSON.parse(paramsStr)
  }

  const supabase = await createServiceClient()

  // Queue for background processing
  await supabase.from('agent_queue').insert({
    job_type: 'run_discovery',
    payload: params,
    priority: 3,
  })

  redirect('/leads?discovery=queued')
}
