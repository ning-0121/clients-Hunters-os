'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { callLLMSimple } from '@/lib/llm/client'
import { revalidatePath } from 'next/cache'

/** Mark a task done. */
export async function completeTask(formData: FormData): Promise<void> {
  const taskId = formData.get('taskId') as string
  if (!taskId) return
  const sb = await createServiceClient()
  await sb.from('tasks').update({
    status:       'done',
    completed_at: new Date().toISOString(),
    completed_by: (formData.get('by') as string) ?? 'human',
    updated_at:   new Date().toISOString(),
  }).eq('id', taskId)
  revalidatePath('/tasks')
}

/** Dismiss a task (not relevant / handled elsewhere). */
export async function dismissTask(formData: FormData): Promise<void> {
  const taskId = formData.get('taskId') as string
  if (!taskId) return
  const sb = await createServiceClient()
  await sb.from('tasks').update({
    status: 'dismissed', updated_at: new Date().toISOString(),
  }).eq('id', taskId)
  revalidatePath('/tasks')
}

/** Claim/assign a task to a salesperson. */
export async function assignTask(formData: FormData): Promise<void> {
  const taskId = formData.get('taskId') as string
  const who    = formData.get('assignedTo') as string
  if (!taskId || !who) return
  const sb = await createServiceClient()
  await sb.from('tasks').update({
    assigned_to: who, status: 'in_progress', updated_at: new Date().toISOString(),
  }).eq('id', taskId)
  revalidatePath('/tasks')
}

/**
 * AI-draft a reply to an inbound message and save it to outreach_logs as
 * pending_approval, so the salesperson reviews before sending.
 */
const REPLY_SYSTEM_PROMPT = `You are Alex from Jojofashion (jojofashion.us), the international sales arm of Qimo Clothing — a Chinese activewear OEM/ODM manufacturer.

FACTORY STRENGTHS: activewear/yoga/sportswear, 50pcs MOQ, GOTS organic cotton, OEKO-TEX, bamboo blends, 30-45 day repeat orders, in-house design team.

You are writing a REPLY to a prospect who just responded to outreach. Rules:
- Match their energy and answer their actual question
- Move the deal one concrete step forward (toward sample, quote, or call)
- Under 120 words, warm and direct, no fluff
- Ask for exactly the info you need next (e.g. shipping address for a sample, target qty for a quote)
- Sign as "Alex"
- Return ONLY valid JSON, no markdown`

export async function draftReply(formData: FormData): Promise<void> {
  const replyEventId = formData.get('replyEventId') as string
  const taskId       = formData.get('taskId') as string
  if (!replyEventId) return

  const sb = await createServiceClient()

  const { data: reply } = await sb.from('reply_events')
    .select('*, companies(name, country, company_type), contacts(full_name, title, email)')
    .eq('id', replyEventId).single()
  if (!reply) return

  const company = Array.isArray(reply.companies) ? reply.companies[0] : reply.companies
  const contact = Array.isArray(reply.contacts) ? reply.contacts[0] : reply.contacts

  const userMessage = `Write a reply to this inbound message.

FROM: ${contact?.full_name ?? reply.from_email} (${contact?.title ?? 'unknown'})
COMPANY: ${company?.name ?? 'unknown'} — ${company?.country ?? ''}, ${company?.company_type ?? ''}
THEIR INTENT: ${reply.reply_intent}  |  SENTIMENT: ${reply.reply_sentiment}

THEIR MESSAGE:
${(reply.reply_body ?? '').slice(0, 800)}

Return JSON:
{ "subject": "Re: ...", "body": "full reply, under 120 words, sign as Alex" }`

  let subject = `Re: ${reply.reply_subject ?? company?.name ?? ''}`
  let body = ''
  try {
    const raw = await callLLMSimple(REPLY_SYSTEM_PROMPT, userMessage, { maxTokens: 500, temperature: 0.6 })
    const cleaned = raw.replace(/```(?:json)?\s*([\s\S]*?)```/, '$1').trim()
    const parsed = JSON.parse(cleaned)
    subject = parsed.subject ?? subject
    body    = parsed.body ?? ''
  } catch (err) {
    console.error('[draftReply] LLM error:', err)
    return
  }

  // Save as pending_approval outreach (human reviews before send)
  await sb.from('outreach_logs').insert({
    company_id:  reply.company_id,
    contact_id:  reply.contact_id,
    channel:     'email',
    direction:   'outbound',
    subject, body,
    personalization_data: { in_reply_to: replyEventId, intent: reply.reply_intent },
    status:      'pending_approval',
    executed_by: 'ai',
  })

  // Mark the task in_progress
  if (taskId) {
    await sb.from('tasks').update({ status: 'in_progress', updated_at: new Date().toISOString() }).eq('id', taskId)
  }

  revalidatePath('/tasks')
  revalidatePath('/approvals')
}
