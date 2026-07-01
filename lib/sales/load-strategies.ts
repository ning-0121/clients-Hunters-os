/**
 * loadStrategies (V7) — recompute each StrategyUnit's causal VECTOR live from
 * real outcomes. For every strategy-tagged send we derive its outcome + context,
 * run decomposeOutcome(), and accumulate message/timing/contact impact, then
 * bound each dimension into [0,1]. No stored ML model, no new tables, no manual
 * retraining — vectors move on their own as replies/samples/quotes/POs accrue.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { STRATEGY_CATALOG, decomposeOutcome, clamp01, type StrategyUnit, type StrategyResult } from '@/lib/sales/strategy'

const DAY = 86_400_000

export async function loadStrategies(): Promise<StrategyUnit[]> {
  const sb = createDirectClient()
  const cat: StrategyUnit[] = STRATEGY_CATALOG.map((s) => ({ ...s, stats: { ...s.stats }, vector: { ...s.vector } }))

  const { data: logs } = await sb
    .from('outreach_logs')
    .select('company_id, personalization_data, status, sent_at, replied_at')
    .not('personalization_data', 'is', null)
  const tagged = (logs || []).filter((l: any) => l.personalization_data?.strategyId)

  // Real outcome progression per tagged company (real tables only).
  const companyIds = [...new Set((tagged as any[]).map((l) => l.company_id).filter(Boolean))] as string[]
  const has = { sample: new Set<string>(), quote: new Set<string>(), po: new Set<string>() }
  if (companyIds.length) {
    const [samp, quo, ord] = await Promise.all([
      sb.from('samples').select('company_id').in('company_id', companyIds).then((r) => r.data ?? [], () => []),
      sb.from('quote_strategies').select('company_id').in('company_id', companyIds).then((r) => r.data ?? [], () => []),
      sb.from('orders').select('company_id').in('company_id', companyIds).then((r) => r.data ?? [], () => []),
    ])
    for (const x of samp as any[]) has.sample.add(x.company_id)
    for (const x of quo as any[]) has.quote.add(x.company_id)
    for (const x of ord as any[]) has.po.add(x.company_id)
  }

  const outcomeOf = (l: any): StrategyResult => {
    const cid = l.company_id
    if (cid && has.po.has(cid)) return 'po_closed'
    if (cid && has.quote.has(cid)) return 'quote_requested'
    if (cid && has.sample.has(cid)) return 'sample_requested'
    if (l.replied_at || l.status === 'replied') return 'reply'
    return 'no_response'
  }

  // Accumulate causal attribution per strategy.
  const raw: Record<string, { m: number; t: number; c: number; imp: number; engaged: number; cos: Set<string> }> = {}
  for (const l of tagged as any[]) {
    const sid = l.personalization_data.strategyId as string
    // contact quality comes from the situationVector stamped at send (spec §6); missing → null → 0 impact
    const situation = (l.personalization_data.situationVector ?? null) as any
    const contactQuality = situation && typeof situation.contactStrength === 'number' ? situation.contactStrength : null
    const outcome = outcomeOf(l)
    const timeSinceLastTouch = l.replied_at && l.sent_at ? (new Date(l.replied_at).getTime() - new Date(l.sent_at).getTime()) / DAY : null
    const attr = decomposeOutcome(outcome, { timeSinceLastTouch, contactQuality, strategyId: sid })
    const r = (raw[sid] ??= { m: 0, t: 0, c: 0, imp: 0, engaged: 0, cos: new Set() })
    r.m += attr.messageImpact
    r.t += attr.timingImpact
    r.c += attr.contactImpact
    r.imp++
    if (outcome !== 'no_response') r.engaged++
    if (l.company_id) r.cos.add(l.company_id)
  }

  for (const s of cat) {
    const r = raw[s.id]
    if (r) {
      s.vector = { message: clamp01(r.m), timing: clamp01(r.t), contact: clamp01(r.c) }
      s.replyRate = r.imp ? r.engaged / r.imp : 0
      const ids = [...r.cos]
      s.stats = {
        impressions: r.imp,
        replies: r.engaged,
        samples: ids.filter((id) => has.sample.has(id)).length,
        quotes: ids.filter((id) => has.quote.has(id)).length,
        pos: ids.filter((id) => has.po.has(id)).length,
      }
    }
    // display-only summary scalar (vector magnitude); NOT used for selection
    s.effectivenessScore = Math.hypot(s.vector.message, s.vector.timing, s.vector.contact)
  }
  return cat
}
