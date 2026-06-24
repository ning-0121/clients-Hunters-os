/**
 * QIMO Order Engine — daily report. `npm run attack`.
 * Three dashboards, one KPI (POs), built from live data:
 *   1) Top-20 Coverage   2) Today's Attack List   3) Revenue Funnel
 * Actions only, no analysis. Move every account to the next stage.
 */
import { createDirectClient } from '@/lib/supabase/server'
import {
  FUNNEL, FUNNEL_LABEL, deriveFunnelStage, roleFlags, companySize, isCovered, coverageGaps,
  sampleOffer, probabilities, requiredActionToday, followUpDue, type FunnelStage,
} from '@/lib/sales/order-engine'

const TOP = Number(process.env.ATTACK_TOP || 20)
const DAY = 86_400_000

async function main() {
  const sb = createDirectClient()
  const { data: all } = await sb.from('companies')
    .select('id,name,domain,source_raw,assigned_to,employee_count_range,status')
    .eq('customer_tier', 'A')
  const top = (all || [])
    .filter((c: any) => c.source_raw?.probs?.sample && c.source_raw?.qualified !== false)
    .sort((a: any, b: any) => (b.source_raw?.priority ?? 0) - (a.source_raw?.priority ?? 0) || (b.source_raw.probs.sample - a.source_raw.probs.sample))
    .slice(0, TOP)
  const ids = top.map((c: any) => c.id)

  const [cts, outs, reps, samp, quo, ords] = await Promise.all([
    sb.from('contacts').select('company_id,full_name,title,role_type,email,email_verified,email_source,email_confidence,linkedin_url,contact_priority').in('company_id', ids),
    sb.from('outreach_logs').select('company_id,status,sent_at,replied_at,reply_intent,contact_id').in('company_id', ids),
    sb.from('reply_events').select('company_id,reply_intent,received_at').in('company_id', ids),
    sb.from('samples').select('company_id,status').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('quote_strategies').select('company_id').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('orders').select('company_id,is_repeat').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
  ])
  const grp = (a: any[]) => { const m: Record<string, any[]> = {}; for (const x of a || []) (m[x.company_id] = m[x.company_id] || []).push(x); return m }
  const C = grp(cts.data || []), O = grp(outs.data || []), R = grp(reps.data || []), S = grp((samp as any).data || []), Q = grp((quo as any).data || []), OD = grp((ords as any).data || [])
  const now = Date.now()

  const rows = top.map((c: any) => {
    const raw = c.source_raw || {}
    const contacts = C[c.id] || []
    const size = companySize(c.employee_count_range)
    const flags = roleFlags(contacts)
    const covered = isCovered(size, flags)
    const sent = (O[c.id] || []).filter((o) => o.status === 'sent')
    const lastSent = sent.map((o) => o.sent_at).filter(Boolean).sort().slice(-1)[0]
    // Bounces are NOT replies — a mailer-daemon failure means a bad address, not engagement.
    const reps = (R[c.id] || []).filter((r) => !/bounce/i.test(r.reply_intent ?? ''))
    const replied = reps.length > 0 || sent.some((o) => o.replied_at && !/bounce/i.test(o.reply_intent ?? ''))
    const sampleReq = reps.some((r) => /sample/i.test(r.reply_intent ?? '')) || sent.some((o) => /sample/i.test(o.reply_intent ?? '')) || (S[c.id] || []).some((s) => /request/i.test(s.status ?? ''))
    const sampleSent = (S[c.id] || []).some((s) => /sent|ship|approv/i.test(s.status ?? '')) || ((S[c.id] || []).length > 0 && !sampleReq)
    const stage = deriveFunnelStage({
      covered, outreachSent: sent.length > 0, replied, sampleRequested: sampleReq,
      sampleSent, quoted: (Q[c.id] || []).length > 0,
      trialOrder: (OD[c.id] || []).length > 0, scaleOrder: (OD[c.id] || []).some((o) => o.is_repeat),
    })
    const hasDraft = (O[c.id] || []).some((o) => o.status === 'pending_approval' && o.contact_id)
    const dm = contacts.slice().sort((a, b) => (b.contact_priority ?? 0) - (a.contact_priority ?? 0)).find((x) => x.email) ?? contacts[0]
    const offer = sampleOffer(raw.wedge, raw.category)
    const daysSinceSent = lastSent ? Math.floor((now - new Date(lastSent).getTime()) / DAY) : null
    const lastTouchTs = [lastSent, ...reps.map((r) => r.received_at)].filter(Boolean).sort().slice(-1)[0]
    const probs = probabilities(stage, raw.probs?.sample ?? 50)
    const action = requiredActionToday(stage, { dmName: dm?.full_name, offer, daysSinceSent, hasDraft })
    const brand = raw.brand || (c.name || '').replace(/\s+/g, ' ').slice(0, 22)
    return { brand, size, covered, gaps: coverageGaps(size, flags), stage, lastTouchTs, daysSinceSent, owner: c.assigned_to || '未分配', probs, action, hasDraft, dueFu: daysSinceSent != null && !replied ? followUpDue(daysSinceSent) : null }
  })

  // Urgency: act-today first.
  const URG: Record<FunnelStage, number> = { replied: 100, sample_requested: 95, quotation: 88, sample_sent: 80, contact_captured: 70, outreach_sent: 40, trial_order: 60, scale_order: 50, discovered: 45 }
  const urgency = (r: any) => (r.stage === 'outreach_sent' && r.dueFu ? 75 : URG[r.stage as FunnelStage]) + r.probs.po / 100
  const ranked = rows.slice().sort((a, b) => urgency(b) - urgency(a))
  const fmtDate = (ts?: string) => ts ? new Date(ts).toISOString().slice(5, 10) : '—'

  // ── Dashboard 3: Revenue Funnel ──
  const stageCount: Record<string, number> = {}
  for (const r of rows) { const i = FUNNEL.indexOf(r.stage as FunnelStage); for (let k = 0; k <= i; k++) stageCount[FUNNEL[k]] = (stageCount[FUNNEL[k]] || 0) + 1 }
  console.log('\n════════ DASHBOARD 3 · REVENUE FUNNEL (Top ' + rows.length + ') ════════')
  for (const s of FUNNEL) console.log(`  ${FUNNEL_LABEL[s].padEnd(14)} ${'█'.repeat(stageCount[s] || 0)}${stageCount[s] || 0}`)

  // ── Dashboard 1: Top-20 Coverage ──
  console.log('\n════════ DASHBOARD 1 · TOP-20 COVERAGE ════════')
  console.log('覆盖 规模  阶段          品牌                   缺口 / 负责人')
  for (const r of rows) console.log(`${r.covered ? '✅' : '⬜'}   ${r.size.padEnd(6)} ${FUNNEL_LABEL[r.stage].padEnd(12)} ${r.brand.padEnd(22)} ${r.covered ? '— ' : '缺'+r.gaps.join(',')+' '}· ${r.owner}`)

  // ── Dashboard 2: Today's Attack List ──
  console.log('\n════════ DASHBOARD 2 · TODAY\'S ATTACK LIST ════════')
  console.log('阶段          上次  P样/报/单   品牌                   今日动作')
  for (const r of ranked) {
    const p = `${String(r.probs.sample).padStart(3)}/${String(r.probs.quote).padStart(2)}/${String(r.probs.po).padStart(2)}`
    console.log(`${FUNNEL_LABEL[r.stage].padEnd(12)} ${fmtDate(r.lastTouchTs).padEnd(5)} ${p}  ${r.brand.padEnd(22)} ${r.action}`)
  }

  const captured = rows.filter((r) => r.covered).length
  const sent = rows.filter((r) => FUNNEL.indexOf(r.stage as FunnelStage) >= FUNNEL.indexOf('outreach_sent')).length
  console.log(`\n小结: 覆盖 ${captured}/${rows.length} · 已触达 ${sent} · 已回复 ${stageCount['replied'] || 0} · 样品 ${stageCount['sample_sent'] || 0} · 报价 ${stageCount['quotation'] || 0} · PO ${stageCount['trial_order'] || 0}`)
  console.log('北极星 = 签单 PO。今日重点: 把"今日动作"逐条做掉,优先 🔥 已回复。\n')
}
main().catch((e) => { console.error(e); process.exit(1) })
