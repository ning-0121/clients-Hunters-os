'use server'

import { createDirectClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

/**
 * Queue a Customer Intelligence Report, then open the report page.
 *
 * Generating a report runs the LLM (30-120s) — too long for a serverless
 * function. We enqueue it; the background worker (npm run worker) produces it.
 * The report page shows a "generating" banner via ?queued=1 until it appears.
 */
export async function generateReport(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const depth = (formData.get('depth') as string) || undefined
  if (!companyId) return

  const supabase = createDirectClient()
  await supabase.from('agent_queue').insert({
    job_type: 'generate_report',
    // manual=true so a salesperson can force a report even for a D-tier customer.
    payload: { companyId, depth, manual: true },
    priority: 2,
  })

  revalidatePath(`/companies/${companyId}`)
  revalidatePath(`/companies/${companyId}/report`)
  redirect(`/companies/${companyId}/report?queued=1`)
}

/** Latest report row for a company (highest version). */
async function latestReport(companyId: string) {
  const sb = await createServiceClient()
  const { data } = await sb
    .from('customer_intelligence_reports')
    .select('*')
    .eq('company_id', companyId)
    .order('report_version', { ascending: false })
    .limit(1)
    .single()
  return data
}

/**
 * Turn the report's first-outreach draft into a pending_approval outreach_log.
 * Never sends automatically — it lands in the approval queue for human review.
 */
export async function createOutreachDraftFromReport(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return

  const sb = await createServiceClient()
  const report = await latestReport(companyId)
  if (!report) return

  const dm = (report.draft_messages ?? {}) as Record<string, unknown>
  // Overseas reports use first_outreach_email; domestic reports use formal_email (中文).
  const email = (dm.first_outreach_email ?? dm.formal_email ?? {}) as { subject?: string; body?: string }
  if (!email.subject && !email.body) return

  const { data: contact } = await sb
    .from('contacts').select('id')
    .eq('company_id', companyId)
    .order('contact_priority', { ascending: false })
    .limit(1).single()

  await sb.from('outreach_logs').insert({
    company_id:  companyId,
    contact_id:  contact?.id ?? null,
    channel:     'email',
    direction:   'outbound',
    subject:     email.subject ?? 'Introduction — QIMO / Jojofashion',
    body:        email.body ?? '',
    personalization_data: { from_report: report.id, report_version: report.report_version },
    status:      'pending_approval',
    executed_by: 'ai',
  })

  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/approvals')
  revalidatePath('/outreach')
}

/** Create a follow-up task from the report's recommended next step. */
export async function createTaskFromReport(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return

  const sb = await createServiceClient()
  const report = await latestReport(companyId)
  if (!report) return

  const summary = (report.executive_summary ?? {}) as { next_step?: string; tier?: string }
  const actions = (report.recommended_actions ?? []) as Array<{ action?: string; priority?: string }>
  const nowActions = actions.filter(a => a.priority === 'now').map(a => a.action).filter(Boolean)

  const { data: company } = await sb.from('companies').select('name').eq('id', companyId).single()

  const detail = [
    summary.next_step ? `Next step: ${summary.next_step}` : null,
    nowActions.length ? `Immediate actions:\n- ${nowActions.join('\n- ')}` : null,
  ].filter(Boolean).join('\n\n')

  await sb.from('tasks').insert({
    company_id:       companyId,
    task_type:        'manual',
    priority:         summary.tier === 'A' ? 9 : summary.tier === 'B' ? 7 : 5,
    title:            `Develop ${company?.name ?? 'customer'} (${summary.tier ?? '?'}-tier)`,
    detail:           detail || 'Follow up based on customer intelligence report.',
    suggested_action: summary.next_step ?? null,
    status:           'open',
    source:           'customer_report',
  })

  revalidatePath('/tasks')
  revalidatePath(`/companies/${companyId}`)
}

/** Save a manual quality review of a report (1-10 across dimensions + notes). */
export async function submitReportReview(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const reportId = formData.get('reportId') as string
  if (!companyId || !reportId) return

  const clampInt = (name: string): number | null => {
    const raw = formData.get(name)
    if (raw == null || raw === '') return null
    const n = Math.round(Number(raw))
    if (Number.isNaN(n)) return null
    return Math.max(1, Math.min(10, n))
  }

  const sb = await createServiceClient()
  await sb.from('report_quality_reviews').insert({
    company_id:                companyId,
    report_id:                 reportId,
    reviewer:                  ((formData.get('reviewer') as string) || 'team').slice(0, 120),
    overall_score:             clampInt('overall_score'),
    accuracy_score:            clampInt('accuracy_score'),
    usefulness_score:          clampInt('usefulness_score'),
    compliance_accuracy_score: clampInt('compliance_accuracy_score'),
    product_match_score:       clampInt('product_match_score'),
    next_action_quality_score: clampInt('next_action_quality_score'),
    notes:                     (formData.get('notes') as string) || null,
  })

  revalidatePath(`/companies/${companyId}/report`)
}
