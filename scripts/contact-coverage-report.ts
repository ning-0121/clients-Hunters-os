/**
 * Contact Coverage Report — the Contact Intelligence Engine's acceptance metric.
 *   npx tsx --env-file=.env.local scripts/contact-coverage-report.ts
 *
 * North Star: of the HIGH-VALUE (naturally A-grade) companies, what share have a
 * VERIFIED Champion or Decision-Maker (i.e. are actually reachable)? "Naturally A"
 * is recomputed from the stored feasibility dimensions, so it counts the A-in-
 * waiting companies that the contact gate currently caps to B — exactly the
 * population this engine must convert into reachable accounts.
 *
 * Run before and after a hunting window; the ratio going up is the success test.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { naturalTier, isComplianceLevel, type TierDimensions } from '@/lib/tiering/tiering'
import { computeAccess, type AccessContact } from '@/lib/contacts/access'

const num = (v: unknown) => (typeof v === 'number' ? v : 0)
const pct = (n: number, d: number) => (d === 0 ? '—' : `${((100 * n) / d).toFixed(1)}%`)

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

async function main() {
  const sb = createDirectClient()

  const { data: companies, error } = await sb
    .from('companies')
    .select('id, name, customer_tier, customer_scale_score, product_match_score, conversion_feasibility_score, strategic_value_score, payment_risk_score, compliance_level')
    .range(0, 9999)
  if (error) { console.error('load companies failed:', error.message); process.exit(1) }

  const rows = companies ?? []
  // Recompute the natural (pre-contact-gate) tier so A-in-waiting is included.
  const naturalA = rows.filter((c) => {
    const dims: TierDimensions = {
      customerScaleScore: num(c.customer_scale_score),
      productMatchScore: num(c.product_match_score),
      conversionFeasibilityScore: num(c.conversion_feasibility_score),
      strategicValueScore: num(c.strategic_value_score),
      paymentRiskScore: num(c.payment_risk_score),
      complianceLevel: isComplianceLevel(c.compliance_level) ? c.compliance_level : 'basic_docs',
    }
    return naturalTier(dims) === 'A'
  })
  const aIds = naturalA.map((c) => c.id as string)

  // Load contacts + champion links for the A population.
  const contactsByCompany = new Map<string, AccessContact[]>()
  const championIds: string[] = []
  for (const ids of chunk(aIds, 200)) {
    if (!ids.length) continue
    const { data: contacts } = await sb
      .from('contacts')
      .select('id, company_id, email, email_verified, email_deliverable, email_confidence, email_source, role_type, decision_level, status')
      .in('company_id', ids)
    for (const ct of contacts ?? []) {
      const cid = ct.company_id as string
      if (!contactsByCompany.has(cid)) contactsByCompany.set(cid, [])
      contactsByCompany.get(cid)!.push(ct as AccessContact)
    }
    const { data: deals } = await sb
      .from('deals')
      .select('champion_contact_id')
      .in('company_id', ids)
    for (const d of deals ?? []) if (d.champion_contact_id) championIds.push(d.champion_contact_id as string)
  }

  // Score every A company.
  const buckets: Record<number, number> = { 0: 0, 20: 0, 40: 0, 60: 0, 80: 0, 100: 0, 10: 0 }
  let reachable = 0
  let scoreSum = 0
  const unreachable: Array<{ name: string; score: number; missing: string[] }> = []
  for (const c of naturalA) {
    const access = computeAccess(contactsByCompany.get(c.id as string) ?? [], { championContactIds: championIds })
    buckets[access.score] = (buckets[access.score] ?? 0) + 1
    scoreSum += access.score
    if (access.hasVerifiedChampionOrDM) reachable++
    else unreachable.push({ name: (c.name as string) ?? c.id as string, score: access.score, missing: access.missingRoles })
  }

  const denom = naturalA.length
  const storedA = rows.filter((c) => c.customer_tier === 'A').length

  console.log('\n══════════ Contact Coverage Report ══════════')
  console.log(`扫描公司总数:               ${rows.length}`)
  console.log(`高价值(自然 A 级):          ${denom}`)
  console.log(`  其中已存为 customer_tier=A: ${storedA}  (其余被联系人闸门暂降为 B)`)
  console.log('──────────────────────────────────────────────')
  console.log(`★ 北极星 — A 级中拥有「已验证 Champion / 决策人」:`)
  console.log(`    ${reachable} / ${denom}  =  ${pct(reachable, denom)}`)
  console.log(`平均 Access Score(A 级):    ${denom ? (scoreSum / denom).toFixed(1) : '—'} / 100`)
  console.log('──────────────────────────────────────────────')
  console.log('Access Score 分布(A 级):')
  for (const s of [0, 10, 20, 40, 60, 80, 100]) console.log(`    ${String(s).padStart(3)} 分: ${buckets[s] ?? 0}`)
  console.log('──────────────────────────────────────────────')
  console.log(`待补的高价值账户(Top 15,按缺口):`)
  for (const u of unreachable.sort((a, b) => b.score - a.score).slice(0, 15)) {
    console.log(`    [${String(u.score).padStart(3)}] ${u.name}  → 缺: ${u.missing.join(' / ') || '—'}`)
  }
  console.log('══════════════════════════════════════════════\n')
  process.exit(0)
}

main().catch((e) => { console.error(e); process.exit(1) })
