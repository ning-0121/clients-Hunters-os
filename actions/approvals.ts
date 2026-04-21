'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function approveAction(formData: FormData) {
  const approvalId = formData.get('approvalId') as string
  const supabase = await createServiceClient()

  const { data: approval } = await supabase
    .from('approvals')
    .select('*')
    .eq('id', approvalId)
    .single()

  if (!approval || approval.status !== 'pending') return

  await supabase
    .from('approvals')
    .update({
      status: 'approved',
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId)

  // Execute the approved action
  const payload = approval.action_payload as Record<string, unknown>
  if (approval.approval_type === 'email_first_touch' && payload?.outreachLogId) {
    await supabase
      .from('outreach_logs')
      .update({ status: 'approved' })
      .eq('id', payload.outreachLogId)

    await supabase.from('agent_queue').insert({
      job_type: 'send_email',
      payload: { outreachLogId: payload.outreachLogId },
      priority: 2,
    })
  }

  revalidatePath('/approvals')
  revalidatePath(`/approvals/${approvalId}`)
}

export async function rejectAction(formData: FormData) {
  const approvalId = formData.get('approvalId') as string
  const reason = formData.get('reason') as string | null
  const supabase = await createServiceClient()

  await supabase
    .from('approvals')
    .update({
      status: 'rejected',
      decision_reason: reason ?? 'Rejected by user',
      decided_at: new Date().toISOString(),
    })
    .eq('id', approvalId)

  revalidatePath('/approvals')
  revalidatePath(`/approvals/${approvalId}`)
}
