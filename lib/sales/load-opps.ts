/**
 * loadOpps — build the Revenue-OS Opportunity set from live data. Shared by the
 * Command Center page and the `npm run revenue` script so both use identical,
 * verified logic. No new schema: stage + signals are derived from existing tables.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { roleFlags, deriveFunnelStage, type FunnelStage } from '@/lib/sales/order-engine'
import { estimatePoValue, devClass, type Opp, type Potential, type Reachability } from '@/lib/sales/revenue-os'
import { computeCredibility } from '@/lib/contacts/credibility'

const DAY = 86_400_000

export async function loadOpps(): Promise<Opp[]> {
  const sb = createDirectClient()
  const { data: all } = await sb.from('companies')
    .select('id,name,source_raw,assigned_to,next_action,next_action_due,why_no_reply,customer_scale_score,estimated_annual_revenue,price_point')
    .eq('customer_tier', 'A')
  const base = (all || []).filter((c: any) => c.source_raw?.probs?.sample && c.source_raw?.qualified !== false)
  const ids = base.map((c: any) => c.id)
  if (!ids.length) return []
  const [cts, outs, reps, samp, quo, ords, deals] = await Promise.all([
    sb.from('contacts').select('company_id,id,full_name,title,role_type,email,email_verified,email_source,email_confidence,linkedin_url').in('company_id', ids),
    sb.from('outreach_logs').select('company_id,status,sent_at,replied_at,reply_intent').in('company_id', ids),
    sb.from('reply_events').select('company_id,reply_intent,received_at').in('company_id', ids),
    sb.from('samples').select('company_id,status,created_at').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('quote_strategies').select('company_id,created_at').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('orders').select('company_id,is_repeat').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('deals').select('company_id,status,stage').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
  ])
  const grp = (a: any[]) => { const m: Record<string, any[]> = {}; for (const x of a || []) (m[x.company_id] = m[x.company_id] || []).push(x); return m }
  const C = grp(cts.data || []), O = grp(outs.data || []), R = grp((reps as any).data || []), S = grp((samp as any).data || []), Q = grp((quo as any).data || []), OD = grp((ords as any).data || []), D = grp((deals as any).data || [])
  const now = Date.now()
  const ageDays = (ts?: string) => ts ? Math.floor((now - new Date(ts).getTime()) / DAY) : null

  return base.map((c: any): Opp => {
    const contacts = C[c.id] || []
    const flags = roleFlags(contacts)
    const sent = (O[c.id] || []).filter((o) => o.status === 'sent')
    const lastSentAt = sent.map((o) => o.sent_at).filter(Boolean).sort().slice(-1)[0]
    const repsReal = (R[c.id] || []).filter((r) => !/bounce/i.test(r.reply_intent || ''))
    const replied = repsReal.length > 0
    const sampleRows = S[c.id] || [], quoteRows = Q[c.id] || [], orderRows = OD[c.id] || []
    const sampleSent = sampleRows.some((s) => /sent|ship|approv/i.test(s.status || '')) || sampleRows.length > 0
    const stage: FunnelStage = deriveFunnelStage({
      covered: flags.founderReachableEmailLi || flags.founder, outreachSent: sent.length > 0, replied,
      sampleRequested: repsReal.some((r) => /sample/i.test(r.reply_intent || '')), sampleSent,
      quoted: quoteRows.length > 0, trialOrder: orderRows.length > 0, scaleOrder: orderRows.some((o) => o.is_repeat),
    })
    const latestReply = repsReal.map((r) => r.received_at).filter(Boolean).sort().slice(-1)[0]

    // 3-color class: Potential (value/intent) × Reachability (verified DM?)
    const reachableDM = contacts.find((x) => ['verified', 'trusted'].includes(computeCredibility(x).tier))
    const reachability: Reachability = reachableDM ? 'R1' : contacts.length ? 'R2' : 'R3'
    const sampleProb = c.source_raw?.probs?.sample ?? 50
    const potential: Potential = c.source_raw?.qualified === false ? 'P0' : sampleProb >= 70 ? 'P1' : sampleProb >= 40 ? 'P2' : 'P3'
    const klass = devClass(potential, reachability)
    const dm = reachableDM ?? contacts.find((x) => x.email) ?? contacts[0]

    return {
      companyId: c.id, brand: (c.source_raw?.brand || c.name || '?').slice(0, 22), stage,
      poValueUsd: estimatePoValue({ customerScaleScore: c.customer_scale_score, estimatedAnnualRevenue: c.estimated_annual_revenue, pricePoint: c.price_point }),
      founder: flags.founder, dmName: (dm as any)?.full_name ?? null,
      dmContactId: (dm as any)?.id ?? null, dmRole: (dm as any)?.role_type ?? (dm as any)?.title ?? null, dmEmail: (dm as any)?.email ?? null,
      potential, reachability, klass,
      ownerAssigned: !!c.assigned_to, owner: (c.assigned_to as string) ?? null, hasNextAction: !!(c.next_action && String(c.next_action).trim()),
      nextActionDueAt: (c.next_action_due as string) ?? null, whyNoReply: (c.why_no_reply as string) ?? null,
      replyAgeDays: replied ? ageDays(latestReply) : null,
      outreachSentAgeDays: !replied && lastSentAt ? ageDays(lastSentAt) : null,
      sampleSentAgeDays: sampleRows.length ? ageDays(sampleRows[0].created_at) : null, sampleHasFeedback: false,
      quoteSentAgeDays: quoteRows.length ? ageDays(quoteRows[0].created_at) : null, quoteFollowedUp: false,
      poDiscussionActive: (D[c.id] || []).some((d) => d.status === 'open' && /negotiat|trial/i.test(d.stage || '')),
    }
  })
}

export interface NeedsContact { companyId: string; brand: string; potential: Potential; reason: string }

/**
 * 🟡 补联系人车道 —— 真正的「假A级」：高价值（grade A/B），但无任何可达联系人。
 * 单独加载，不进 Money List/漏损/预测（那些只装可开发的）。
 */
export async function loadNeedsContact(limit = 40): Promise<NeedsContact[]> {
  const sb = createDirectClient()
  const { data: cos } = await sb.from('companies')
    .select('id,name,grade,total_score,customer_tier,source_raw')
    .or('grade.eq.A,grade.eq.B,customer_tier.eq.A')
    .order('total_score', { ascending: false, nullsFirst: false })
    .limit(150)
  const list = (cos || []).filter((c: any) => c.source_raw?.qualified !== false)
  const ids = list.map((c: any) => c.id)
  if (!ids.length) return []
  const byCo: Record<string, any[]> = {}
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await sb.from('contacts').select('company_id,email,email_verified,email_source,email_confidence,linkedin_url').in('company_id', ids.slice(i, i + 200))
    for (const x of data || []) (byCo[x.company_id] = byCo[x.company_id] || []).push(x)
  }
  const out: NeedsContact[] = []
  for (const c of list as any[]) {
    const contacts = byCo[c.id] || []
    const hasVerified = contacts.some((x) => ['verified', 'trusted'].includes(computeCredibility(x).tier))
    if (hasVerified) continue // already reachable → not a fill-contact case
    const grade = c.grade as string | null
    const potential: Potential = grade === 'A' ? 'P1' : grade === 'B' ? 'P2' : 'P3'
    if (potential === 'P3') continue // low value + unreachable → drop, not fill
    out.push({
      companyId: c.id, brand: (c.source_raw?.brand || c.name || '?').slice(0, 24), potential,
      reason: contacts.length ? `有${contacts.length}个联系人但邮箱未验证 → 验证邮箱` : '无任何联系人 → 用 Apollo / 查决策人',
    })
  }
  return out.slice(0, limit)
}
