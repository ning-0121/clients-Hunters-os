import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import {
  decodeHtml, replyGroupOf, REPLY_GROUP_ORDER, REPLY_GROUP_LABELS, REPLY_GROUP_STYLES, type ReplyGroup,
} from '@/lib/bd/shared'
import { draftReply } from '@/actions/tasks'
import { createQuoteTask, createSampleTask, closeReply, assignReplyToManager } from '@/actions/bd'
import { reprocessReplies } from '@/actions/reply-reprocess'

export const dynamic = 'force-dynamic'

export default async function BdRepliesPage() {
  const sb = await createClient()
  const { data: replies } = await sb.from('reply_events')
    .select('id, company_id, from_email, reply_subject, reply_body, reply_intent, reply_sentiment, received_at, outreach_log_id, companies(name), contacts(full_name, title)')
    .order('received_at', { ascending: false }).limit(80)

  // System emails (bounce / auto-reply / unsubscribe) are NOT customer replies —
  // keep them out of the actionable inbox (no action buttons, no raw MIME body).
  const SYSTEM_INTENTS = new Set(['bounce', 'auto_reply', 'unsubscribe'])
  const all = replies ?? []
  const systemCount = all.filter((r) => SYSTEM_INTENTS.has(String(r.reply_intent))).length
  const actionable = all.filter((r) => !SYSTEM_INTENTS.has(String(r.reply_intent)))

  const grouped: Record<ReplyGroup, NonNullable<typeof replies>> = {
    wants_quote: [], wants_sample: [], wants_catalog: [], wants_meeting: [], positive: [], unclear: [], not_interested: [],
  }
  for (const r of actionable) grouped[replyGroupOf(r.reply_intent, r.reply_sentiment)].push(r)
  const total = actionable.length
  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { name?: string; full_name?: string; title?: string } | null

  return (
    <div className="p-6 max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">回复收件箱</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} 条客户回复 · 按 AI 意图分组 · 不会自动发送
            {systemCount > 0 && <span className="ml-1">（已自动过滤 {systemCount} 封系统邮件：退信/自动回复/退订）</span>}
          </p>
        </div>
        <form action={reprocessReplies}>
          <button className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent shrink-0">重新识别历史回复</button>
        </form>
      </div>

      {total === 0 && <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">暂无客户回复。发送开发信后，回复会自动归类到这里。</CardContent></Card>}

      {REPLY_GROUP_ORDER.filter((g) => grouped[g].length > 0).map((g) => (
        <section key={g}>
          <h2 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${REPLY_GROUP_STYLES[g]}`}>{REPLY_GROUP_LABELS[g]}</span>
            <span className="text-xs text-muted-foreground">{grouped[g].length}</span>
          </h2>
          <div className="space-y-2">
            {grouped[g].map((r) => {
              const c = one(r.companies); const ct = one(r.contacts)
              return (
                <Card key={r.id}><CardContent className="py-3">
                  <div className="flex items-center gap-2 mb-1">
                    {r.company_id
                      ? <Link href={`/companies/${r.company_id}`} className="font-medium text-sm hover:underline">{decodeHtml(c?.name ?? r.from_email ?? '客户')}</Link>
                      : <span className="font-medium text-sm">{r.from_email ?? '客户'}</span>}
                    {ct?.full_name && <span className="text-[11px] text-muted-foreground">{ct.full_name}{ct.title ? ` · ${ct.title}` : ''}</span>}
                    <span className="text-[10px] text-muted-foreground ml-auto">{new Date(r.received_at).toLocaleString()}</span>
                  </div>
                  {r.reply_subject && <p className="text-xs font-medium">{decodeHtml(r.reply_subject)}</p>}
                  {r.reply_body && <p className="text-xs text-muted-foreground line-clamp-3 mt-0.5">{decodeHtml(r.reply_body).slice(0, 400)}</p>}
                  <div className="text-[10px] text-muted-foreground mt-1">意图: {r.reply_intent ?? '—'} · 情绪: {r.reply_sentiment ?? '—'}</div>
                  <div className="flex gap-1.5 flex-wrap mt-2">
                    <form action={draftReply}><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 bg-primary text-primary-foreground rounded-md">AI 起草回复</button></form>
                    <form action={createQuoteTask}><input type="hidden" name="companyId" value={r.company_id ?? ''} /><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 border rounded-md">建报价任务</button></form>
                    <form action={createSampleTask}><input type="hidden" name="companyId" value={r.company_id ?? ''} /><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 border rounded-md">建样品任务</button></form>
                    <form action={assignReplyToManager}><input type="hidden" name="replyEventId" value={r.id} /><input type="hidden" name="companyId" value={r.company_id ?? ''} /><button className="text-xs px-2 py-1 border rounded-md">升级给经理</button></form>
                    <form action={closeReply}><input type="hidden" name="replyEventId" value={r.id} /><button className="text-xs px-2 py-1 border rounded-md text-muted-foreground">关闭</button></form>
                  </div>
                </CardContent></Card>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}
