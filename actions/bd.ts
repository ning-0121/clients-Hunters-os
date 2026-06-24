'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getBdIdentity } from '@/lib/bd/shared'
import { revalidatePath } from 'next/cache'

const REVALIDATE = ['/bd/today', '/bd/leads', '/bd/replies', '/bd/reports', '/manager/bd-dashboard']
function revalidateBd(extra?: string) {
  for (const p of REVALIDATE) revalidatePath(p)
  if (extra) revalidatePath(extra)
}

/** Claim a lead for the current salesperson. */
export async function assignLeadToMe(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const { who } = await getBdIdentity()
  const sb = await createServiceClient()
  await sb.from('companies').update({ assigned_to: who, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidateBd(`/companies/${companyId}`)
}

/** Remove a lead from MY list (unassign). Only clears it if it's currently mine. */
export async function removeLeadFromMe(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const { who } = await getBdIdentity()
  const sb = await createServiceClient()
  await sb.from('companies').update({ assigned_to: null, updated_at: new Date().toISOString() })
    .eq('id', companyId).eq('assigned_to', who)
  revalidateBd(`/companies/${companyId}`)
}

/** Assign a lead to a named owner (manager action). */
export async function assignLeadTo(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const owner = (formData.get('owner') as string)?.trim()
  if (!companyId || !owner) return
  const sb = await createServiceClient()
  await sb.from('companies').update({ assigned_to: owner, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidateBd(`/companies/${companyId}`)
}

/** Reject / archive a lead (out of the active pool). */
export async function rejectLead(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const sb = await createServiceClient()
  await sb.from('companies').update({ status: 'closed_lost', updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidateBd(`/companies/${companyId}`)
}

/** Snooze a task by N days (default 2). */
export async function snoozeTask(formData: FormData): Promise<void> {
  const taskId = formData.get('taskId') as string
  const days = Number(formData.get('days') ?? 2) || 2
  if (!taskId) return
  const sb = await createServiceClient()
  const due = new Date(Date.now() + days * 86400_000).toISOString()
  await sb.from('tasks').update({ due_at: due, status: 'open', updated_at: new Date().toISOString() }).eq('id', taskId)
  revalidateBd()
}

async function createTask(row: Record<string, unknown>) {
  const sb = await createServiceClient()
  await sb.from('tasks').insert(row)
}

/** Create a quote-follow-up task (from a lead or a reply). */
export async function createQuoteTask(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const contactId = (formData.get('contactId') as string) || null
  const replyEventId = (formData.get('replyEventId') as string) || null
  if (!companyId) return
  const { who } = await getBdIdentity()
  const sb = await createServiceClient()
  const { data: c } = await sb.from('companies').select('name').eq('id', companyId).single()
  await createTask({
    company_id: companyId, contact_id: contactId, reply_event_id: replyEventId,
    task_type: 'quote_followup', priority: 3,
    title: `准备报价：${c?.name ?? '客户'}`,
    detail: '客户有报价需求，准备 quote。', suggested_action: '整理 SKU、MOQ、价格、交期后回复',
    status: 'open', assigned_to: who, source: 'human',
    due_at: new Date(Date.now() + 86400_000).toISOString(),
  })
  revalidateBd(`/companies/${companyId}`)
}

/** Create a sample-follow-up task (from a lead or a reply). */
export async function createSampleTask(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const contactId = (formData.get('contactId') as string) || null
  const replyEventId = (formData.get('replyEventId') as string) || null
  if (!companyId) return
  const { who } = await getBdIdentity()
  const sb = await createServiceClient()
  const { data: c } = await sb.from('companies').select('name').eq('id', companyId).single()
  await createTask({
    company_id: companyId, contact_id: contactId, reply_event_id: replyEventId,
    task_type: 'sample_followup', priority: 3,
    title: `安排样品：${c?.name ?? '客户'}`,
    detail: '客户有样品需求。', suggested_action: '确认款式/数量/收货地址后创建样品单',
    status: 'open', assigned_to: who, source: 'human',
    due_at: new Date(Date.now() + 86400_000).toISOString(),
  })
  revalidateBd(`/companies/${companyId}`)
}

/** Schedule a manual follow-up task (default +3 days). */
export async function scheduleFollowup(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const contactId = (formData.get('contactId') as string) || null
  const days = Number(formData.get('days') ?? 3) || 3
  if (!companyId) return
  const { who } = await getBdIdentity()
  const sb = await createServiceClient()
  const { data: c } = await sb.from('companies').select('name').eq('id', companyId).single()
  await createTask({
    company_id: companyId, contact_id: contactId,
    task_type: 'manual', priority: 5,
    title: `跟进：${c?.name ?? '客户'}`,
    detail: `${days} 天后跟进`, suggested_action: '查看上次沟通后发送跟进',
    status: 'open', assigned_to: who, source: 'human',
    due_at: new Date(Date.now() + days * 86400_000).toISOString(),
  })
  revalidateBd(`/companies/${companyId}`)
}

/** Mark a reply handled: close any tasks linked to it. */
export async function closeReply(formData: FormData): Promise<void> {
  const replyEventId = formData.get('replyEventId') as string
  if (!replyEventId) return
  const sb = await createServiceClient()
  await sb.from('tasks').update({ status: 'done', completed_at: new Date().toISOString(), completed_by: 'human', updated_at: new Date().toISOString() })
    .eq('reply_event_id', replyEventId).neq('status', 'done')
  revalidateBd()
}

/** Escalate a reply to a manager (assign linked task, or create one). */
export async function assignReplyToManager(formData: FormData): Promise<void> {
  const replyEventId = formData.get('replyEventId') as string
  const companyId = (formData.get('companyId') as string) || null
  if (!replyEventId) return
  const sb = await createServiceClient()
  const { data: existing } = await sb.from('tasks').select('id').eq('reply_event_id', replyEventId).limit(1).maybeSingle()
  if (existing) {
    await sb.from('tasks').update({ assigned_to: 'sales_manager', priority: 2, status: 'open', updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else if (companyId) {
    const { data: c } = await sb.from('companies').select('name').eq('id', companyId).single()
    await createTask({
      company_id: companyId, reply_event_id: replyEventId, task_type: 'reply_needed', priority: 2,
      title: `经理处理回复：${c?.name ?? '客户'}`, detail: '升级给销售经理处理', status: 'open',
      assigned_to: 'sales_manager', source: 'human',
    })
  }
  revalidateBd()
}
