'use server'

import { AgentFactory } from '@/agents/agent-factory'
import { revalidatePath } from 'next/cache'

/** Run an agent job synchronously and revalidate the company page */
async function runAgentSync(jobType: string, companyId: string) {
  try {
    const agent = AgentFactory.create(jobType)
    const result = await agent.execute({}, { companyId })
    if (!result.success) {
      console.error(`[Action] ${jobType} failed:`, result.error)
    }
  } catch (err) {
    console.error(`[Action] ${jobType} threw:`, err)
  }
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/companies')
}

export async function triggerEnrichCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  await runAgentSync('enrich_company', companyId)
}

export async function triggerScoreCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  await runAgentSync('score_company', companyId)
}

export async function triggerDraftOutreach(formData: FormData) {
  const companyId = formData.get('companyId') as string
  await runAgentSync('draft_outreach', companyId)
}
