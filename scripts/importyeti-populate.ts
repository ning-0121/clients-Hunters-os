/**
 * Batch-populate ImportYeti customs data for A-grade accounts so the brief shows
 * real HQ address / origins / import volume. Throttled, idempotent (skips already
 * checked unless --force).
 */
import { createDirectClient } from '@/lib/supabase/server'
import { importYetiLookup } from '@/lib/enrichment/importyeti'

const FORCE = process.argv.includes('--force')
const LIMIT = Number(process.env.IY_LIMIT || 20)

async function main() {
  const sb = createDirectClient()
  const { data: all } = await sb.from('companies').select('id,name,domain,source_raw,current_supplier_hints').eq('customer_tier', 'A')
  const top = (all || [])
    .filter((c: any) => c.source_raw?.qualified !== false)
    .sort((a: any, b: any) => (b.source_raw?.priority ?? 0) - (a.source_raw?.priority ?? 0))
    .slice(0, LIMIT)

  let done = 0, matched = 0
  for (const c of top as any[]) {
    if (!FORCE && c.source_raw?.importYeti) { console.log(`· skip ${c.source_raw?.brand || c.name} (已查)`); continue }
    const query = c.source_raw?.brand || c.name || c.domain
    const r = await importYetiLookup(query).catch(() => null)
    done++
    if (!r || !r.matched) {
      // Clear any prior false HQ; record low-confidence candidate link (no fabrication).
      const note = r?.confidence === 'low' ? `低置信候选(需人工确认): ${r.companyName}` : '无海关匹配'
      console.log(`✗ ${query} — ${note}`)
      await sb.from('companies').update({
        source_raw: { ...(c.source_raw || {}), hqAddress: null, customs: undefined, importYeti: { matched: false, confidence: r?.confidence ?? 'none', candidateUrl: r?.companyUrl ?? null, candidateName: r?.companyName ?? null } },
      }).eq('id', c.id)
      continue
    }
    matched++
    const snippets: string[] = []
    if (r.totalShipments != null) snippets.push(`ImportYeti: ${r.totalShipments} 票进口至 ${r.countryCode ?? '?'}（最近 ${r.mostRecentShipment ?? '?'}）`)
    if (r.originCountries.length) snippets.push(`原产国: ${r.originCountries.join(', ')}`)
    for (const s of r.suppliers.slice(0, 8)) snippets.push(`供应商: ${s.name} [${s.countryCode}]${s.shipments ? ` ×${s.shipments}` : ''}`)
    const patch: any = {
      ...(c.source_raw || {}),
      hqAddress: r.hqAddress ?? null,
      importYeti: { totalShipments: r.totalShipments, countryCode: r.countryCode, mostRecentShipment: r.mostRecentShipment, companyUrl: r.companyUrl, originCountries: r.originCountries, suppliers: r.suppliers },
    }
    if (snippets.length) patch.customs = { snippets, importYeti: true }
    const update: any = { source_raw: patch }
    const supplierNames = r.suppliers.map((s) => s.name).filter(Boolean)
    if (supplierNames.length && !(c.current_supplier_hints?.length)) update.current_supplier_hints = supplierNames.slice(0, 8)
    await sb.from('companies').update(update).eq('id', c.id)
    console.log(`✓ ${query} → HQ:${r.hqAddress ?? '?'} · ${r.totalShipments}票 · 原产:${r.originCountries.join(',') || '?'}`)
    await new Promise((res) => setTimeout(res, 1500)) // gentle throttle
  }
  console.log(`\n完成:${done} 处理 · ${matched} 命中海关数据`)
}
main().catch((e) => { console.error(e); process.exit(1) })
