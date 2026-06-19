/**
 * FollowupAgent
 * Processes scheduled follow-up steps from followup_runs table.
 * - Step 2 (Day 4): social proof / specific example angle
 * - Step 3 (Day 9): final short nudge
 * Stops automatically if the company has replied.
 */
import { BaseAgent, type AgentContext, type AgentResult } from '@/agents/base-agent'
import { createServiceClient } from '@/lib/supabase/server'
import type { Company, Contact } from '@/types'

interface FollowupInput {
  followupRunId: string
}

const FOLLOWUP_SYSTEM_PROMPT = `You are Alex from Jojofashion (jojofashion.us), the international sales arm of Qimo Clothing — a Chinese activewear OEM/ODM manufacturer.

FACTORY STRENGTHS: activewear/yoga/sportswear, 50pcs MOQ, GOTS organic cotton, OEKO-TEX, bamboo blends, 30-45 day repeat orders, in-house design team.

Follow-up email rules:
- VERY short (under 100 words)
- Do NOT repeat what you said in the first email
- Each step has a different angle (see below)
- Never be pushy or salesy — one soft question is enough
- Anti-spam: no trigger words (free / guarantee / act now / limited time / click here / 100% / ALL-CAPS / "!!!"),
  at most one link, no price/percent stuffing — write like a real one-to-one note, not a blast
- Sign as "Alex"
- Return ONLY valid JSON, no markdown`

const STEP_ANGLES: Record<number, string> = {
  2: `Step 2 angle: Share one concrete example or mini case study.
      Something like: "We just helped a small yoga brand in Australia go from 50 sample units to 300/month in 3 months — their main concern was MOQ too."
      Make it specific and relatable. End with a soft question.`,
  3: `Step 3 angle: Very short final check-in. Acknowledge they're probably busy.
      Something like "Last note from me — happy to send our lookbook if sourcing is relevant now or in future. Either way, best of luck with the brand."
      No pressure, no question, just leave the door open.`,
}

export class FollowupAgent extends BaseAgent {
  constructor() {
    super('followup_agent')
  }

  async execute(context: AgentContext, input: unknown): Promise<AgentResult> {
    const { followupRunId } = input as FollowupInput
    const start = Date.now()
    const supabase = await createServiceClient()

    // 1. Load the followup_run
    const { data: run, error } = await supabase
      .from('followup_runs')
      .select('*')
      .eq('id', followupRunId)
      .single()

    if (error || !run) return { success: false, error: 'followup_run not found' }
    if (run.status !== 'scheduled') {
      return { success: true, data: { skipped: true, reason: `Already ${run.status}` } }
    }

    // 2. Check if company has replied — if so, cancel
    const { data: company } = await supabase
      .from('companies')
      .select('*')
      .eq('id', run.company_id)
      .single()

    if (!company) return { success: false, error: 'Company not found' }

    // Check for reply on original outreach
    const { data: replyEvent } = await supabase
      .from('reply_events')
      .select('id')
      .eq('company_id', run.company_id)
      .limit(1)
      .maybeSingle()

    if (replyEvent || company.status === 'engaged' || company.status === 'qualified') {
      await supabase.from('followup_runs')
        .update({ status: 'replied' })
        .eq('id', followupRunId)
      return { success: true, data: { skipped: true, reason: 'Already replied' } }
    }

    // 2b. Bounce-aware: stop if the original email bounced or the contact's email
    // is now undeliverable. Re-sending to a dead address only burns sender reputation.
    const [{ data: origLog }, { data: bouncedLogs }] = await Promise.all([
      supabase.from('outreach_logs').select('status').eq('id', run.original_log_id).maybeSingle(),
      supabase.from('outreach_logs').select('id').eq('company_id', run.company_id).eq('status', 'bounced').limit(1),
    ])
    let dead = origLog?.status === 'bounced' || (bouncedLogs?.length ?? 0) > 0
    if (!dead && run.contact_id) {
      const { data: ct } = await supabase.from('contacts').select('email_deliverable').eq('id', run.contact_id).maybeSingle()
      if (ct?.email_deliverable === false) dead = true
    }
    if (dead) {
      // (followup_runs.skipped_reason is absent on the live DB; reason is logged below)
      await supabase.from('followup_runs')
        .update({ status: 'skipped' })
        .eq('id', followupRunId)
      await this.logAction({
        companyId: run.company_id, actionType: 'draft_followup',
        outputData: { skipped: true, reason: 'bounced_or_undeliverable' }, status: 'skipped',
      })
      return { success: true, data: { skipped: true, reason: 'bounced_or_undeliverable' } }
    }

    // 3. Load contact and original email for context
    const { data: contacts } = await supabase
      .from('contacts')
      .select('*')
      .eq('company_id', run.company_id)
      .eq('status', 'uncontacted')
      .order('contact_priority', { ascending: false })
      .limit(1)

    const contact = contacts?.[0] ?? null

    const { data: originalLog } = await supabase
      .from('outreach_logs')
      .select('subject, body, personalization_data')
      .eq('id', run.original_log_id)
      .maybeSingle()

    // 4. Draft the follow-up email
    const draft = await this.draftFollowup(company, contact, run.step, originalLog)

    // 5. Save to outreach_logs as pending_approval
    const { data: log } = await supabase
      .from('outreach_logs')
      .insert({
        company_id: run.company_id,
        contact_id: contact?.id ?? run.contact_id,
        channel: 'email',
        direction: 'outbound',
        subject: draft.subject,
        body: draft.body,
        personalization_data: { step: run.step, angle: draft.angle },
        status: 'pending_approval',
        executed_by: 'ai',
      })
      .select('id')
      .single()

    // 6. Create approval
    if (log?.id) {
      await this.createApproval({
        companyId: run.company_id,
        contactId: contact?.id ?? run.contact_id,
        approvalLevel: 'L2',
        approvalType: 'email_followup',
        title: `Follow-up #${run.step - 1} to ${company.name}`,
        description: `Step ${run.step} (Day ${run.step === 2 ? 4 : 9}) follow-up email`,
        actionPayload: { outreachLogId: log.id, draft },
        riskLevel: 'low',
      })

      // Update followup_run with the new outreach_log id
      await supabase.from('followup_runs')
        .update({ outreach_log_id: log.id, updated_at: new Date().toISOString() })
        .eq('id', followupRunId)
    }

    await this.logAction({
      companyId: run.company_id,
      actionType: 'draft_followup',
      outputData: { step: run.step, outreachLogId: log?.id },
      status: 'completed',
      durationMs: Date.now() - start,
    })

    return {
      success: true,
      needsApproval: true,
      data: { followupRunId, step: run.step, outreachLogId: log?.id, draft },
    }
  }

  private async draftFollowup(
    company: Company,
    contact: Contact | null,
    step: number,
    originalLog: { subject?: string | null; body?: string | null } | null,
  ): Promise<{ subject: string; body: string; angle: string }> {
    const angle = STEP_ANGLES[step] ?? STEP_ANGLES[3]

    const userMessage = `Write a follow-up email (step ${step}) to this activewear brand:

COMPANY: ${company.name}
Country: ${company.country ?? 'unknown'}
Type: ${company.company_type ?? 'unknown'}
Description: ${company.description?.slice(0, 200) ?? 'N/A'}
Contact: ${contact?.full_name ?? 'Founder/Buyer'} (${contact?.title ?? 'unknown'})

ORIGINAL EMAIL:
Subject: ${originalLog?.subject ?? 'unknown'}
Body preview: ${originalLog?.body?.slice(0, 300) ?? 'N/A'}

FOLLOW-UP ANGLE FOR THIS STEP:
${angle}

Return JSON:
{
  "subject": "Re: [original subject] or new subject",
  "body": "full email body, plain text, under 100 words, sign as Alex",
  "angle": "one word description of angle used"
}`

    try {
      const raw = await this.callLLM(FOLLOWUP_SYSTEM_PROMPT, userMessage, {
        maxTokens: 500,
        temperature: 0.7,
      })
      const cleaned = raw.replace(/```(?:json)?\s*([\s\S]*?)```/, '$1').trim()
      return JSON.parse(cleaned)
    } catch {
      return {
        subject: `Re: ${originalLog?.subject ?? company.name}`,
        body: step === 2
          ? `Just wanted to share — we recently helped a small yoga brand start with 50 units and scale to 300/month within a quarter. Organic cotton, same quality you'd expect at 10x the price from other suppliers.\n\nWould any of this be relevant for ${company.name}?\n\nAlex\njojofashion.us`
          : `Last message from me — if sourcing ever comes up, happy to send our lookbook. Best of luck with the brand.\n\nAlex`,
        angle: step === 2 ? 'social_proof' : 'soft_close',
      }
    }
  }
}
