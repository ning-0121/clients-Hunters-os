'use server'

import { AgentFactory } from '@/agents/agent-factory'
import { revalidatePath } from 'next/cache'

/** Classify a company into an A/B/C/D customer_tier using business feasibility. */
export async function triggerTierCompany(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  try {
    const agent = AgentFactory.create('tier_company')
    const result = await agent.execute({}, { companyId, queueReport: false })
    if (!result.success) console.error('[Action] tier_company failed:', result.error)
  } catch (err) {
    console.error('[Action] tier_company threw:', err)
  }
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/companies')
}
