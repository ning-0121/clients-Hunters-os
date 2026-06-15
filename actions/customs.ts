'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { lookupCustoms } from '@/lib/enrichment/customs'
import { revalidatePath } from 'next/cache'

/**
 * Look up a company's customs / supplier data via ImportYeti (through Serper).
 * Runs synchronously — Serper is fast (~1-3s), well under the serverless limit,
 * so no queue/worker needed. Stores results in source_raw.customs and merges
 * supplier names into current_supplier_hints.
 */
export async function triggerCustomsLookup(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return

  const sb = await createServiceClient()
  const { data: c } = await sb
    .from('companies')
    .select('name, domain, source_raw, current_supplier_hints')
    .eq('id', companyId)
    .single()
  if (!c) return

  const result = await lookupCustoms(c.name, c.domain)

  const sourceRaw = { ...((c.source_raw as Record<string, unknown>) ?? {}), customs: result }
  const hints = [...new Set([...(c.current_supplier_hints ?? []), ...result.supplierHints])].slice(0, 15)

  await sb.from('companies').update({
    source_raw: sourceRaw,
    current_supplier_hints: hints,
    updated_at: new Date().toISOString(),
  }).eq('id', companyId)

  revalidatePath(`/companies/${companyId}`)
}

/** Save a salesperson's manual customs note (e.g. what they read on ImportYeti). */
export async function saveCustomsNotes(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  const notes = (formData.get('notes') as string ?? '').slice(0, 2000)
  if (!companyId) return
  const sb = await createServiceClient()
  const { data: c } = await sb.from('companies').select('source_raw').eq('id', companyId).single()
  const sourceRaw = { ...((c?.source_raw as Record<string, unknown>) ?? {}), customs_notes: notes }
  await sb.from('companies').update({ source_raw: sourceRaw, updated_at: new Date().toISOString() }).eq('id', companyId)
  revalidatePath(`/companies/${companyId}`)
}
