/**
 * Daily customer assignment engine.
 *
 * Tops every salesperson up to their per-tier quota (default 5A / 10B / 15C),
 * pulling ONLY contact-ready customers from the unassigned pool — a customer
 * with no usable contact is never assigned (that's the whole point: a rep should
 * never be handed a lead they can't reach). Reports shortfalls so the team knows
 * to enrich more, and never re-assigns or steals customers already owned.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { getAppConfig, type AssignQuota } from '@/lib/config'

export type Tier = 'A' | 'B' | 'C'
const TIERS: Tier[] = ['A', 'B', 'C']

export interface AssignmentSummary {
  ranAt: string
  quota: AssignQuota
  people: string[]
  assigned: Record<string, { A: number; B: number; C: number; total: number }>
  shortfall: Record<Tier, number>   // unmet demand per tier (no contact-ready supply)
  poolUsed: Record<Tier, number>
  note: string
}

/**
 * A customer is "contact-ready" if we can actually reach a decision-maker:
 *   A → must already have a verified key contact (enforced by the tier gate).
 *   B/C → at least one contact with an email.
 */
function buildContactReadySet(contacts: Array<{ company_id: string | null; email: string | null; email_verified: boolean | null; email_deliverable: boolean | null; phone: string | null }>) {
  const hasEmail = new Set<string>()
  const hasVerified = new Set<string>()
  for (const c of contacts) {
    if (!c.company_id) continue
    if (c.email && c.email.trim()) hasEmail.add(c.company_id)
    if (c.email_verified === true || c.email_deliverable === true || (c.phone && c.phone.trim())) hasVerified.add(c.company_id)
  }
  return { hasEmail, hasVerified }
}

export async function runDailyAssignment(stampIso: string): Promise<AssignmentSummary> {
  const sb = await createServiceClient()
  const cfg = await getAppConfig()
  const people = cfg.salespeople
  const quota = cfg.assignQuota

  const summary: AssignmentSummary = {
    ranAt: stampIso,
    quota,
    people,
    assigned: Object.fromEntries(people.map((p) => [p, { A: 0, B: 0, C: 0, total: 0 }])),
    shortfall: { A: 0, B: 0, C: 0 },
    poolUsed: { A: 0, B: 0, C: 0 },
    note: '',
  }

  if (people.length === 0) {
    summary.note = '未配置销售名册 —— 请先到「设置 → 销售团队」添加销售邮箱。'
    return summary
  }

  // Active customers (anything not closed) with their tier + owner.
  const { data: companies } = await sb
    .from('companies')
    .select('id, customer_tier, assigned_to, status')
    .in('customer_tier', TIERS)
    .neq('status', 'closed_lost')
    .neq('status', 'closed_won')
    .limit(5000)
  const C = companies ?? []

  // Contacts to determine contact-readiness.
  const ids = C.map((c) => c.id)
  const contactRows: Array<{ company_id: string | null; email: string | null; email_verified: boolean | null; email_deliverable: boolean | null; phone: string | null }> = []
  for (let i = 0; i < ids.length; i += 1000) {
    const { data } = await sb.from('contacts')
      .select('company_id, email, email_verified, email_deliverable, phone')
      .in('company_id', ids.slice(i, i + 1000))
    if (data) contactRows.push(...data)
  }
  const { hasEmail, hasVerified } = buildContactReadySet(contactRows)

  const isReady = (companyId: string, tier: Tier) =>
    tier === 'A' ? hasVerified.has(companyId) : hasEmail.has(companyId)

  // Per tier: count current holdings + build an unassigned, contact-ready pool.
  for (const tier of TIERS) {
    const inTier = C.filter((c) => c.customer_tier === tier)
    const held: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]))
    for (const c of inTier) {
      if (c.assigned_to && held[c.assigned_to] !== undefined) held[c.assigned_to]++
    }

    const pool = inTier
      .filter((c) => !c.assigned_to && isReady(c.id, tier))
      .map((c) => c.id)

    // Round-robin top-up so the pool spreads evenly when supply is scarce.
    const need = (p: string) => Math.max(0, quota[tier] - held[p] - summary.assigned[p][tier])
    let poolIdx = 0
    let progress = true
    while (poolIdx < pool.length && progress) {
      progress = false
      for (const p of people) {
        if (poolIdx >= pool.length) break
        if (need(p) <= 0) continue
        const companyId = pool[poolIdx++]
        await sb.from('companies').update({ assigned_to: p, updated_at: stampIso }).eq('id', companyId)
        summary.assigned[p][tier]++
        summary.assigned[p].total++
        summary.poolUsed[tier]++
        progress = true
      }
    }

    // Remaining unmet demand across everyone for this tier.
    summary.shortfall[tier] = people.reduce((acc, p) => acc + need(p), 0)
  }

  const totalAssigned = Object.values(summary.assigned).reduce((a, s) => a + s.total, 0)
  const shortTotal = summary.shortfall.A + summary.shortfall.B + summary.shortfall.C
  summary.note = shortTotal > 0
    ? `已分派 ${totalAssigned} 个。缺口：A 缺 ${summary.shortfall.A}、B 缺 ${summary.shortfall.B}、C 缺 ${summary.shortfall.C}（联系方式齐全的未分配客户不足，请多富集/验证邮箱后再分派）。`
    : `已分派 ${totalAssigned} 个，所有销售配额已满（5A/10B/15C）。`

  // Persist the summary for display.
  try {
    await sb.from('app_config').upsert({ id: 'singleton', last_assignment: summary, updated_at: stampIso }, { onConflict: 'id' })
  } catch { /* noop */ }

  return summary
}
