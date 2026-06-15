'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { composeOutreach, type ComposeContext } from '@/lib/outreach/compose'
import { revalidatePath } from 'next/cache'

const LATAM = ['Mexico', 'Colombia', 'Brazil', 'Argentina', 'Peru', 'Chile', 'Venezuela']

/** Build a one-line summary of OUR (QIMO) real factory capabilities + cert status. */
async function ourCapabilitiesSummary(sb: Awaited<ReturnType<typeof createServiceClient>>): Promise<string> {
  const { data: own } = await sb.from('factory_profiles').select('id, main_categories').eq('factory_type', 'own_factory').limit(1).maybeSingle()
  if (!own) return ''
  const { data: caps } = await sb.from('factory_capabilities').select('category, capability_level').eq('factory_id', own.id)
  const { data: certs } = await sb.from('factory_certifications').select('certification_type, status').eq('factory_id', own.id)
  const strong = (caps ?? []).filter((c) => c.capability_level === 'strong').map((c) => c.category)
  const certStr = (certs ?? []).map((c) => `${c.certification_type}:${c.status}`).join(', ')
  return `强项品类：${strong.join('、') || (own.main_categories as string[] | null)?.join('、') || '运动服'}；认证：${certStr || '无记录'}`
}

/** Generate (or regenerate with feedback) a working outreach draft for a company. */
export async function composeOutreachDraft(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const feedback = (formData.get('feedback') as string)?.trim() || undefined
  if (!companyId) return

  const sb = await createServiceClient()
  const { data: company } = await sb.from('companies').select('*').eq('id', companyId).single()
  if (!company) return
  const { data: contact } = await sb.from('contacts').select('full_name, title')
    .eq('company_id', companyId).order('contact_priority', { ascending: false }).limit(1).maybeSingle()

  const country = company.country as string | null
  const lang = country === 'Brazil' ? 'pt' : (country && LATAM.includes(country)) ? 'es' : 'en'
  const customs = (company.source_raw as Record<string, unknown> | null)?.customs as { snippets?: string[] } | undefined

  const ctx: ComposeContext = {
    companyName: company.name,
    website: company.website, country, categories: company.product_categories,
    description: company.description, tier: company.customer_tier,
    productMatch: Array.isArray(company.product_match) ? company.product_match : [],
    currentSuppliers: company.current_supplier_hints ?? [],
    customsSnippet: (customs?.snippets ?? []).join(' | '),
    contactName: contact?.full_name, contactTitle: contact?.title,
    ourCapabilities: await ourCapabilitiesSummary(sb),
    lang,
  }

  const composed = await composeOutreach(ctx, feedback)
  if (!composed) return

  // Upsert a single working 'draft' row per company.
  const { data: existing } = await sb.from('outreach_logs').select('id')
    .eq('company_id', companyId).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle()

  const row = {
    company_id: companyId, contact_id: undefined as string | undefined,
    channel: 'email', direction: 'outbound',
    subject: composed.subject, body: composed.body,
    personalization_data: { analysis: composed.analysis, lang, studio: true, feedback: feedback ?? null },
    status: 'draft', executed_by: 'ai',
  }
  if (existing) await sb.from('outreach_logs').update(row).eq('id', existing.id)
  else await sb.from('outreach_logs').insert(row)

  revalidatePath(`/companies/${companyId}/outreach`)
}

/** Save a salesperson's manual edits to the working draft. */
export async function saveOutreachEdit(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const logId = formData.get('logId') as string
  const subject = (formData.get('subject') as string ?? '').slice(0, 300)
  const body = (formData.get('body') as string ?? '').slice(0, 8000)
  if (!logId) return
  const sb = await createServiceClient()
  await sb.from('outreach_logs').update({ subject, body }).eq('id', logId)
  revalidatePath(`/companies/${companyId}/outreach`)
}

/** Submit the working draft for approval — flips to pending_approval + creates an approval. */
export async function submitOutreachForApproval(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const logId = formData.get('logId') as string
  if (!logId || !companyId) return
  const sb = await createServiceClient()
  const { data: log } = await sb.from('outreach_logs').select('id, subject, contact_id').eq('id', logId).single()
  if (!log) return

  const { data: contact } = await sb.from('contacts').select('id').eq('company_id', companyId).order('contact_priority', { ascending: false }).limit(1).maybeSingle()
  const { data: company } = await sb.from('companies').select('name, customer_tier').eq('id', companyId).single()

  await sb.from('outreach_logs').update({ status: 'pending_approval', contact_id: log.contact_id ?? contact?.id ?? null }).eq('id', logId)

  await sb.from('approvals').insert({
    company_id: companyId,
    contact_id: log.contact_id ?? contact?.id ?? null,
    approval_level: company?.customer_tier === 'A' ? 'L3' : 'L2',
    approval_type: 'email_first_touch',
    title: `发送开发信：${company?.name ?? '客户'}`,
    description: log.subject ?? '',
    action_payload: { outreachLogId: logId },
    risk_level: company?.customer_tier === 'A' ? 'high' : 'medium',
    requested_by: 'human',
    expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
  })

  revalidatePath(`/companies/${companyId}/outreach`)
  revalidatePath('/approvals')
}
