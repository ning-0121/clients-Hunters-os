'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

function revalidate(companyId: string) {
  for (const p of [`/companies/${companyId}`, '/today', '/command']) revalidatePath(p)
}

/** Discipline (V2): set the next action + due date so the lead never stalls (clears red flag). */
export async function setNextAction(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const text = (formData.get('nextAction') as string)?.trim()
  if (!companyId || !text) return
  const due = (formData.get('nextActionDue') as string)?.trim() || null
  const sb = await createServiceClient()
  await sb.from('companies').update({ next_action: text, next_action_due: due, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidate(companyId)
}

/** Learning loop (V2): record WHY there is no reply — accumulates real sales intelligence. */
export async function setWhyNoReply(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const reason = (formData.get('whyNoReply') as string)?.trim()
  if (!companyId || !reason) return
  const sb = await createServiceClient()
  await sb.from('companies').update({ why_no_reply: reason, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidate(companyId)
}
