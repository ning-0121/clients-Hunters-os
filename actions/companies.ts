'use server'

import { createDirectClient } from '@/lib/supabase/server'
import { getBdIdentity } from '@/lib/bd/shared'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

/**
 * Enqueue an agent job instead of running it synchronously.
 *
 * Running an agent inline (scrape + LLM) takes 20-90s and exceeds the
 * serverless function timeout on Vercel — the button appears to "do nothing".
 * Enqueueing returns instantly; the background worker (npm run worker) picks
 * the job up from agent_queue and processes it. Refresh to see the result.
 */
async function enqueue(jobType: string, companyId: string, priority = 3, extra: Record<string, unknown> = {}) {
  const supabase = createDirectClient()
  await supabase.from('agent_queue').insert({
    job_type: jobType,
    payload: { companyId, ...extra },
    priority,
  })
  revalidatePath(`/companies/${companyId}`)
  revalidatePath('/companies')
}

export async function triggerEnrichCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  if (companyId) await enqueue('enrich_company', companyId, 4)
}

export async function triggerScoreCompany(formData: FormData) {
  const companyId = formData.get('companyId') as string
  if (companyId) await enqueue('score_company', companyId, 3)
}

export async function triggerDraftOutreach(formData: FormData) {
  const companyId = formData.get('companyId') as string
  if (companyId) await enqueue('draft_outreach', companyId, 3)
}

/**
 * Manually create a customer to follow up on. Inserts the company (assigned to
 * the creator, source='manual', status='raw'), optionally a known contact, then
 * kicks off the standard enrich → score → tier pipeline so it's immediately
 * trackable in the pool. Dedupes on domain.
 */
export async function createCompanyManually(formData: FormData): Promise<void> {
  const str = (k: string) => ((formData.get(k) as string) ?? '').trim()
  const name = str('name')
  if (!name) redirect('/companies/new?error=name')

  const website = str('website') || null
  const domain = website
    ? (website.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase() || null)
    : null
  const categories = str('categories').split(',').map((s) => s.trim()).filter(Boolean)

  const sb = createDirectClient()

  // Dedupe: if this domain already exists, go to that company instead.
  if (domain) {
    const { data: existing } = await sb.from('companies').select('id').eq('domain', domain).maybeSingle()
    if (existing?.id) redirect(`/companies/${existing.id}?exists=1`)
  }

  const { who } = await getBdIdentity()
  const { data: company, error } = await sb.from('companies').insert({
    name,
    website,
    domain,
    country: str('country') || 'United States',
    description: str('description') || null,
    product_categories: categories.length ? categories : null,
    source: 'manual',
    status: 'raw',
    assigned_to: who && who !== 'me' ? who : null,   // so it shows in 我的客户
  }).select('id').single()
  if (error || !company?.id) redirect('/companies/new?error=create')

  // Optional known contact.
  const cName = str('contactName'), cEmail = str('contactEmail'), cPhone = str('contactPhone')
  if (cName || cEmail || cPhone) {
    await sb.from('contacts').insert({
      company_id: company.id,
      full_name: cName || null,
      title: str('contactTitle') || null,
      email: cEmail || null,
      phone: cPhone || null,
      source: 'manual',
      email_source: cEmail ? 'manual' : null,
      status: 'uncontacted',
      contact_priority: 8,
    })
  }

  // Kick off the standard pipeline (enrich → score → tier).
  await sb.from('agent_queue').insert({ job_type: 'enrich_company', payload: { companyId: company.id }, priority: 4 })
  revalidatePath('/companies')
  revalidatePath('/bd/leads')
  redirect(`/companies/${company.id}?created=1`)
}
