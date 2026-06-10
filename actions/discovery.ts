'use server'

import { DiscoveryAgent, type DiscoveryInput } from '@/agents/discovery/discovery-agent'
import { redirect } from 'next/navigation'

export async function triggerDiscovery(formData: FormData): Promise<void> {
  const mode = formData.get('mode') as string
  const customQuery = formData.get('customQuery') as string | null

  let params: DiscoveryInput

  if (mode === 'custom' && customQuery) {
    params = { searchMode: 'quick', customQuery, maxLeads: 15 }
  } else {
    const paramsStr = formData.get('params') as string
    try {
      params = JSON.parse(paramsStr) as DiscoveryInput
    } catch {
      console.error('[triggerDiscovery] Invalid params JSON')
      redirect('/companies')
    }
  }

  try {
    const agent = new DiscoveryAgent()
    const result = await agent.execute({}, params)
    if (!result.success) console.error('[triggerDiscovery] Agent error:', result.error)
  } catch (err) {
    console.error('[triggerDiscovery]', err)
  }

  redirect('/companies')
}
