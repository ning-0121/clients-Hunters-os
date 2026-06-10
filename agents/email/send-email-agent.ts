/**
 * SendEmailAgent
 * Executes an approved outreach email with throttle protection.
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import { sendGmail, isGmailConfigured } from '@/lib/email/gmail'
import { checkSendThrottle, recordSend } from '@/lib/email/throttle'

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

    // 1. Load the outreach log
    const { data: log, error } = await supabase
      .from('outreach_logs')
      .select(`
        *,
        contacts(full_name, email, title),
        companies(name)
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

    const contact     = Array.isArray(log.contacts) ? log.contacts[0] : log.contacts
    const company     = Array.isArray(log.companies) ? log.companies[0] : log.companies
    const recipientEmail = (contact as Record<string, unknown>)?.email as string | undefined
    const recipientName  = (contact as Record<string, unknown>)?.full_name as string | undefined
    const companyName    = (company as Record<string, unknown>)?.name as string | undefined

    // Guard: no recipient = abort (don't silently log as sent)
    if (!recipientEmail) {
      return { success: false, error: `No email address found for contact on outreach log ${outreachLogId}` }
    }

    // 2. Send
    let sendResult: { success: boolean; method: string; messageId?: string; error?: string }

    if (isGmailConfigured() && recipientEmail) {
      const gmailResult = await sendGmail({
        to: recipientEmail,
        toName: recipientName ?? undefined,
        subject,
        body,
      })
      sendResult = { ...gmailResult, method: 'gmail' }
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
