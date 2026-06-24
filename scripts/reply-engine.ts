/**
 * Reply Engine daily report — `npm run replies`.
 * Per-outreach tracking + WHY NO REPLY + the 6-part daily report.
 * KPI chain: Reply → Sample → Quote → PO.
 */
import { createDirectClient } from '@/lib/supabase/server'
import { computeCredibility } from '@/lib/contacts/credibility'
import { ctaType, classifyWhyNoReply, nextActionFor, WHY_LABEL } from '@/lib/sales/reply-engine'
import { sampleOffer } from '@/lib/sales/order-engine'

const DAY = 86_400_000

async function main() {
  const sb = createDirectClient()
  const { data: logs } = await sb.from('outreach_logs')
    .select('id,company_id,contact_id,subject,body,sent_at,replied_at,reply_intent,status, contacts(full_name,email,email_source,email_verified,email_confidence,linkedin_url), companies(name,source_raw,current_supplier_hints)')
    .in('status', ['sent', 'bounced']).order('sent_at', { ascending: true })
  const ids = (logs || []).map((l) => l.company_id)
  const { data: bounceRows } = await sb.from('reply_events').select('outreach_log_id,company_id,reply_intent').ilike('reply_intent', '%bounce%')
  const bouncedLogs = new Set((bounceRows || []).map((b) => b.outreach_log_id).filter(Boolean))
  const bouncedCos = new Set((bounceRows || []).map((b) => b.company_id))
  // follow-ups already sent (per company): more than 1 sent outreach
  const sentByCo: Record<string, number> = {}
  for (const l of logs || []) if (l.status === 'sent') sentByCo[l.company_id] = (sentByCo[l.company_id] || 0) + 1
  const [{ data: samp }, { data: quo }, { data: ords }] = await Promise.all([
    sb.from('samples').select('company_id').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('quote_strategies').select('company_id').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
    sb.from('orders').select('company_id').in('company_id', ids).then((r) => r, () => ({ data: [] as any[] })),
  ])
  const sampCos = new Set(((samp as any).data || []).map((x: any) => x.company_id))
  const quoCos = new Set(((quo as any).data || []).map((x: any) => x.company_id))
  const poCos = new Set(((ords as any).data || []).map((x: any) => x.company_id))
  const now = Date.now()

  const rows = (logs || []).map((l) => {
    const c = Array.isArray(l.contacts) ? l.contacts[0] : l.contacts
    const co = Array.isArray(l.companies) ? l.companies[0] : l.companies
    const tier = c ? computeCredibility(c).tier : 'none'
    const guessed = !['verified', 'trusted'].includes(tier)
    const bounced = l.status === 'bounced' || bouncedLogs.has(l.id) || /bounce/i.test(l.reply_intent || '') || bouncedCos.has(l.company_id)
    const replied = !!l.replied_at && !bounced
    const daysSinceSent = l.sent_at ? Math.floor((now - new Date(l.sent_at).getTime()) / DAY) : null
    const followUpDone = (sentByCo[l.company_id] || 0) > 1
    const cta = ctaType(l.body || '')
    const hasIncumbent = (co?.current_supplier_hints?.length ?? 0) > 0 || !!co?.source_raw?.importYeti?.totalShipments
    const why = classifyWhyNoReply({ replied, bounced, daysSinceSent, ctaType: cta, hasIncumbentSupplier: hasIncumbent, followUpDone })
    const offer = sampleOffer(co?.source_raw?.wedge)
    return {
      brand: (co?.source_raw?.brand || co?.name || '?').slice(0, 20),
      contact: c?.full_name || '(none)', verified: !guessed,
      sent: l.sent_at?.slice(0, 10) || '—', daysSinceSent,
      fuDue: l.sent_at ? new Date(new Date(l.sent_at).getTime() + 4 * DAY).toISOString().slice(0, 10) : '—',
      bounced, replied, wedge: co?.source_raw?.wedge || '?', cta,
      sampleReq: /sample/i.test(l.reply_intent || '') || sampCos.has(l.company_id),
      quoteReq: /quote/i.test(l.reply_intent || '') || quoCos.has(l.company_id),
      po: poCos.has(l.company_id),
      why, nextAction: nextActionFor(why, { offer }),
    }
  })

  console.log('\n═══════ REPLY ENGINE · 每封已发 ═══════')
  for (const r of rows) {
    console.log(`\n■ ${r.brand} → ${r.contact} ${r.verified ? '✅verified' : '❌guessed'}`)
    console.log(`  发:${r.sent}(${r.daysSinceSent}d) 跟进Due:${r.fuDue} 退:${r.bounced ? 'Y' : '—'} 复:${r.replied ? 'Y' : '—'} | wedge:${r.wedge} cta:${r.cta} | 样:${r.sampleReq ? 'Y' : '—'} 报:${r.quoteReq ? 'Y' : '—'} PO:${r.po ? 'Y' : '—'}`)
    console.log(`  WHY NO REPLY: ${WHY_LABEL[r.why]}  →  ${r.nextAction}`)
  }

  // ── Daily report ──
  const delivered = rows.filter((r) => !r.bounced)
  const n = delivered.length || 1
  const replies = delivered.filter((r) => r.replied).length
  const samples = rows.filter((r) => r.sampleReq).length
  const quotes = rows.filter((r) => r.quoteReq).length
  const pos = rows.filter((r) => r.po).length
  const whyCount: Record<string, number> = {}
  for (const r of delivered) if (!r.replied) whyCount[r.why] = (whyCount[r.why] || 0) + 1
  const topWhy = Object.entries(whyCount).sort((a, b) => b[1] - a[1])[0]
  const pct = (x: number) => `${Math.round((x / n) * 100)}%`

  console.log('\n═══════ DAILY REPORT ═══════')
  console.log(`1. Reply Rate:   ${replies}/${delivered.length} delivered = ${pct(replies)}   (退信 ${rows.filter((r) => r.bounced).length})`)
  console.log(`2. Sample Rate:  ${samples}/${delivered.length} = ${pct(samples)}`)
  console.log(`3. Quote Rate:   ${quotes}/${delivered.length} = ${pct(quotes)}`)
  console.log(`4. PO Rate:      ${pos}/${delivered.length} = ${pct(pos)}`)
  console.log(`5. Top Bottleneck: ${topWhy ? `${WHY_LABEL[topWhy[0] as keyof typeof WHY_LABEL]} (${topWhy[1]}/${delivered.length})` : '—'}`)
  // Highest-probability next action = drive the dominant bottleneck.
  const allTooEarly = delivered.every((r) => r.why === 'timing')
  const nextDue = delivered.map((r) => r.fuDue).filter((d) => d !== '—').sort()[0]
  console.log(`6. Highest-Prob Next Action: ${allTooEarly
    ? `等到 Day-4(${nextDue}) 发"sample-first"跟进#1 — 当前0回复=太早,非失败信号; 不要灌量`
    : topWhy ? nextActionFor(topWhy[0] as any, { offer: '对标其核心款的 spec sample' }) : '—'}`)
  console.log('\n北极星: 首个样品 → 首个报价 → 首个 PO。')
}
main().catch((e) => { console.error(e); process.exit(1) })
