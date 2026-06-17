'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { detectHiringSignals } from '@/lib/enrichment/hiring-signals'
import { computeIntent } from '@/lib/intent/intent'
import { revalidatePath } from 'next/cache'

/**
 * Refresh a company's buying-intent: re-detect hiring signals from its website,
 * persist them + the recomputed intent score/signals. Cheap, on-demand.
 */
export async function triggerIntentScan(formData: FormData): Promise<void> {
  const companyId = String(formData.get('companyId') ?? '')
  if (!companyId) return
  try {
    const sb = await createServiceClient()
    const { data: company } = await sb.from('companies').select('*').eq('id', companyId).single()
    if (!company) return

    // Refresh hiring signal from the website (best-effort).
    let hiringRoles = (company.hiring_roles as string[] | null) ?? []
    let hiringSignal = !!company.hiring_signal
    if (company.website) {
      try {
        const hs = await detectHiringSignals(company.website as string)
        if (hs.detected) { hiringSignal = true; hiringRoles = [...new Set([...hiringRoles, ...hs.roles])] }
      } catch { /* noop */ }
    }

    const intent = computeIntent({
      hiring_signal: hiringSignal,
      hiring_roles: hiringRoles,
      recruitment_signals: company.recruitment_signals as string[] | null,
      management_pain_signals: company.management_pain_signals as string[] | null,
      new_products_detected: company.new_products_detected as boolean | null,
      funding_detected: company.funding_detected as boolean | null,
      trigger_type: company.trigger_type as string | null,
      trigger_detail: company.trigger_detail as string | null,
      status: company.status as string | null,
    })

    await sb.from('companies').update({
      hiring_signal: hiringSignal,
      hiring_roles: hiringRoles,
      intent_score: intent.score,
      intent_signals: intent.signals,
      intent_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', companyId)
  } catch (err) {
    console.error('[triggerIntentScan]', err)
  }
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/bd/today')
  revalidatePath('/contacts')
}
