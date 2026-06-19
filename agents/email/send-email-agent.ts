/**
 * SendEmailAgent
 * Executes an approved outreach email with throttle protection.
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { sendGmail, isGmailConfigured } from '@/lib/email/gmail'
import { checkSendThrottle, recordSend } from '@/lib/email/throttle'
import { checkBounceHealth } from '@/lib/email/bounce-rate'
import { resolveSendableEmail } from '@/lib/email/resolve'
import { logEvent } from '@/lib/events/log'

interface SendEmailInput {
  outreachLogId: string
}

export class SendEmailAgent extends BaseAgent {
  constructor() {
    super('send_email_agent')
  }

  async execute(_context: AgentContext, input: unknown): Promise<AgentResult> {
    const { outreachLogId } = input as SendEmailInput
    const start = Date.now()
    const supabase = await createServiceClient()

    // 0. Throttle check — enforce daily limit & inter-send delay
    const throttle = await checkSendThrottle()
    if (!throttle.allowed) {
      console.log(`[SendEmailAgent] ⏳ Throttled: ${throttle.reason}`)
      // Re-queue for later instead of failing
      await supabase
        .from('agent_queue')
        .update({
          status: 'waiting',
          scheduled_for: throttle.nextAllowedAt?.toISOString() ?? new Date(Date.now() + 300_000).toISOString(),
        })
        .eq('payload->>outreachLogId', outreachLogId)
      return { success: false, error: `Throttled: ${throttle.reason}` }
    }

    // 0b. Domain bounce-rate guardrail — if the recent bounce rate is too high,
    // pause sending (re-queue) so the team cleans the list / fixes auth first.
    const health = await checkBounceHealth(supabase)
    if (health.paused) {
      console.warn(`[SendEmailAgent] 🛑 Bounce-rate pause: ${health.reason}`)
      await supabase
        .from('agent_queue')
        .update({ status: 'waiting', scheduled_for: new Date(Date.now() + 6 * 3600_000).toISOString() })
        .eq('payload->>outreachLogId', outreachLogId)
      return { success: false, error: `Bounce-rate pause: ${health.reason}` }
    }

    // 1. Load the outreach log
    const { data: log, error } = await supabase
      .from('outreach_logs')
      .select(`
        *,
        contacts(full_name, first_name, last_name, email, email_source, email_confidence, title),
        companies(name, website, assigned_to)
      `)
      .eq('id', outreachLogId)
      .single()

    if (error || !log) {
      return { success: false, error: `Outreach log not found: ${outreachLogId}` }
    }

    const subject = log.subject as string | null
    const body    = log.body    as string | null

    if (!subject || !body) {
      return { success: false, error: 'No subject/body found in outreach log' }
    }

    const contact     = (Array.isArray(log.contacts) ? log.contacts[0] : log.contacts) as Record<string, unknown> | null
    const company     = (Array.isArray(log.companies) ? log.companies[0] : log.companies) as Record<string, unknown> | null
    const recipientName  = contact?.full_name as string | undefined
    const companyName    = company?.name as string | undefined

    // 1b. Resolve a SENDABLE email — verify what we have, try to find a better
    // address, and refuse to send to unconfirmed guesses (stops bounces).
    const resolved = await resolveSendableEmail({
      contactId: log.contact_id,
      email: contact?.email as string | undefined,
      source: contact?.email_source as string | undefined,
      confidence: contact?.email_confidence as number | undefined,
      firstName: contact?.first_name as string | undefined,
      lastName: contact?.last_name as string | undefined,
      fullName: contact?.full_name as string | undefined,
      website: company?.website as string | undefined,
    })

    if (!resolved.sendable || !resolved.email) {
      await supabase.from('outreach_logs').update({
        status: 'failed',
        personalization_data: { ...((log.personalization_data as Record<string, unknown>) ?? {}), email_verify: resolved.status, email_reason: resolved.reason },
      }).eq('id', outreachLogId)
      await this.logAction({
        companyId: log.company_id, contactId: log.contact_id, actionType: 'send_email',
        inputData: { outreachLogId }, outputData: { blocked: true, status: resolved.status, reason: resolved.reason },
        status: 'failed', errorMessage: resolved.reason,
      })
      return { success: false, error: `未发送 — ${resolved.reason}` }
    }

    const recipientEmail = resolved.email

    // 2. Send
    let sendResult: { success: boolean; method: string; messageId?: string; error?: string }

    // Prefer the assigned salesperson's own mailbox, fall back to the global one.
    const owner = company?.assigned_to as string | undefined
    let sender: import('@/lib/email/gmail').SenderCreds | null = null
    if (owner) {
      const { data: es } = await supabase.from('user_email_settings')
        .select('from_name, sender_email, smtp_host, smtp_port, app_password, active').eq('owner', owner).maybeSingle()
      if (es && es.active && es.sender_email && es.app_password) {
        sender = { fromName: es.from_name ?? undefined, fromEmail: es.sender_email, appPassword: es.app_password, smtpHost: es.smtp_host, smtpPort: es.smtp_port }
      }
    }

    if ((isGmailConfigured() || sender) && recipientEmail) {
      const gmailResult = await sendGmail({
        to: recipientEmail,
        toName: recipientName ?? undefined,
        subject,
        body,
      }, sender)
      sendResult = { ...gmailResult, method: sender ? 'smtp_user' : 'gmail' }
    } else {
      sendResult = await this.simulateSend({ to: recipientEmail, toName: recipientName, subject, body, companyName })
    }

    if (!sendResult.success) {
      await supabase.from('outreach_logs').update({ status: 'failed' }).eq('id', outreachLogId)
      return { success: false, error: sendResult.error }
    }

    // 3. Mark as sent + store gmail message id
    await supabase
      .from('outreach_logs')
      .update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        subject,
        gmail_message_id: sendResult.messageId ?? null,
      })
      .eq('id', outreachLogId)

    await logEvent({
      companyId: log.company_id as string,
      contactId: (log.contact_id as string) ?? null,
      eventType: 'email_out', direction: 'out', channel: 'email',
      title: `发送邮件：${subject}`.slice(0, 140),
      refTable: 'outreach_logs', refId: outreachLogId,
    })

    // 4. Record in send log (for throttle tracking) — skip simulated sends
    if (sendResult.method !== 'simulated') {
      await recordSend({
        toEmail: recipientEmail,
        companyId: log.company_id,
        logId: outreachLogId,
        method: sendResult.method,
      })
    }

    // 5. Update company status + mark contact as contacted
    if (log.company_id) {
      await supabase
        .from('companies')
        .update({ status: 'outreach', last_activity_at: new Date().toISOString() })
        .eq('id', log.company_id)
    }
    if (log.contact_id) {
      await supabase
        .from('contacts')
        .update({ status: 'contacted', last_interaction_at: new Date().toISOString() })
        .eq('id', log.contact_id)
    }

    // 6. Create / update conversation record
    if (log.company_id) {
      await supabase.from('conversations').upsert(
        {
          company_id:        log.company_id,
          contact_id:        log.contact_id ?? null,
          first_outreach_id: outreachLogId,
          status:            'active',
          thread_subject:    subject,
          last_activity_at:  new Date().toISOString(),
          updated_at:        new Date().toISOString(),
        },
        { onConflict: 'company_id', ignoreDuplicates: false }
      )
    }

    // 7. Schedule follow-up sequence (step 2 @ Day+4, step 3 @ Day+9)
    if (log.company_id) {
      const nowMs = Date.now()
      const followups = [
        { step: 2, delayDays: 4 },
        { step: 3, delayDays: 9 },
      ]
      for (const f of followups) {
        await supabase.from('followup_runs').insert({
          company_id:      log.company_id,
          contact_id:      log.contact_id ?? null,
          original_log_id: outreachLogId,
          step:            f.step,
          status:          'scheduled',
          scheduled_for:   new Date(nowMs + f.delayDays * 86_400_000).toISOString(),
        })
      }
    }

    await this.logAction({
      companyId: log.company_id,
      contactId: log.contact_id,
      actionType: 'send_email',
      inputData: { outreachLogId, subject },
      outputData: { sent: true, method: sendResult.method, rampDay: throttle.rampDay },
      status: 'completed',
      durationMs: Date.now() - start,
    })

    console.log(`[SendEmailAgent] ✉️  Sent to ${recipientEmail ?? 'unknown'} — "${subject}" (ramp day ${throttle.rampDay}, ${throttle.sentToday + 1}/${throttle.dailyLimit})`)

    return {
      success: true,
      data: { outreachLogId, sent: true, to: recipientEmail, subject, method: sendResult.method },
    }
  }

  private async simulateSend(params: {
    to?: string; toName?: string; subject: string; body: string; companyName?: string
  }): Promise<{ success: boolean; method: string; messageId?: string; error?: string }> {
    if (!params.to) return { success: false, method: 'none', error: 'No recipient email' }
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log(`📧 [SIMULATED] To: ${params.toName ?? ''} <${params.to}>`)
    console.log(`   Subject: ${params.subject}`)
    console.log(`   Body: ${params.body.slice(0, 100)}...`)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
    return { success: true, method: 'simulated', messageId: `sim_${Date.now()}` }
  }
}
