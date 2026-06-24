import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// 发件箱 — 只看真正发出去的邮件，回答一个问题：发了什么 · 真发还是模拟 · 对方回了没。
// 不再把草稿/待批/已发混在一起（那是旧 /outreach 的毛病），也不再用 created_at 冒充发送时间。
const SENT_STATUSES = ['sent', 'delivered', 'opened', 'replied', 'failed']
type Filter = 'all' | 'replied' | 'waiting' | 'failed'
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部已发' }, { key: 'replied', label: '✅ 已回复' },
  { key: 'waiting', label: '⏳ 等待回复' }, { key: 'failed', label: '❌ 失败' },
]

const ago = (iso: string | null) => {
  if (!iso) return '—'
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m}分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}小时前`
  return `${Math.floor(h / 24)}天前`
}
const SENTIMENT: Record<string, string> = {
  positive: '😊 正面', neutral: '😐 中性', negative: '😞 负面',
  interested: '🔥 有意向', not_interested: '🙅 无意向',
}

export default async function OutreachPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  const sp = await searchParams
  const filter: Filter = (['all', 'replied', 'waiting', 'failed'].includes(sp.f ?? '') ? sp.f : 'all') as Filter

  const sb = await createServiceClient()
  const { data: logs } = await sb
    .from('outreach_logs')
    .select('id, company_id, status, subject, body, sent_at, opened_at, replied_at, reply_content, reply_sentiment, reply_intent, gmail_message_id, executed_by, created_at, companies(id, name, grade, source_raw), contacts(full_name, email)')
    .in('status', SENT_STATUSES)
    .order('sent_at', { ascending: false, nullsFirst: false })
    .limit(100)

  const rows = (logs ?? []).map((d) => {
    const co = Array.isArray(d.companies) ? d.companies[0] : d.companies
    const c = Array.isArray(d.contacts) ? d.contacts[0] : d.contacts
    const mid = (d.gmail_message_id as string) || ''
    const replied = d.status === 'replied' || !!d.replied_at
    return {
      id: d.id as string, companyId: (d.company_id as string) || (co?.id as string) || '',
      brand: ((co?.source_raw as Record<string, unknown> | null)?.brand as string) || (co?.name as string) || '?',
      grade: (co?.grade as string) || '', contact: (c?.full_name as string) || '', email: (c?.email as string) || '',
      status: d.status as string, subject: (d.subject as string) || '(无主题)', body: (d.body as string) || '',
      sentAt: (d.sent_at as string) || null, openedAt: (d.opened_at as string) || null,
      real: mid !== '' && !mid.startsWith('sim_'), messageId: mid, sentBy: (d.executed_by as string) || '',
      replied, repliedAt: (d.replied_at as string) || null,
      replyText: (d.reply_content as string) || '', sentiment: (d.reply_sentiment as string) || '', intent: (d.reply_intent as string) || '',
      failed: d.status === 'failed',
    }
  })

  const real = rows.filter((r) => r.real).length
  const opened = rows.filter((r) => r.openedAt).length
  const replied = rows.filter((r) => r.replied).length
  const failed = rows.filter((r) => r.failed).length
  const replyRate = real > 0 ? Math.round((replied / real) * 100) : 0

  const view = rows.filter((r) =>
    filter === 'all' ? true : filter === 'replied' ? r.replied : filter === 'failed' ? r.failed : !r.replied && !r.failed,
  )
  const count = (f: Filter) => (f === 'all' ? rows.length : f === 'replied' ? replied : f === 'failed' ? failed : rows.length - replied - failed)

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-1">发件箱 · 已发邮件</h1>
      <p className="text-xs text-muted-foreground mb-3">只看真正发出去的。🟢 真实发出（邮件服务返回真实 message-id）/ 🟡 模拟（占位未发出）。核心看回复率。</p>

      {/* 汇总：回复率是北极星 */}
      <div className="flex flex-wrap gap-4 text-sm mb-4">
        <div><div className="text-xs text-muted-foreground">已发</div><div className="text-lg font-bold">{rows.length}</div></div>
        <div><div className="text-xs text-muted-foreground">🟢 真实发出</div><div className="text-lg font-bold">{real}</div></div>
        <div><div className="text-xs text-muted-foreground">👀 已打开</div><div className="text-lg font-bold">{opened}</div></div>
        <div><div className="text-xs text-muted-foreground">✅ 已回复</div><div className="text-lg font-bold text-purple-700">{replied}</div></div>
        <div><div className="text-xs text-muted-foreground">回复率</div><div className={`text-lg font-bold ${replyRate >= 15 ? 'text-green-700' : replyRate > 0 ? 'text-amber-700' : 'text-red-600'}`}>{replyRate}%</div></div>
      </div>

      {/* 过滤 */}
      <div className="flex gap-2 mb-4 text-xs">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/outreach?f=${f.key}`}
            className={`px-3 py-1 rounded-full border ${filter === f.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
            {f.label} {count(f.key)}
          </Link>
        ))}
      </div>

      {view.length === 0 ? (
        <p className="text-sm text-muted-foreground py-12 text-center">该分类下没有邮件。去 <Link href="/approve" className="text-primary hover:underline">批准发送</Link> 发出第一封。</p>
      ) : (
        <div className="space-y-3">
          {view.map((r) => (
            <div key={r.id} className={`rounded-lg border ${r.replied ? 'border-purple-300' : r.failed ? 'border-red-300' : r.real ? 'border-green-200' : 'border-amber-200'}`}>
              <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between gap-2 text-xs">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="shrink-0">{r.failed ? '🔴 失败' : r.replied ? '✅ 已回复' : r.real ? '🟢 已真实发出' : '🟡 模拟'}</span>
                  <Link href={`/companies/${r.companyId}`} className="font-semibold hover:underline truncate">{r.brand}</Link>
                  {r.grade && <span className="text-muted-foreground shrink-0">{r.grade}级</span>}
                </span>
                <span className="text-muted-foreground shrink-0" title={r.messageId ? `message-id: ${r.messageId}` : ''}>
                  {r.openedAt && '👀 '}发于 {ago(r.sentAt)}{r.sentBy && ` · ${r.sentBy}`}
                </span>
              </div>
              <div className="p-4 text-sm space-y-1.5">
                <div className="text-xs text-muted-foreground">收件人：{r.contact ? `${r.contact} <${r.email}>` : r.email || '—'}</div>
                <div><span className="text-muted-foreground">主题：</span>{r.subject}</div>
                {r.body && (
                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">查看正文 ▾</summary>
                    <pre className="mt-1 whitespace-pre-wrap font-sans text-xs text-muted-foreground border rounded-md p-2 bg-background max-h-44 overflow-y-auto">{r.body}</pre>
                  </details>
                )}
                {r.replied && (
                  <div className="mt-2 rounded-md border border-purple-200 bg-purple-50 p-2.5">
                    <div className="flex items-center gap-3 text-xs mb-1">
                      <span className="font-semibold text-purple-800">✅ 对方已回复 · {ago(r.repliedAt)}</span>
                      {r.sentiment && <span>{SENTIMENT[r.sentiment] ?? r.sentiment}</span>}
                      {r.intent && <span className="text-muted-foreground">意图：{r.intent}</span>}
                    </div>
                    {r.replyText && <p className="text-xs text-foreground/80 line-clamp-3 whitespace-pre-wrap">{r.replyText.slice(0, 240)}</p>}
                    <Link href={`/companies/${r.companyId}`} className="inline-block mt-1.5 text-xs px-2.5 py-1 rounded bg-purple-700 text-white hover:bg-purple-800">去跟进 →</Link>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {rows.length >= 100 && <p className="text-[11px] text-muted-foreground mt-3">仅显示最近 100 封。</p>}
    </div>
  )
}
