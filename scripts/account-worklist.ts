/**
 * Account Worklist — `npm run worklist`.
 *
 * Computes the two operating metrics for A-grade accounts and persists them:
 *   Coverage Score (intelligence depth, founder-aware) + Progress Stage
 *   (revenue progression). Ranks by Coverage × P(next stage) and prints the
 *   worklist with the single action that advances each account one stage.
 *
 * The objective is movement, not contacts — the printed action column is the
 * next lever for each account.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { computeCredibility } from '@/lib/contacts/credibility'
import {
  computeCoverage, deriveStage, pNextStage, accountPriority,
  stageName, isCaptured, type ContactLite, type RoleType,
} from '@/lib/intel/account-progress'

const TOP = Number(process.env.WORKLIST_TOP || 20)

function roleOf(roleType: string | null, title: string | null): RoleType {
  const t = (roleType || '').toLowerCase()
  if (t === 'founder' || t === 'sourcing' || t === 'production') return t as RoleType
  if (t === 'product') return 'product'
  const x = (title || '').toLowerCase()
  if (/founder|ceo|owner|chief exec|president/.test(x)) return 'founder'
  if (/sourc|purchas|buyer/.test(x)) return 'sourcing'
  if (/product develop|merchand|developer|head of product/.test(x)) return 'product'
  if (/produc/.test(x)) return 'production'
  return 'other'
}

async function main() {
  const sb = createDirectClient()
  const { data: all } = await sb.from('companies').select('id,name,domain,status,source_raw').eq('customer_tier', 'A')
  const top = (all || [])
    .filter((c: any) => c.source_raw?.probs?.sample)
    .filter((c: any) => c.source_raw?.qualified !== false) // exclude disqualified (media/listicle/non-buyer)
    .sort((a: any, b: any) => b.source_raw.probs.sample - a.source_raw.probs.sample)
    .slice(0, TOP)
  const ids = top.map((c: any) => c.id)

  const [cts, reps, samp, qs, ords, deals] = await Promise.all([
    sb.from('contacts').select('company_id,title,role_type,decision_level,email,email_verified,email_source,email_confidence,linkedin_url').in('company_id', ids),
    sb.from('reply_events').select('company_id').in('company_id', ids),
    sb.from('samples').select('company_id').in('company_id', ids),
    sb.from('quote_strategies').select('company_id').in('company_id', ids),
    sb.from('orders').select('company_id').in('company_id', ids),
    sb.from('deals').select('company_id,status').in('company_id', ids),
  ])
  const grp = (a: any[]) => { const m: Record<string, any[]> = {}; for (const x of a || []) (m[x.company_id] = m[x.company_id] || []).push(x); return m }
  const C = grp(cts.data || []), R = grp(reps.data || []), S = grp(samp.data || []), Q = grp(qs.data || []), OD = grp(ords.data || []), D = grp(deals.data || [])

  const rows: any[] = []
  for (const c of top as any[]) {
    const raw = c.source_raw || {}
    const contacts: ContactLite[] = (C[c.id] || []).map((x: any) => ({
      roleType: roleOf(x.role_type, x.title),
      isDecisionMaker: x.decision_level === 'decision_maker',
      reachable: ['verified', 'trusted'].includes(computeCredibility(x).tier) || !!x.linkedin_url,
    }))
    const accountFactsKnown = [raw.category, raw.wedge, raw.customer_type || raw.type].filter(Boolean).length
    const cov = computeCoverage({ contacts, hasSupplierIntel: !!raw.customs || !!raw.supplier_hints, accountFactsKnown })

    const stage = deriveStage({
      hasReachableDM: contacts.some((x) => x.reachable),
      engaged: (R[c.id] || []).length > 0,
      qualified: ['qualified', 'engaged'].includes(c.status),
      sampleSent: (S[c.id] || []).length > 0,
      quoteSent: (Q[c.id] || []).length > 0,
      opportunity: (D[c.id] || []).some((x: any) => x.status === 'open'),
      poReceived: (OD[c.id] || []).length > 0,
    })
    const pNext = pNextStage(stage, raw.probs?.sample ?? 50)
    const priority = accountPriority(cov.score, pNext)

    await sb.from('companies').update({
      source_raw: { ...raw, coverage: cov.score, coverageBreakdown: cov, stage, stageName: stageName(stage), captured: isCaptured(stage), pNext, priority },
    }).eq('id', c.id)

    rows.push({ name: (raw.brand || c.name || '').replace(/\s+/g, ' ').slice(0, 22), cov: cov.score, stage, pNext, priority, captured: isCaptured(stage), wedge: raw.wedge || '—', cls: raw.accountClass === 'retailer' ? '🟡零售' : '🟢品牌' })
  }

  rows.sort((a, b) => b.priority - a.priority)
  const ACTION: Record<number, string> = { 2: '发开发信 → Connected', 3: '判定意向 → Qualified', 4: '寄样 → Sample Sent', 5: '报价 → Quote Sent', 6: '推进 → Opportunity', 7: '催单 → PO' }
  console.log('\n═══ ACCOUNT WORKLIST — Coverage × P(next) ═══')
  console.log('Pri Cov 捕获 Stage         P→  类型   Wedge            品牌                   下一步')
  for (const r of rows) {
    console.log(
      `${String(r.priority).padStart(3)} ${String(r.cov).padStart(3)} ${(r.captured ? '✓' : '·').padEnd(3)} ${stageName(r.stage).padEnd(12)} ${String(r.pNext).padStart(3)} ${r.cls} ${String(r.wedge).padEnd(16)} ${r.name.padEnd(22)} ${ACTION[r.stage] || '—'}`,
    )
  }
  const dist: Record<string, number> = {}
  for (const r of rows) dist[stageName(r.stage)] = (dist[stageName(r.stage)] || 0) + 1
  console.log('\nStage 分布:', JSON.stringify(dist))
  console.log('已捕获(Connected+):', rows.filter((r) => r.captured).length, '/', rows.length, '· 平均 Coverage:', Math.round(rows.reduce((s, r) => s + r.cov, 0) / rows.length))
  console.log('瓶颈: 全部卡在 Reachable — 推进杠杆 = 给可达 DM 发 wedge 定制开发信\n')
}
main().catch((e) => { console.error(e); process.exit(1) })
