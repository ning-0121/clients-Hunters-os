'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { computeAccess, type AccessContact } from '@/lib/contacts/access'
import { buildBrief } from '@/lib/intel/brief'
import { companyFactsFromRow, briefContactsFromRows } from '@/lib/intel/inputs'
import type { BriefInputs, IntelligenceBrief } from '@/lib/intel/types'

const CONTACT_COLS =
  'full_name,title,role_type,decision_level,email,email_verified,email_deliverable,email_confidence,email_source,status,contact_priority'

/**
 * Build the Customer Intelligence Brief from existing data (pure, fast, no LLM).
 * Returns the brief AND caches it on companies.intelligence_brief (best-effort —
 * the cache is an optimization; the report page also computes the brief live).
 */
export async function buildBriefForCompany(companyId: string): Promise<IntelligenceBrief | null> {
  const sb = await createServiceClient()
  const { data: company } = await sb.from('companies').select('*').eq('id', companyId).single()
  if (!company) return null

  const { data: contacts } = await sb.from('contacts').select(CONTACT_COLS)
    .eq('company_id', companyId).order('contact_priority', { ascending: false })
  const { data: quotes } = await sb.from('quote_strategies').select('product_category').eq('company_id', companyId)
  const { data: deals } = await sb.from('deals').select('status').eq('company_id', companyId).eq('status', 'open')

  const access = computeAccess((contacts ?? []) as AccessContact[])
  const inputs: BriefInputs = {
    company: companyFactsFromRow(company),
    contacts: briefContactsFromRows(contacts ?? []),
    access,
    quoteCategories: (quotes ?? []).map((q) => (q as { product_category?: string }).product_category).filter((v): v is string => !!v),
    openDeals: (deals ?? []).length,
  }
  const brief: IntelligenceBrief = { ...buildBrief(inputs), generatedAt: new Date().toISOString() }

  // Best-effort cache (column added by migration 014; ignore if not yet applied).
  try {
    await sb.from('companies').update({ intelligence_brief: brief, intelligence_brief_at: brief.generatedAt }).eq('id', companyId)
  } catch { /* column may not exist yet */ }

  return brief
}

/** Form-action wrapper for the "rebuild brief" button. */
export async function rebuildBriefAction(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  await buildBriefForCompany(companyId)
  revalidatePath(`/companies/${companyId}/report`)
  revalidatePath(`/companies/${companyId}`)
}
