import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import {
  getBdIdentity, decodeHtml, priorityColor, TIER_STYLES, SEGMENT_LABELS,
  TASK_TYPE_LABELS, recommendReason, replyGroupOf, REPLY_GROUP_LABELS, REPLY_GROUP_STYLES,
} from '@/lib/bd/shared'
import { completeTask, draftReply } from '@/actions/tasks'
import { snoozeTask, assignLeadToMe, createQuoteTask, createSampleTask, scheduleFollowup, closeReply, rejectLead } from '@/actions/bd'
import { generateReport } from '@/actions/reports'

export const dynamic = 'force-dynamic'

function fmtDue(d?: string | null): string {
  if (!d) return ''
  const t = new Date(d).getTime(); const now = Date.now()
  const overdue = t < now
  const days = Math.round(Math.abs(t - now) / 86400_000)
  return overdue ? `逾期 ${days}d` : days === 0 ? '今天' : `${days}d 后`
}

export default async function BdTodayPage() {
  const { who } = await getBdIdentity()
  const sb = await createClient()
  const nowIso = new Date().toISOString()
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
  const dayStartIso = dayStart.toISOString()
  const soonIso = new Date(Date.now() + 86400_000).toISOString()

  const [
    { data: urgentTasks },
    { data: pendingApprovals },
    { data: recos },
    { data: replies },
    { data: followups },
    { count: assignedCount },
    { count: sentCount },
    { count: replyCount },
    { count: overdueCount },
    { count: quoteCount },
    { count: sampleCount },
  ] = await Promise.all([
    sb.from('tasks').select('*, companies(name, customer_tier)')
      .in('status', ['open', 'in_progress'])
      .order('priority', { ascending: true }).order('due_at', { ascending: true }).limit(25),
    sb.from('outreach_logs').select('id, company_id, subject, created_at, companies(name)')
      .eq('status', 'pending_approval').order('created_at', { ascending: false }).limit(10),
    sb.from('companies').select('id, name, description, country, region, customer_tier, target_customer_segment, recommended_development_strategy, compliance_level, compliance_blockers, recommended_factory_type, next_action, product_match, assigned_to, status')
      .in('customer_tier', ['A', 'B']).neq('status', 'closed_lost').neq('status', 'closed_won')
      .order('customer_tier', { ascending: true }).order('total_score', { ascending: false }).limit(10),
    sb.from('reply_events').select('id, company_id, from_email, reply_subject, reply_body, reply_intent, reply_sentiment, received_at, companies(name)')
      .order('received_at', { ascending: false }).limit(12),
    sb.from('followup_runs').select('id, company_id, step, status, scheduled_for, companies(name, customer_tier)')
      .eq('status', 'scheduled').order('scheduled_for', { ascending: true }).limit(15),
    sb.from('companies').select('*', { count: 'exact', head: true }).eq('assigned_to', who),
    sb.from('outreach_logs').select('*', { count: 'exact', head: true }).eq('status', 'sent').gte('sent_at', dayStartIso),
    sb.from('reply_events').select('*', { count: 'exact', head: true }).gte('received_at', dayStartIso),
    sb.from('tasks').select('*', { count: 'exact', head: true }).in('status', ['open', 'in_progress']).lt('due_at', nowIso),
    sb.from('tasks').select('*', { count: 'exact', head: true }).eq('task_type', 'quote_followup').in('status', ['open', 'in_progress']),
    sb.from('tasks').select('*', { count: 'exact', head: true }).eq('task_type', 'sample_followup').in('status', ['open', 'in_progress']),
  ])

  const comp = (row: { companies?: unknown }) => {
    const c = row.companies as { name?: string; customer_tier?: string } | { name?: string }[] | null
    return Array.isArray(c) ? c[0] : c
  }

  // Best contact per recommended company (for the card).
  const recoIds = (recos ?? []).map((c) => c.id)
  const { data: recoContacts } = recoIds.length
    ? await sb.from('contacts').select('company_id, full_name, title, email, phone, linkedin_url, email_deliverable')
        .in('company_id', recoIds).order('contact_priority', { ascending: false })
    : { data: [] as Array<Record<string, unknown>> }
  const contactByCompany = new Map<string, Record<string, unknown>>()
  for (const ct of recoContacts ?? []) {
    const cid = ct.company_id as string
    if (cid && !contactByCompany.has(cid)) contactByCompany.set(cid, ct)
  }

  const kpis = [
    { label: '我的客户', value: assignedCount ?? 0 },
    { label: '今日已发送', value: sentCount ?? 0 },
    { label: '今日回复', value: replyCount ?? 0 },
    { label: '报价机会', value: quoteCount ?? 0 },
    { label: '样品机会', value: sampleCount ?? 0 },
    { label: '逾期任务', value: overdueCount ?? 0, warn: (overdueCount ?? 0) > 0 },
  ]

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">今日工作台</h1>
        <p className="text-sm text-muted-foreground mt-1">{who} · BD work desk</p>
      </div>

      {/* 今日数据 */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {kpis.map((k) => (
          <Card key={k.label}><CardContent className="py-3">
            <div className={`text-2xl font-bold ${k.warn ? 'text-red-600' : ''}`}>{k.value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{k.label}</div>
          </CardContent></Card>
        ))}
      </div>

      {/* 今日紧急任务 */}
      <section>
        <h2 className="text-sm font-semibold mb-2">今日紧急任务</h2>
        <div className="space-y-2">
          {(pendingApprovals ?? []).map((a) => {
            const c = comp(a)
            return (
              <Card key={`ap-${a.id}`} className="border-l-4 border-l-red-500"><CardContent className="py-3 flex items-center justify-between gap-3">
                <div>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 mr-2">待审批</span>
                  <span className="font-medium text-sm">{decodeHtml(c?.name ?? '客户')}</span>
                  <span className="text-xs text-muted-foreground ml-2">{a.subject ?? '草稿待审批'}</span>
                </div>
                <Link href="/approvals" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md">去处理</Link>
              </CardContent></Card>
            )
          })}
          {(urgentTasks ?? []).map((t) => {
            const c = comp(t)
            return (
              <Card key={t.id} className={`border-l-4 ${priorityColor(t.priority)}`}><CardContent className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px]">{TASK_TYPE_LABELS[t.task_type] ?? t.task_type}</Badge>
                    <span className="font-medium text-sm truncate">{t.title ?? decodeHtml(c?.name ?? '任务')}</span>
                    {t.due_at && <span className="text-[10px] text-muted-foreground">{fmtDue(t.due_at)}</span>}
                  </div>
                  {t.suggested_action && <p className="text-xs text-muted-foreground mt-0.5 truncate">→ {t.suggested_action}</p>}
                </div>
                <div className="flex gap-1.5 shrink-0">
                  {t.company_id && <Link href={`/companies/${t.company_id}`} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md whitespace-nowrap">立即处理</Link>}
                  <form action={snoozeTask}><input type="hidden" name="taskId" value={t.id} /><button className="text-xs px-2 py-1.5 border rounded-md">推迟</button></form>
                  <form action={completeTask}><input type="hidden" name="taskId" value={t.id} /><button className="text-xs px-2 py-1.5 border rounded-md">完成</button></form>
                </div>
              </CardContent></Card>
            )
          })}
          {(!urgentTasks?.length && !pendingApprovals?.length) && (
            <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">今天没有紧急任务 🎉 看看下方推荐客户。</CardContent></Card>
          )}
        </div>
      </section>

      {/* 今日推荐客户 */}
      <section>
        <h2 className="text-sm font-semibold mb-2">今日推荐客户</h2>
        <div className="grid md:grid-cols-2 gap-3">
          {(recos ?? []).map((c) => {
            const ct = contactByCompany.get(c.id)
            const hasContactWay = !!(ct?.email || ct?.phone || ct?.linkedin_url)
            const emailBad = ct?.email_deliverable === false
            return (
            <Card key={c.id}><CardContent className="py-3 space-y-2">
              {/* 1. 级别 + 客户名 */}
              <div className="flex items-center gap-2">
                {c.customer_tier && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TIER_STYLES[c.customer_tier]}`}>{c.customer_tier} 级</span>}
                <Link href={`/companies/${c.id}`} className="font-medium text-sm hover:underline truncate">{decodeHtml(c.name)}</Link>
                <span className="text-[10px] text-muted-foreground">{c.country ?? c.region ?? ''}</span>
                {c.target_customer_segment && <Badge variant="outline" className="text-[10px]">{SEGMENT_LABELS[c.target_customer_segment] ?? c.target_customer_segment}</Badge>}
              </div>
              {/* 2. 公司简介 */}
              {c.description && <p className="text-[11px] text-muted-foreground line-clamp-2">{decodeHtml(c.description as string)}</p>}
              {/* 3. 匹配分析 */}
              <p className="text-xs"><span className="text-muted-foreground">匹配分析：</span>{recommendReason(c)}</p>
              {Array.isArray(c.compliance_blockers) && c.compliance_blockers.length > 0 && (
                <p className="text-[11px] text-amber-700">⚠ {(c.compliance_blockers as string[])[0]}</p>
              )}
              {/* 4. 联系人 + 联系方式 */}
              <div className="text-[11px] border-t pt-1.5">
                {ct ? (
                  <div className="space-y-0.5">
                    <div><span className="text-muted-foreground">联系人：</span>{(ct.full_name as string) || '（仅职位）'} {ct.title ? `· ${ct.title}` : ''}</div>
                    <div className="flex gap-2 flex-wrap text-muted-foreground">
                      {ct.email ? <span className={emailBad ? 'text-red-600 line-through' : ''}>✉ {String(ct.email)}{emailBad ? '（已退信）' : ''}</span> : null}
                      {ct.phone ? <span>☎ {String(ct.phone)}</span> : null}
                      {ct.linkedin_url ? <a href={String(ct.linkedin_url)} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">LinkedIn</a> : null}
                    </div>
                    {(!hasContactWay || emailBad) && <p className="text-red-600">⚠ 联系方式缺失/有误 — 去客户页用 Apollo 查决策人</p>}
                  </div>
                ) : (
                  <p className="text-red-600">⚠ 暂无联系人/联系方式 — 去客户页「用 Apollo 查决策人」补全</p>
                )}
              </div>
              {/* 5. 下一步 */}
              {c.next_action && <p className="text-xs"><span className="text-muted-foreground">下一步：</span>{c.next_action}</p>}
              {/* 6. 操作 */}
              <div className="flex gap-1.5 flex-wrap pt-1">
                <Link href={`/companies/${c.id}/report`} className="text-xs px-2 py-1 border rounded-md">看报告</Link>
                <Link href={`/companies/${c.id}/outreach`} className="text-xs px-2 py-1 border rounded-md">生成开发信</Link>
                {c.assigned_to !== who && <form action={assignLeadToMe}><input type="hidden" name="companyId" value={c.id} /><button className="text-xs px-2 py-1 border rounded-md">分配给我</button></form>}
                <form action={rejectLead}><input type="hidden" name="companyId" value={c.id} /><button className="text-xs px-2 py-1 border rounded-md text-muted-foreground">放弃</button></form>
              </div>
            </CardContent></Card>
            )
          })}
          {!recos?.length && (
            <Card className="md:col-span-2"><CardContent className="py-6 text-sm text-muted-foreground text-center">
              暂无 A/B 级推荐客户。<Link href="/leads/discovery" className="text-primary hover:underline">去运行 Discovery 补充线索 →</Link>
            </CardContent></Card>
          )}
        </div>
      </section>

      {/* 客户回复箱 */}
      <section>
        <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">客户回复箱 <Link href="/bd/replies" className="text-xs text-primary hover:underline">全部 →</Link></h2>
        <div className="space-y-2">
          {(replies ?? []).slice(0, 6).map((r) => {
            const c = comp(r); const g = replyGroupOf(r.reply_intent, r.reply_sentiment)
            return (
              <Card key={r.id}><CardContent className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${REPLY_GROUP_STYLES[g]}`}>{REPLY_GROUP_LABELS[g]}</span>
                  <span className="font-medium text-sm">{decodeHtml(c?.name ?? r.from_email ?? '客户')}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{new Date(r.received_at).toLocaleDateString()}</span>
                </div>
                {r.reply_body && <p className="text-xs text-muted-foreground line-clamp-2">{decodeHtml(r.reply_body).slice(0, 180)}</p>}
                <div className="flex gap-1.5 flex-wrap mt-2">
                  <form action={draftReply}><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-md">AI 起草回复</button></form>
                  <form action={createQuoteTask}><input type="hidden" name="companyId" value={r.company_id ?? ''} /><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 border rounded-md">建报价任务</button></form>
                  <form action={createSampleTask}><input type="hidden" name="companyId" value={r.company_id ?? ''} /><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 border rounded-md">建样品任务</button></form>
                  <form action={closeReply}><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 border rounded-md text-muted-foreground">标记已处理</button></form>
                </div>
              </CardContent></Card>
            )
          })}
          {!replies?.length && <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">今天没有待处理回复。</CardContent></Card>}
        </div>
      </section>

      {/* 今日跟进 */}
      <section>
        <h2 className="text-sm font-semibold mb-2">今日跟进</h2>
        <div className="space-y-2">
          {(followups ?? []).map((f) => {
            const c = comp(f); const overdue = new Date(f.scheduled_for).getTime() < Date.now()
            return (
              <Card key={f.id} className={`border-l-4 ${overdue ? 'border-l-red-500' : 'border-l-gray-300'}`}><CardContent className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-medium">{decodeHtml(c?.name ?? '客户')}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">第 {f.step} 次跟进 · {fmtDue(f.scheduled_for)}</span>
                </div>
                {f.company_id && <Link href={`/companies/${f.company_id}`} className="text-xs px-3 py-1 border rounded-md">查看</Link>}
              </CardContent></Card>
            )
          })}
          {!followups?.length && <Card><CardContent className="py-6 text-sm text-muted-foreground text-center">今天没有到期的跟进。</CardContent></Card>}
        </div>
      </section>
    </div>
  )
}
