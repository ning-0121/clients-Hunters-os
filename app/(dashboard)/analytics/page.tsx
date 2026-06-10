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

  const windowLabel: Record<string, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days' }

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header + Window Toggle */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground mt-1">Full funnel · Discovery → Outreach → Reply → Opportunity</p>
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
        <Stat label={`Emails Sent (${windowLabel[window]})`} value={emailsThisWindow ?? 0}
          sub={`${emailsSent ?? 0} all time`} color="text-blue-600" />
        <Stat label="Reply Rate (all time)" value={`${replyRate}%`}
          sub={`${repliesTotal ?? 0} total replies`}
          color={(repliesTotal ?? 0) > 0 ? 'text-green-600' : ''} />
        <Stat label="Qualified Leads" value={qualifiedCount ?? 0}
          sub="want meeting / sample / quote" color={(qualifiedCount ?? 0) > 0 ? 'text-indigo-600' : ''} />
        <Stat label="Meetings" value={meetingsCount ?? 0}
          sub={`${conversationsActive ?? 0} open conversations`}
          color={(meetingsCount ?? 0) > 0 ? 'text-emerald-600' : ''} />
      </div>

      {/* Pipeline Funnel */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40">
          <h2 className="font-semibold text-sm">Pipeline Funnel</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {totalCompanies} total companies · stage conversion
          </p>
        </div>
        <div className="px-5 py-5 space-y-3">
          {[
            { label: 'Raw',       key: 'raw',        color: 'bg-orange-400' },
            { label: 'Enriched',  key: 'enriched',   color: 'bg-blue-400'   },
            { label: 'Scored',    key: 'scored',     color: 'bg-purple-400' },
            { label: 'Outreach',  key: 'outreach',   color: 'bg-green-400'  },
            { label: 'Engaged',   key: 'engaged',    color: 'bg-teal-400'   },
            { label: 'Qualified', key: 'qualified',  color: 'bg-indigo-500' },
            { label: 'Won',       key: 'closed_won', color: 'bg-emerald-600' },
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
            <h2 className="font-semibold text-sm">Lead Quality (by Grade)</h2>
          </div>
          <div className="px-5 py-4 space-y-3">
            {[
              { grade: 'A', label: 'Grade A — High priority', color: 'bg-green-500' },
              { grade: 'B', label: 'Grade B — Good fit',      color: 'bg-blue-500'  },
              { grade: 'C', label: 'Grade C — Average',       color: 'bg-yellow-500'},
              { grade: 'D', label: 'Grade D — Low priority',  color: 'bg-gray-400'  },
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
            <h2 className="font-semibold text-sm">Reply Sentiment</h2>
          </div>
          <div className="px-5 py-4">
            {(repliesTotal ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No replies yet</p>
            ) : (
              <div className="space-y-3">
                {Object.entries(sentimentMap).map(([s, count]) => (
                  <div key={s} className="flex items-center justify-between">
                    <span className={`text-sm capitalize ${sentimentColor[s] ?? ''}`}>
                      {s.replace('_', ' ')}
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
            <h2 className="font-semibold text-sm">Reply Intent Breakdown</h2>
            <p className="text-xs text-muted-foreground mt-0.5">What prospects are asking for</p>
          </div>
          <div className="px-5 py-4 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { key: 'want_meeting', label: 'Want Meeting' },
              { key: 'want_quote',   label: 'Want Quote' },
              { key: 'want_sample',  label: 'Want Sample' },
              { key: 'want_catalog', label: 'Want Catalog' },
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
            <h2 className="font-semibold text-sm">Trigger Performance</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Which buying signals lead to the most engagement
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
                      <span className="text-sm font-medium capitalize">{trigType.replace('_', ' ')}</span>
                      <span className="text-xs text-muted-foreground">{stats.total} leads</span>
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
                    <div className="text-xs text-muted-foreground">engaged</div>
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
          <h2 className="font-semibold text-sm">Follow-up Sequence</h2>
        </div>
        <div className="px-5 py-4 grid grid-cols-3 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-orange-600">{followupsScheduled ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Scheduled</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-blue-600">{followupsSent ?? 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Sent / Completed</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-green-600">
              {(followupsSent ?? 0) > 0 && (repliesTotal ?? 0) > 0
                ? `${Math.round(((repliesTotal ?? 0) / (followupsSent ?? 1)) * 100)}%`
                : '—'}
            </div>
            <div className="text-xs text-muted-foreground mt-1">Reply Rate</div>
          </div>
        </div>
      </div>

      {/* Recent Replies */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40 flex justify-between items-center">
          <h2 className="font-semibold text-sm">Recent Replies</h2>
          <span className="text-xs text-muted-foreground">{repliesTotal ?? 0} total</span>
        </div>
        {(recentReplies ?? []).length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No replies yet — detected automatically via Gmail IMAP every 5 minutes
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
              want_meeting:   '📅 Meeting',
              want_quote:     '💲 Quote',
              want_sample:    '📦 Sample',
              want_catalog:   '📋 Catalog',
              general_reply:  '💬 Reply',
              not_interested: '🚫 Opt-out',
              wrong_person:   '👤 Wrong person',
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
                        {r.reply_sentiment.replace('_', ' ')}
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
