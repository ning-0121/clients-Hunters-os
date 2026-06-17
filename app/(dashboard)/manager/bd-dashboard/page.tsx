import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getAppConfig } from '@/lib/config'
import { triggerDailyAssignment } from '@/actions/assignment'

export const dynamic = 'force-dynamic'

const STRICT = ['sedex_smeta', 'customer_audit', 'supplier_portal']

export default async function ManagerBdDashboard() {
  const sb = await createClient()
  const now = Date.now(), dayAgo = new Date(now - 86400_000).toISOString()
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)

  const [
    { data: companies }, { data: tasks }, { data: replies }, { data: reports }, { data: outreach },
    { count: orderCount }, { count: sampleCount },
  ] = await Promise.all([
    sb.from('companies').select('id, name, customer_tier, target_customer_segment, domestic_company_type, recommended_factory_type, recommended_factory_id, compliance_level, compliance_blockers, assigned_to, status').limit(3000),
    sb.from('tasks').select('id, company_id, assigned_to, task_type, status, due_at, completed_at, reply_event_id').limit(3000),
    sb.from('reply_events').select('id, company_id, reply_sentiment, reply_intent, received_at').limit(2000),
    sb.from('customer_intelligence_reports').select('company_id').limit(3000),
    sb.from('outreach_logs').select('company_id, status, sent_at').limit(3000),
    sb.from('orders').select('*', { count: 'exact', head: true }),
    sb.from('samples').select('*', { count: 'exact', head: true }),
  ])

  const cfg = await getAppConfig()
  const { data: cfgRow } = await sb.from('app_config').select('last_assignment').eq('id', 'singleton').maybeSingle()
  const lastAssignment = cfgRow?.last_assignment as { ranAt?: string; note?: string } | null

  const C = companies ?? [], T = tasks ?? [], R = replies ?? [], O = outreach ?? []
  const reportSet = new Set((reports ?? []).map((r) => r.company_id).filter(Boolean) as string[])
  const outreachSet = new Set(O.map((o) => o.company_id).filter(Boolean) as string[])
  const repliedSet = new Set(R.map((r) => r.company_id).filter(Boolean) as string[])
  const handledReplyTasks = new Set(T.filter((t) => t.reply_event_id && t.status === 'done').map((t) => t.reply_event_id))

  // 1. Team task overview
  const openTasks = T.filter((t) => t.status === 'open' || t.status === 'in_progress')
  const overdueTasks = openTasks.filter((t) => t.due_at && new Date(t.due_at).getTime() < now)
  const completedToday = T.filter((t) => t.completed_at && new Date(t.completed_at) >= dayStart)
  const highPriorityReplies = R.filter((r) => (r.reply_intent?.includes('quote') || r.reply_intent?.includes('sample') || r.reply_sentiment === 'positive') && !handledReplyTasks.has(r.id)).length

  // 2. Pipeline
  const pipeline = [
    ['已发现', C.filter((c) => c.status === 'raw').length],
    ['已富集', C.filter((c) => c.status === 'enriched').length],
    ['已评分', C.filter((c) => c.status === 'scored').length],
    ['已分级', C.filter((c) => !!c.customer_tier).length],
    ['已出报告', C.filter((c) => reportSet.has(c.id)).length],
    ['已起草', C.filter((c) => outreachSet.has(c.id)).length],
    ['已触达', C.filter((c) => ['outreach', 'engaged', 'qualified', 'closed_won'].includes(c.status)).length],
    ['已回复', C.filter((c) => repliedSet.has(c.id)).length],
    ['报价机会', openTasks.filter((t) => t.task_type === 'quote_followup').length],
    ['样品机会', openTasks.filter((t) => t.task_type === 'sample_followup').length],
    ['订单', orderCount ?? 0],
    ['样品单', sampleCount ?? 0],
  ] as [string, number][]

  // 3. Salesperson performance
  const people = new Map<string, { leads: number; open: number; done: number; overdue: number; quote: number; sample: number }>()
  const ensure = (k: string) => { if (!people.has(k)) people.set(k, { leads: 0, open: 0, done: 0, overdue: 0, quote: 0, sample: 0 }); return people.get(k)! }
  for (const c of C) if (c.assigned_to) ensure(c.assigned_to).leads++
  for (const t of T) {
    if (!t.assigned_to) continue
    const r = ensure(t.assigned_to)
    if (t.status === 'done') r.done++
    else { r.open++; if (t.due_at && new Date(t.due_at).getTime() < now) r.overdue++ }
    if (t.task_type === 'quote_followup') r.quote++
    if (t.task_type === 'sample_followup') r.sample++
  }
  const perfRows = [...people.entries()].sort((a, b) => b[1].leads - a[1].leads)

  // 4. Customer quality
  const quality = [
    ['B 级目标客户', C.filter((c) => c.customer_tier === 'B').length],
    ['A 级战略客户', C.filter((c) => c.customer_tier === 'A').length],
    ['国内软件客户', C.filter((c) => c.domestic_company_type === 'software_prospect').length],
    ['需合作工厂', C.filter((c) => c.recommended_factory_type === 'partner_smeta').length],
    ['被合规阻塞', C.filter((c) => Array.isArray(c.compliance_blockers) && c.compliance_blockers.length > 0).length],
  ] as [string, number][]

  // 5. Risk alerts
  const aMissingReport = C.filter((c) => c.customer_tier === 'A' && !reportSet.has(c.id))
  const smetaNoPartner = C.filter((c) => STRICT.includes(c.compliance_level ?? '') && !c.recommended_factory_id)
  const positiveUnhandled = R.filter((r) => (r.reply_sentiment === 'positive' || r.reply_intent?.includes('quote') || r.reply_intent?.includes('sample')) && new Date(r.received_at).toISOString() < dayAgo && !handledReplyTasks.has(r.id))
  const overdueQuoteSample = overdueTasks.filter((t) => t.task_type === 'quote_followup' || t.task_type === 'sample_followup')
  const highValueNoOwner = C.filter((c) => (c.customer_tier === 'A' || c.customer_tier === 'B') && !c.assigned_to && c.status !== 'closed_lost')

  const alerts: { label: string; items: { id: string; name?: string }[] }[] = [
    { label: 'A 级客户缺少报告', items: aMissingReport.map((c) => ({ id: c.id, name: c.name })) },
    { label: '需 SMETA 但未匹配合作工厂', items: smetaNoPartner.map((c) => ({ id: c.id, name: c.name })) },
    { label: '正面回复 24h 未处理', items: positiveUnhandled.map((r) => ({ id: r.company_id ?? r.id, name: undefined })) },
    { label: '报价/样品任务逾期', items: overdueQuoteSample.map((t) => ({ id: t.company_id ?? t.id, name: undefined })) },
    { label: '高价值客户无负责人', items: highValueNoOwner.map((c) => ({ id: c.id, name: c.name })) },
  ]

  // Assignment: per-salesperson tier holdings vs quota.
  const activeC = C.filter((c) => c.status !== 'closed_lost' && c.status !== 'closed_won')
  const holdings = cfg.salespeople.map((p) => {
    const mine = activeC.filter((c) => c.assigned_to === p)
    return {
      who: p,
      A: mine.filter((c) => c.customer_tier === 'A').length,
      B: mine.filter((c) => c.customer_tier === 'B').length,
      C: mine.filter((c) => c.customer_tier === 'C').length,
    }
  })
  const q = cfg.assignQuota

  const Kpi = ({ label, value, warn }: { label: string; value: number; warn?: boolean }) => (
    <Card><CardContent className="py-3"><div className={`text-2xl font-bold ${warn && value > 0 ? 'text-red-600' : ''}`}>{value}</div><div className="text-xs text-muted-foreground mt-0.5">{label}</div></CardContent></Card>
  )

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div><h1 className="text-2xl font-bold">BD 经理看板</h1><p className="text-sm text-muted-foreground mt-1">团队工作量 · 漏斗 · 业绩 · 客户质量 · 风险</p></div>

      {/* ── 客户分派 ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">客户分派（每人 {q.A}A / {q.B}B / {q.C}C）</h2>
          <form action={triggerDailyAssignment}>
            <button type="submit" className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">分派今日客户</button>
          </form>
        </div>
        {cfg.salespeople.length === 0 ? (
          <Card><CardContent className="py-6 text-center text-sm text-muted-foreground">
            还没有销售名册。<Link href="/settings" className="text-primary hover:underline">去「设置 → 销售团队」添加销售 →</Link>
          </CardContent></Card>
        ) : (
          <Card><CardContent className="py-0 px-0">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b text-muted-foreground"><tr>{['销售', `A (${q.A})`, `B (${q.B})`, `C (${q.C})`, '合计'].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {holdings.map((h) => {
                  const cell = (n: number, target: number) => <span className={n < target ? 'text-amber-600' : 'text-green-600'}>{n}/{target}</span>
                  return (
                    <tr key={h.who}>
                      <td className="px-3 py-2 font-medium">{h.who}</td>
                      <td className="px-3 py-2">{cell(h.A, q.A)}</td>
                      <td className="px-3 py-2">{cell(h.B, q.B)}</td>
                      <td className="px-3 py-2">{cell(h.C, q.C)}</td>
                      <td className="px-3 py-2 font-medium">{h.A + h.B + h.C}/{q.A + q.B + q.C}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </CardContent></Card>
        )}
        {lastAssignment?.note && (
          <p className="text-[11px] text-muted-foreground mt-2">上次分派：{lastAssignment.ranAt ? new Date(lastAssignment.ranAt).toLocaleString() : ''} —— {lastAssignment.note}</p>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">团队任务概览</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi label="待办任务" value={openTasks.length} />
          <Kpi label="逾期任务" value={overdueTasks.length} warn />
          <Kpi label="今日完成" value={completedToday.length} />
          <Kpi label="高优回复待处理" value={highPriorityReplies} warn />
        </div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">线索漏斗</h2>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">{pipeline.map(([l, v]) => <Kpi key={l} label={l} value={v} />)}</div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">销售业绩</h2>
        <Card><CardContent className="py-0 px-0">
          {perfRows.length === 0 ? <p className="text-sm text-muted-foreground py-6 text-center">还没有客户被分配给销售。</p> : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b text-muted-foreground"><tr>{['销售', '负责客户', '待办', '已完成', '逾期', '报价', '样品'].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {perfRows.map(([who, r]) => (
                  <tr key={who}><td className="px-3 py-2 font-medium">{who}</td><td className="px-3 py-2">{r.leads}</td><td className="px-3 py-2">{r.open}</td><td className="px-3 py-2">{r.done}</td><td className={`px-3 py-2 ${r.overdue > 0 ? 'text-red-600' : ''}`}>{r.overdue}</td><td className="px-3 py-2">{r.quote}</td><td className="px-3 py-2">{r.sample}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent></Card>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">客户质量</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">{quality.map(([l, v]) => <Kpi key={l} label={l} value={v} />)}</div>
      </section>

      <section>
        <h2 className="text-sm font-semibold mb-2">风险预警</h2>
        <div className="space-y-2">
          {alerts.map((a) => (
            <Card key={a.label} className={`border-l-4 ${a.items.length > 0 ? 'border-l-red-500' : 'border-l-green-500'}`}><CardContent className="py-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{a.label}</span>
                <span className={`text-sm font-bold ${a.items.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{a.items.length}</span>
              </div>
              {a.items.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-2">
                  {a.items.slice(0, 8).map((it, i) => it.id ? <Link key={i} href={`/companies/${it.id}`} className="text-[11px] px-2 py-0.5 border rounded hover:bg-accent">{it.name ?? '查看客户'}</Link> : null)}
                  {a.items.length > 8 && <span className="text-[11px] text-muted-foreground">+{a.items.length - 8} 更多</span>}
                </div>
              )}
            </CardContent></Card>
          ))}
        </div>
      </section>
    </div>
  )
}
