import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'

// ── Tiny stat card ────────────────────────────────────────────────────────────
function Stat({ label, value, sub, color = '' }: {
  label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="text-sm text-muted-foreground mt-0.5">{label}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  )
}

// ── Funnel bar ────────────────────────────────────────────────────────────────
function FunnelBar({ label, count, total, color }: {
  label: string; count: number; total: number; color: string
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-24 text-xs text-muted-foreground text-right shrink-0">{label}</div>
      <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
        <div className={`h-5 rounded-full flex items-center px-2 ${color} text-white text-xs font-medium`}
          style={{ width: `${Math.max(pct, 4)}%`, minWidth: '2rem' }}>
          {count}
        </div>
      </div>
      <div className="text-xs text-muted-foreground w-10 text-right">{pct}%</div>
    </div>
  )
}

// ── Trigger icon ──────────────────────────────────────────────────────────────
const triggerIcon: Record<string, string> = {
  hiring:       '💼',
  funding:      '💰',
  sustainability: '🌱',
  new_product:  '🆕',
  press:        '📰',
  scaling:      '📈',
}

const triggerLabel: Record<string, string> = {
  hiring:         '招聘',
  funding:        '融资',
  sustainability: '可持续发展',
  new_product:    '新产品',
  press:          '媒体报道',
  scaling:        '业务扩张',
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>
}) {
  const params = await searchParams
  const window = params.window ?? '7d'

  const supabase = await createServiceClient()

  const windowMs: Record<string, number> = {
    today: 0,
    '7d':  7 * 86_400_000,
    '30d': 30 * 86_400_000,
  }
  const since = window === 'today'
    ? (() => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString() })()
    : new Date(Date.now() - (windowMs[window] ?? windowMs['7d'])).toISOString()

  // ── Queries ────────────────────────────────────────────────────────────────
  const [
    { count: emailsSent },
    { count: emailsThisWindow },
    { count: repliesTotal },
    { count: repliesThisWindow },
    { data: replyBreakdown },
    { data: pipeline },
    { data: gradeBreakdown },
    { data: recentReplies },
    { count: followupsScheduled },
    { count: followupsSent },
    { count: conversationsActive },
    { count: qualifiedCount },
    { count: meetingsCount },
    { data: triggerPerf },
    { data: intentBreakdown },
  ] = await Promise.all([
    supabase.from('outreach_logs').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
    supabase.from('outreach_logs').select('id', { count: 'exact', head: true })
      .eq('status', 'sent').gte('sent_at', since),
    supabase.from('reply_events').select('id', { count: 'exact', head: true }),
    supabase.from('reply_events').select('id', { count: 'exact', head: true }).gte('received_at', since),
    supabase.from('reply_events').select('reply_sentiment'),
    supabase.from('companies').select('status'),
    supabase.from('companies').select('grade').not('grade', 'is', null),
    supabase.from('reply_events')
      .select('from_email, reply_subject, reply_sentiment, reply_intent, received_at, company_id, companies(name)')
      .order('received_at', { ascending: false })
      .limit(10),
    supabase.from('followup_runs').select('id', { count: 'exact', head: true }).eq('status', 'scheduled'),
    supabase.from('followup_runs').select('id', { count: 'exact', head: true })
      .in('status', ['sent', 'replied']),
    supabase.from('conversations').select('id', { count: 'exact', head: true })
      .in('status', ['active', 'replied']),
    supabase.from('companies').select('id', { count: 'exact', head: true }).eq('status', 'qualified'),
    supabase.from('meetings').select('id', { count: 'exact', head: true }),
    // Trigger performance: companies with trigger_type → count replies
    supabase.from('companies')
      .select('trigger_type, status')
      .not('trigger_type', 'is', null),
    supabase.from('reply_events').select('reply_intent'),
  ])

  // Pipeline funnel
  const statusCounts: Record<string, number> = {}
  for (const c of pipeline ?? []) statusCounts[c.status] = (statusCounts[c.status] ?? 0) + 1
  const totalCompanies = Object.values(statusCounts).reduce((a, b) => a + b, 0)

  // Grade breakdown
  const gradeCounts: Record<string, number> = {}
  for (const c of gradeBreakdown ?? []) gradeCounts[c.grade] = (gradeCounts[c.grade] ?? 0) + 1

  // Reply rate
  const replyRate = (emailsSent ?? 0) > 0
    ? ((repliesTotal ?? 0) / (emailsSent ?? 1) * 100).toFixed(1)
    : '0'

  // Sentiment breakdown
  const sentimentMap: Record<string, number> = {}
  for (const r of replyBreakdown ?? []) {
    const s = r.reply_sentiment ?? 'unknown'
    sentimentMap[s] = (sentimentMap[s] ?? 0) + 1
  }

  // Intent breakdown
  const intentMap: Record<string, number> = {}
  for (const r of intentBreakdown ?? []) {
    const i = r.reply_intent ?? 'unknown'
    intentMap[i] = (intentMap[i] ?? 0) + 1
  }

  // Trigger performance: count companies per trigger_type, and what % reached 'engaged'/'qualified'
  const triggerStats: Record<string, { total: number; engaged: number }> = {}
  for (const co of triggerPerf ?? []) {
    const t = co.trigger_type as string
    if (!triggerStats[t]) triggerStats[t] = { total: 0, engaged: 0 }
    triggerStats[t].total++
    if (co.status === 'engaged' || co.status === 'qualified' || co.status === 'closed_won') {
      triggerStats[t].engaged++
    }
  }
  const triggerRows = Object.entries(triggerStats)
    .sort((a, b) => b[1].total - a[1].total)

  const sentimentColor: Record<string, string> = {
    positive:       'text-green-600',
    neutral:        'text-yellow-600',
    negative:       'text-red-600',
    not_interested: 'text-gray-500',
  }

  const intentColor: Record<string, string> = {
    want_meeting:   'text-green-700',
    want_quote:     'text-blue-700',
    want_sample:    'text-indigo-700',
    want_catalog:   'text-teal-600',
    general_reply:  'text-muted-foreground',
    not_interested: 'text-gray-500',
    wrong_person:   'text-gray-400',
  }

  const windowLabel: Record<string, string> = { today: '今天', '7d': '近 7 天', '30d': '近 30 天' }

  const sentimentLabel: Record<string, string> = {
    positive:       '积极',
    neutral:        '中性',
    negative:       '消极',
    not_interested: '不感兴趣',
    unknown:        '未知',
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header + Window Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">数据分析</h1>
          <p className="text-sm text-muted-foreground mt-1">完整漏斗 · 线索发现 → 开发信 → 回复 → 商机</p>
        </div>
        <div className="flex gap-1 rounded-lg border p-1 bg-muted/40">
          {['today', '7d', '30d'].map(w => (
            <Link
              key={w}
              href={`/analytics?window=${w}`}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors font-medium ${
                window === w ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {windowLabel[w]}
            </Link>
          ))}
        </div>
      </div>

      {/* Top Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label={`已发送邮件（${windowLabel[window]}）`} value={emailsThisWindow ?? 0}
          sub={`累计 ${emailsSent ?? 0} 封`} color="text-blue-600" />
        <Stat label="回复率（累计）" value={`${replyRate}%`}
          sub={`共计 ${repliesTotal ?? 0} 条回复`}
          color={(repliesTotal ?? 0) > 0 ? 'text-green-600' : ''} />
        <Stat label="有意向线索" value={qualifiedCount ?? 0}
          sub="想要会议 / 样品 / 报价" color={(qualifiedCount ?? 0) > 0 ? 'text-indigo-600' : ''} />
        <Stat label="会议" value={meetingsCount ?? 0}
          sub={`${conversationsActive ?? 0} 个进行中的对话`}
          color={(meetingsCount ?? 0) > 0 ? 'text-emerald-600' : ''} />
      </div>

      {/* Pipeline Funnel */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">销售漏斗</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            共计 {totalCompanies} 家客户公司 · 各阶段转化
          </p>
        </div>
        <div className="px-5 py-5 space-y-3">
          {[
            { label: '待富集',   key: 'raw',        color: 'bg-orange-400' },
            { label: '已富集',   key: 'enriched',   color: 'bg-blue-400'   },
            { label: '已评分',   key: 'scored',     color: 'bg-purple-400' },
            { label: '开发中',   key: 'outreach',   color: 'bg-green-400'  },
            { label: '互动中',   key: 'engaged',    color: 'bg-teal-400'   },
            { label: '有意向',   key: 'qualified',  color: 'bg-indigo-500' },
            { label: '已成交',   key: 'closed_won', color: 'bg-emerald-600' },
          ].map(row => (
            <FunnelBar
              key={row.key}
              label={row.label}
              count={statusCounts[row.key] ?? 0}
              total={totalCompanies}
              color={row.color}
            />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Grade Distribution */}
        <div className="rounded-lg border divide-y">
          <div className="px-5 py-3 bg-muted/40">
            <h2 className="font-semibold text-sm">线索质量（按评级）</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {[
              { grade: 'A', label: 'A 级 — 高优先级', color: 'bg-green-500' },
              { grade: 'B', label: 'B 级 — 较匹配',   color: 'bg-blue-500'  },
              { grade: 'C', label: 'C 级 — 一般',     color: 'bg-yellow-500'},
              { grade: 'D', label: 'D 级 — 低优先级', color: 'bg-gray-400'  },
            ].map(row => {
              const count = gradeCounts[row.grade] ?? 0
              const total = Object.values(gradeCounts).reduce((a, b) => a + b, 0)
              const pct   = total > 0 ? Math.round(count / total * 100) : 0
              return (
                <div key={row.grade} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{row.label}</span>
                    <span className="font-mono">{count}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-2">
                    <div className={`h-2 rounded-full ${row.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Reply Sentiment */}
        <div className="rounded-lg border divide-y">
          <div className="px-5 py-3 bg-muted/40">
            <h2 className="font-semibold text-sm">回复情绪</h2>
          </div>
          <div className="px-5 py-4">
            {(repliesTotal ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">暂无回复</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(sentimentMap).map(([s, count]) => (
                  <div key={s} className="flex items-center justify-between">
                    <span className={`text-sm capitalize ${sentimentColor[s] ?? ''}`}>
                      {sentimentLabel[s] ?? s.replace('_', ' ')}
                    </span>
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-muted rounded-full h-2">
                        <div className="h-2 rounded-full bg-current"
                          style={{ width: `${Math.round(count / (repliesTotal ?? 1) * 100)}%` }} />
                      </div>
                      <span className="text-xs font-mono w-6 text-right">{count}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Reply Intent */}
      {(repliesTotal ?? 0) > 0 && (
        <div className="rounded-lg border divide-y">
          <div className="px-5 py-3 bg-muted/40">
            <h2 className="font-semibold text-sm">回复意图分布</h2>
            <p className="text-xs text-muted-foreground mt-0.5">潜在客户的诉求</p>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { key: 'want_meeting', label: '想要会议' },
              { key: 'want_quote',   label: '想要报价' },
              { key: 'want_sample',  label: '想要样品' },
              { key: 'want_catalog', label: '想要目录' },
            ].map(({ key, label }) => (
              <div key={key} className="text-center">
                <div className={`text-2xl font-bold ${intentColor[key]}`}>
                  {intentMap[key] ?? 0}
                </div>
                <div className="text-xs text-muted-foreground mt-1">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trigger Performance */}
      {triggerRows.length > 0 && (
        <div className="rounded-lg border divide-y">
          <div className="px-5 py-3 bg-muted/40">
            <h2 className="font-semibold text-sm">触发信号表现</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              哪些采购信号带来最多互动
            </p>
          </div>
          <div className="divide-y">
            {triggerRows.map(([trigType, stats]) => {
              const pct = stats.total > 0 ? Math.round((stats.engaged / stats.total) * 100) : 0
              return (
                <div key={trigType} className="px-5 py-3 flex items-center gap-4">
                  <span className="text-lg w-7 shrink-0">{triggerIcon[trigType] ?? '📊'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium capitalize">{triggerLabel[trigType] ?? trigType.replace('_', ' ')}</span>
                      <span className="text-xs text-muted-foreground">{stats.total} 条线索</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div className="h-2 rounded-full bg-teal-500 transition-all"
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="w-16 text-right shrink-0">
                    <div className={`text-sm font-bold ${pct > 0 ? 'text-teal-600' : 'text-muted-foreground'}`}>
                      {pct}%
                    </div>
                    <div className="text-xs text-muted-foreground">互动率</div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Follow-up Sequence Stats */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">跟进序列</h2>
        </div>
        <div className="px-5 py-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-orange-600">{followupsScheduled ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">已排期</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">{followupsSent ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">已发送 / 已完成</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {(followupsSent ?? 0) > 0 && (repliesTotal ?? 0) > 0
                ? `${Math.round(((repliesTotal ?? 0) / (followupsSent ?? 1)) * 100)}%`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">回复率</div>
          </div>
        </div>
      </div>

      {/* Recent Replies */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40 flex justify-between items-center">
          <h2 className="font-semibold text-sm">最近回复</h2>
          <span className="text-xs text-muted-foreground">共计 {repliesTotal ?? 0} 条</span>
        </div>
        {(recentReplies ?? []).length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            暂无回复 — 系统每 5 分钟通过 Gmail IMAP 自动检测
          </div>
        ) : (
          (recentReplies ?? []).map((r, idx) => {
            const co = Array.isArray(r.companies) ? r.companies[0] : r.companies
            const sentimentStyle: Record<string, string> = {
              positive:       'bg-green-100 text-green-800',
              neutral:        'bg-yellow-100 text-yellow-800',
              not_interested: 'bg-gray-100 text-gray-600',
              negative:       'bg-red-100 text-red-800',
            }
            const intentLabel: Record<string, string> = {
              want_meeting:   '📅 想要会议',
              want_quote:     '💲 想要报价',
              want_sample:    '📦 想要样品',
              want_catalog:   '📋 想要目录',
              general_reply:  '💬 一般回复',
              not_interested: '🚫 退订',
              wrong_person:   '👤 找错人',
            }
            return (
              <div key={idx} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">
                      {(co as { name?: string } | null)?.name ?? r.from_email}
                    </span>
                    {r.reply_sentiment && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${sentimentStyle[r.reply_sentiment] ?? 'bg-muted'}`}>
                        {sentimentLabel[r.reply_sentiment] ?? r.reply_sentiment.replace('_', ' ')}
                      </span>
                    )}
                    {r.reply_intent && r.reply_intent !== 'general_reply' && (
                      <span className="text-xs text-muted-foreground">
                        {intentLabel[r.reply_intent] ?? r.reply_intent}
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5 truncate">{r.reply_subject}</div>
                </div>
                <div className="text-xs text-muted-foreground shrink-0">
                  {r.received_at ? new Date(r.received_at).toLocaleDateString() : '—'}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
