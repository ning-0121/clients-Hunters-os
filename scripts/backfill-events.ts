/**
 * One-time (idempotent) backfill of customer_events from existing tables, so the
 * unified timeline shows history. Re-running is safe: it clears the system events
 * it regenerates (ref_table in the set below) and rebuilds them; manual events are
 * never touched. Requires migration 013 applied.
 *   npx tsx --env-file=.env.local scripts/backfill-events.ts
 */
import { createDirectClient } from '@/lib/supabase/server'

const sb = createDirectClient()
type Ev = Record<string, unknown>
const clip = (s: string, n = 140) => s.slice(0, n)

async function main() {
  await sb.from('customer_events').delete().eq('source', 'system')
    .in('ref_table', ['outreach_logs', 'reply_events', 'samples', 'orders', 'quote_strategies'])

  const evs: Ev[] = []

  const { data: logs } = await sb.from('outreach_logs')
    .select('id, company_id, contact_id, subject, sent_at, created_at, status, direction')
  for (const l of logs ?? []) {
    if (!(l.status === 'sent' || l.direction === 'outbound')) continue
    evs.push({ company_id: l.company_id, contact_id: l.contact_id, event_type: 'email_out', direction: 'out', channel: 'email',
      occurred_at: l.sent_at ?? l.created_at, title: clip(`发送邮件：${l.subject ?? ''}`), source: 'system', ref_table: 'outreach_logs', ref_id: l.id })
  }

  const { data: reps } = await sb.from('reply_events').select('id, company_id, contact_id, reply_subject, reply_intent, received_at')
  for (const r of reps ?? []) {
    if (['bounce', 'auto_reply', 'unsubscribe'].includes(String(r.reply_intent))) continue
    evs.push({ company_id: r.company_id, contact_id: r.contact_id, event_type: 'email_in', direction: 'in', channel: 'email',
      occurred_at: r.received_at, title: clip(`收到回复：${r.reply_subject ?? ''}`), source: 'system', ref_table: 'reply_events', ref_id: r.id })
  }

  const { data: smp } = await sb.from('samples').select('id, company_id, deal_id, styles_requested, created_at')
  for (const s of smp ?? []) {
    const styles = Array.isArray(s.styles_requested) ? (s.styles_requested as string[]) : []
    evs.push({ company_id: s.company_id, deal_id: s.deal_id, event_type: 'sample', direction: 'out', channel: 'system',
      occurred_at: s.created_at, title: clip(`寄样请求${styles.length ? '：' + styles.join('、') : ''}`), source: 'system', ref_table: 'samples', ref_id: s.id })
  }

  const { data: ords } = await sb.from('orders').select('id, company_id, deal_id, order_ref, order_value_usd, created_at')
  for (const o of ords ?? []) {
    evs.push({ company_id: o.company_id, deal_id: o.deal_id, event_type: 'po', direction: 'in', channel: 'system',
      occurred_at: o.created_at, title: clip(`订单${o.order_ref ? ' ' + o.order_ref : ''}${o.order_value_usd ? ' · $' + o.order_value_usd : ''}`), source: 'system', ref_table: 'orders', ref_id: o.id })
  }

  const { data: qs } = await sb.from('quote_strategies').select('id, company_id, deal_id, category, qty, created_at')
  for (const q of qs ?? []) {
    evs.push({ company_id: q.company_id, deal_id: q.deal_id, event_type: 'quote', direction: 'internal', channel: 'system',
      occurred_at: q.created_at, title: clip(`报价快照：${q.category} × ${q.qty}`), source: 'system', ref_table: 'quote_strategies', ref_id: q.id })
  }

  let n = 0
  for (let i = 0; i < evs.length; i += 500) {
    const batch = evs.slice(i, i + 500)
    const { error } = await sb.from('customer_events').insert(batch)
    if (error) { console.error('insert error:', error.message); process.exit(1) }
    n += batch.length
  }
  console.log(`✓ 回填 customer_events ${n} 条（邮件/回复/样品/订单/报价）`)
}
main().then(() => process.exit(0))
