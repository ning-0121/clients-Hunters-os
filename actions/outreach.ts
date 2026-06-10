'use server'

import { SendEmailAgent } from '@/agents/email/send-email-agent'
import { revalidatePath } from 'next/cache'

export async function sendEmailAction(formData: FormData): Promise<void> {
  const outreachLogId = formData.get('outreachLogId') as string
  if (!outreachLogId) {
    console.error('[sendEmailAction] outreachLogId is required')
    return
  }

  const agent = new SendEmailAgent()
  try {
    const result = await agent.execute({}, { outreachLogId })
    if (!result.success) console.error('[sendEmailAction] Agent error:', result.error)
  } catch (err) {
    console.error('[sendEmailAction]', err)
  }
  revalidatePath('/outreach')
}
