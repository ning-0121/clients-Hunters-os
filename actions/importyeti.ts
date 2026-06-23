'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { importYetiLookup } from '@/lib/enrichment/importyeti'
import { revalidatePath } from 'next/cache'

/**
 * Pull real ImportYeti customs data for a company and persist it into source_raw
 * (HQ address, import volume, origin countries, suppliers). Evidence only — if no
 * match, we record that fact rather than inventing anything.
 */
export async function triggerImportYetiLookup(formData: FormData): Promise<void> {
  const companyId = formData.get('companyId') as string
  if (!companyId) return
  const sb = await createServiceClient()
  const { data: company } = await sb.from('companies').select('name, domain, source_raw, current_supplier_hints').eq('id', companyId).single()
  if (!company) return

  const query = (company.name as string) || (company.domain as string) || ''
  const r = await importYetiLookup(query)

  const raw = (company.source_raw as Record<string, unknown> | null) ?? {}
  const snippets: string[] = []
  if (r.matched) {
    if (r.totalShipments != null) snippets.push(`ImportYeti: ${r.totalShipments} 票进口至 ${r.countryCode ?? '?'}（最近 ${r.mostRecentShipment ?? '?'}）`)
    if (r.originCountries.length) snippets.push(`原产国: ${r.originCountries.join(', ')}`)
    for (const s of r.suppliers.slice(0, 8)) snippets.push(`供应商: ${s.name} [${s.countryCode}]${s.shipments ? ` ×${s.shipments}` : ''}`)
  }

  const patch: Record<string, unknown> = {
    ...raw,
    hqAddress: r.matched ? r.hqAddress ?? null : (raw.hqAddress ?? null),
    importYeti: r.matched
      ? { totalShipments: r.totalShipments, countryCode: r.countryCode, mostRecentShipment: r.mostRecentShipment, companyUrl: r.companyUrl, originCountries: r.originCountries, suppliers: r.suppliers, checkedAt: new Date().toISOString() }
      : { matched: false, checkedAt: new Date().toISOString() },
  }
  if (snippets.length) patch.customs = { snippets, importYeti: true }

  const update: Record<string, unknown> = { source_raw: patch }
  // Promote discovered supplier names into current_supplier_hints (don't clobber existing).
  const supplierNames = r.suppliers.map((s) => s.name).filter(Boolean)
  if (supplierNames.length && !(company.current_supplier_hints?.length)) update.current_supplier_hints = supplierNames.slice(0, 8)

  await sb.from('companies').update(update).eq('id', companyId)
  revalidatePath(`/companies/${companyId}/report`)
  revalidatePath(`/companies/${companyId}`)
}
