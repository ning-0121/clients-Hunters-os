import { createServiceClient as createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { triggerScoreCompany, triggerEnrichCompany, triggerDraftOutreach } from '@/actions/companies'
import { triggerTierCompany } from '@/actions/tiering'
import { triggerCustomsLookup, saveCustomsNotes } from '@/actions/customs'
import { triggerApolloLookup } from '@/actions/apollo'
import { generateReport, createOutreachDraftFromReport, createTaskFromReport } from '@/actions/reports'
import { createSample } from '@/actions/samples'
import { createOrder, confirmOrder } from '@/actions/orders'
import {
  TIER_LABELS, COMPLIANCE_LABELS, FACTORY_TYPE_LABELS,
  type CustomerTier, type ComplianceLevel, type RecommendedFactoryType,
} from '@/lib/tiering/tiering'
import { recommendFactoryForCompany } from '@/lib/factory/recommend'
import { FACTORY_DECISION_LABELS } from '@/lib/factory/matcher'

const TIER_STYLES: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800 border-purple-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

const MATCH_STYLES: Record<string, string> = {
  High:   'bg-green-100 text-green-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low:    'bg-gray-100 text-gray-500',
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1))))
    .trim()
}

const STATUS_LABELS: Record<string, string> = {
  raw: '待富集', enriched: '已富集', scored: '已评分', outreach: '开发中',
  engaged: '互动中', qualified: '有意向', closed_won: '已成交', closed_lost: '已流失', dormant: '沉睡',
}

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-blue-100 text-blue-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-gray-100 text-gray-500',
}

const SCORE_DIMS = [
  { key: 'icp_fit_score',           label: '画像匹配' },
  { key: 'profit_potential_score',  label: '利润潜力' },
  { key: 'reply_probability_score', label: '回复概率' },
  { key: 'category_match_score',    label: '品类匹配' },
  { key: 'size_score',              label: '公司规模' },
  { key: 'ltv_potential_score',     label: '长期价值' },
  { key: 'white_label_fit',         label: '白标适配' },
  { key: 'tiktok_fit',              label: 'TikTok 适配' },
  { key: 'latam_priority',          label: '拉美优先' },
]

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const [
    { data: company },
    { data: contacts },
    { data: score },
    { data: outreachLogs },
    { data: replyEvents },
    { data: samples },
    { data: orders },
    { data: latestReport },
    { count: pendingJobs },
  ] = await Promise.all([
    supabase.from('companies').select('*').eq('id', id).single(),
    supabase.from('contacts').select('*').eq('company_id', id).order('contact_priority', { ascending: false }),
    supabase.from('customer_scores').select('*').eq('company_id', id).single(),
    supabase.from('outreach_logs').select('*').eq('company_id', id).order('created_at', { ascending: false }).limit(20),
    supabase.from('reply_events').select('*').eq('company_id', id).order('received_at', { ascending: false }).limit(20),
    supabase.from('samples').select('*').eq('company_id', id).order('created_at', { ascending: false }),
    supabase.from('orders').select('*').eq('company_id', id).order('created_at', { ascending: false }),
    supabase.from('customer_intelligence_reports').select('id, report_version, report_depth, created_at')
      .eq('company_id', id).order('report_version', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('agent_queue').select('*', { count: 'exact', head: true })
      .filter('payload->>companyId', 'eq', id).in('status', ['waiting', 'active']),
  ])

  if (!company) notFound()

  // Deterministic factory recommendation (own vs partner vs not-ready) — not LLM.
  const factoryMatch = company.customer_tier
    ? await recommendFactoryForCompany(company).catch(() => null)
    : null

  // Build a merged, chronological conversation thread (outbound + inbound)
  type ThreadItem = { ts: number; dir: 'out' | 'in'; subject?: string; body?: string; meta?: string }
  const thread: ThreadItem[] = []
  for (const log of outreachLogs ?? []) {
    if (log.status === 'sent' || log.direction === 'outbound') {
      thread.push({
        ts: new Date(log.sent_at ?? log.created_at).getTime(),
        dir: 'out',
        subject: log.subject ?? undefined,
        body: log.body ?? undefined,
        meta: log.status,
      })
    }
  }
  for (const re of replyEvents ?? []) {
    thread.push({
      ts: new Date(re.received_at).getTime(),
      dir: 'in',
      subject: re.reply_subject ?? undefined,
      body: re.reply_body ?? undefined,
      meta: `${re.reply_sentiment ?? ''} · ${re.reply_intent ?? ''}`,
    })
  }
  thread.sort((a, b) => a.ts - b.ts)

  const firstContact = contacts?.[0]
  const canSample = ['outreach', 'engaged', 'qualified'].includes(company.status)
  const canOrder  = ['qualified', 'closed_won'].includes(company.status)
  const approvedSample = samples?.find((s) => s.status === 'approved')

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{decodeHtml(company.name)}</h1>
            {company.grade && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full ${GRADE_STYLES[company.grade]}`}>
                评级 {company.grade}
              </span>
            )}
            {company.customer_tier && (
              <span className={`text-sm font-bold px-3 py-1 rounded-full border ${TIER_STYLES[company.customer_tier]}`}>
                {company.customer_tier} 级客户
              </span>
            )}
            {company.total_score && (
              <span className="text-sm text-muted-foreground font-mono">
                总分 {company.total_score.toFixed(0)}/100
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            {company.website && (
              <a href={company.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                {company.domain}
              </a>
            )}
            {company.country && <span>{company.country}</span>}
            <Badge variant="outline" className="text-xs">{STATUS_LABELS[company.status] ?? company.status}</Badge>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 flex-wrap items-center">
          {(pendingJobs ?? 0) > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              <span className="animate-pulse h-1.5 w-1.5 rounded-full bg-blue-500 inline-block" />
              后台处理中 · {pendingJobs}
            </span>
          )}
          {company.status === 'raw' && (
            <form action={triggerEnrichCompany}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
                富集信息
              </button>
            </form>
          )}
          {company.status === 'enriched' && (
            <form action={triggerScoreCompany}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
                评分
              </button>
            </form>
          )}
          {company.status === 'scored' && !outreachLogs?.length && (
            <form action={triggerDraftOutreach}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
                起草开发信
              </button>
            </form>
          )}
          <form action={triggerTierCompany}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
              {company.customer_tier ? '重新分级' : '客户分级'}
            </button>
          </form>
          <form action={generateReport}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
              {latestReport ? '重新生成报告' : '生成客户报告'}
            </button>
          </form>
          {latestReport && (
            <>
              <Link href={`/companies/${id}/report`} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
                查看报告
              </Link>
              <form action={createOutreachDraftFromReport}>
                <input type="hidden" name="companyId" value={id} />
                <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
                  从报告生成开发信
                </button>
              </form>
            </>
          )}
          <Link href={`/companies/${id}/outreach`} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
            开发信工作台
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Left column: Company Info */}
        <div className="col-span-2 space-y-4">

          {/* Customer Tier & Development Strategy */}
          {company.customer_tier ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${TIER_STYLES[company.customer_tier]}`}>
                    {TIER_LABELS[company.customer_tier as CustomerTier] ?? company.customer_tier}
                  </span>
                  客户分级
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {company.tier_reasoning && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">为什么是这个级别：</span>
                    <span className="text-xs">{company.tier_reasoning}</span>
                  </div>
                )}
                {company.recommended_development_strategy && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">最佳开发策略：</span>
                    <span className="text-xs">{company.recommended_development_strategy}</span>
                  </div>
                )}
                {company.target_customer_segment && (
                  <div>
                    <span className="text-xs font-medium text-muted-foreground">细分定位：</span>
                    <span className="text-xs">{company.target_customer_segment}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {[
                    ['客户规模', company.customer_scale_score],
                    ['产品匹配', company.product_match_score],
                    ['转化可行性', company.conversion_feasibility_score],
                    ['战略价值', company.strategic_value_score],
                    ['付款风险', company.payment_risk_score],
                  ].map(([label, val]) => (val !== null && val !== undefined) ? (
                    <div key={label as string} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground w-24 shrink-0">{label}</span>
                      <div className="flex-1 bg-muted rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(Number(val) / 10) * 100}%` }} />
                      </div>
                      <span className="text-[11px] font-mono w-6 text-right">{Number(val).toFixed(0)}</span>
                    </div>
                  ) : null)}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                尚未分级。点击「客户分级」评估业务可行性（规模、产品匹配、合规、转化、战略价值）。
              </CardContent>
            </Card>
          )}

          {/* Product Match */}
          {Array.isArray(company.product_match) && company.product_match.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">与 QIMO 产品匹配</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {(company.product_match as { category: string; level: string; suggested_sku?: string; reason?: string }[]).map((p, i) => (
                  <div key={i} className="flex items-start gap-2 text-xs border-b last:border-0 pb-2 last:pb-0">
                    <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${MATCH_STYLES[p.level] ?? 'bg-muted'}`}>{p.level}</span>
                    <div>
                      <span className="font-medium">{p.category}</span>
                      {p.suggested_sku && <span className="text-muted-foreground"> → {p.suggested_sku}</span>}
                      {p.reason && <p className="text-muted-foreground mt-0.5">{p.reason}</p>}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Compliance Blockers & Factory Matching */}
          {company.customer_tier && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">合规与工厂匹配</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-xs">
                {company.compliance_level && (
                  <div>
                    <span className="text-muted-foreground">合规要求：</span>
                    <span className="font-medium">{COMPLIANCE_LABELS[company.compliance_level as ComplianceLevel] ?? company.compliance_level}</span>
                  </div>
                )}
                {company.recommended_factory_type && (
                  <div>
                    <span className="text-muted-foreground">工厂建议：</span>
                    <span className="font-medium">{FACTORY_TYPE_LABELS[company.recommended_factory_type as RecommendedFactoryType] ?? company.recommended_factory_type}</span>
                  </div>
                )}
                {factoryMatch && (
                  <div className={`rounded-md p-2 mt-1 ${factoryMatch.decision === 'not_ready' ? 'bg-red-50' : factoryMatch.decision === 'partner' ? 'bg-amber-50' : 'bg-green-50'}`}>
                    <div className="font-medium">{FACTORY_DECISION_LABELS[factoryMatch.decision]}{factoryMatch.factory_name ? ` — ${factoryMatch.factory_name}` : ''}</div>
                    {factoryMatch.compliance_gap.length > 0 && (
                      <div className="text-muted-foreground">合规缺口：{factoryMatch.compliance_gap.join(', ')}</div>
                    )}
                    <div className="mt-0.5">{factoryMatch.action_required}</div>
                  </div>
                )}
                {Array.isArray(company.compliance_requirements) && company.compliance_requirements.length > 0 && (
                  <div className="flex gap-1.5 flex-wrap pt-1">
                    {(company.compliance_requirements as string[]).map((r) => (
                      <Badge key={r} variant="secondary" className="text-[10px]">{r}</Badge>
                    ))}
                  </div>
                )}
                {Array.isArray(company.compliance_blockers) && company.compliance_blockers.length > 0 && (
                  <ul className="list-disc pl-4 text-amber-700 pt-1">
                    {(company.compliance_blockers as string[]).map((b, i) => <li key={i}>{b}</li>)}
                  </ul>
                )}
              </CardContent>
            </Card>
          )}

          {/* Next Action */}
          {company.next_action && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2"><CardTitle className="text-sm">下一步行动</CardTitle></CardHeader>
              <CardContent className="flex items-center justify-between gap-3">
                <p className="text-sm">{company.next_action}</p>
                {latestReport && (
                  <form action={createTaskFromReport}>
                    <input type="hidden" name="companyId" value={id} />
                    <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors whitespace-nowrap">
                      创建任务
                    </button>
                  </form>
                )}
              </CardContent>
            </Card>
          )}

          {/* Overview */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">公司概况</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {company.description && (
                <p className="text-sm text-muted-foreground">{company.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                {company.company_type && (
                  <div>
                    <span className="text-muted-foreground">类型：</span>
                    <span className="capitalize">{company.company_type.replace(/_/g, ' ')}</span>
                  </div>
                )}
                {company.price_point && (
                  <div>
                    <span className="text-muted-foreground">价位：</span>
                    <span className="capitalize">{company.price_point}</span>
                  </div>
                )}
                {company.employee_count_range && (
                  <div>
                    <span className="text-muted-foreground">员工数：</span>
                    <span>{company.employee_count_range}</span>
                  </div>
                )}
                {company.shopify_detected && (
                  <div>
                    <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">检测到 Shopify</span>
                  </div>
                )}
              </div>
              {company.product_categories && company.product_categories.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {company.product_categories.map((cat: string) => (
                    <Badge key={cat} variant="secondary" className="text-xs capitalize">{cat}</Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score Breakdown */}
          {score && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">评分明细</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 mb-4">
                  {SCORE_DIMS.map(({ key, label }) => {
                    const val = (score as Record<string, unknown>)[key] as number | null
                    if (val === null || val === undefined) return null
                    return (
                      <div key={key} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
                        <div className="flex-1 bg-muted rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full bg-primary transition-all"
                            style={{ width: `${(val / 10) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono w-8 text-right">{val.toFixed(1)}</span>
                      </div>
                    )
                  })}
                </div>
                {score.score_reasoning && (
                  <p className="text-xs text-muted-foreground border-t pt-3">{score.score_reasoning}</p>
                )}
                {score.recommended_strategy && (
                  <div className="mt-2">
                    <span className="text-xs font-medium">建议策略：</span>
                    <span className="text-xs text-muted-foreground">{score.recommended_strategy}</span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Conversation Thread */}
          {thread.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">沟通记录</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {thread.map((item, i) => (
                  <div key={i} className={`flex ${item.dir === 'out' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                      item.dir === 'out'
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-muted border'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {item.dir === 'out' ? '→ 我们' : '← 客户'}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(item.ts).toLocaleDateString()}
                        </span>
                        {item.meta && <span className="text-[10px] text-muted-foreground">{item.meta}</span>}
                      </div>
                      {item.subject && <p className="font-medium text-xs mb-1">{item.subject}</p>}
                      {item.body && (
                        <p className="text-xs text-foreground/80 whitespace-pre-wrap line-clamp-6">{item.body}</p>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Samples */}
          {samples && samples.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">样品</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {samples.map((s) => (
                  <div key={s.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                    <div>
                      <span className="capitalize font-medium text-xs">{s.status.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {s.styles_requested?.join(', ') ?? '款式待定'}{s.quantity ? ` · ${s.quantity} 件` : ''}
                      </span>
                    </div>
                    <Link href="/samples" className="text-xs text-blue-600 hover:underline">管理</Link>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Create Sample */}
          {canSample && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">创建样品申请</CardTitle></CardHeader>
              <CardContent>
                <form action={createSample} className="space-y-2">
                  <input type="hidden" name="companyId" value={id} />
                  <input type="hidden" name="contactId" value={firstContact?.id ?? ''} />
                  <div className="grid grid-cols-2 gap-2">
                    <input name="styles" placeholder="款式（逗号分隔）" className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2" />
                    <input name="quantity" type="number" placeholder="数量" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="shippingCountry" placeholder="收货国家" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="shippingName" placeholder="收件人姓名" className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2" />
                    <input name="shippingAddress" placeholder="收货地址" className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2" />
                    <textarea name="specNotes" placeholder="规格备注（面料、颜色、定制要求）" rows={2} className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2" />
                  </div>
                  <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-full">
                    创建样品单 → 移交生产
                  </button>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Orders */}
          {orders && orders.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">订单</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {orders.map((o) => (
                  <div key={o.id} className="flex items-center justify-between text-sm border-b last:border-0 pb-2 last:pb-0">
                    <div>
                      <span className="capitalize font-medium text-xs">{o.status.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {o.order_ref ?? '无单号'}{o.order_value_usd ? ` · $${Number(o.order_value_usd).toLocaleString()}` : ''}
                      </span>
                      {o.pushed_to_metronome && (
                        <span className="text-[10px] text-green-600 ml-2">→ 节拍器 {o.metronome_ref ?? ''}</span>
                      )}
                    </div>
                    {o.status === 'draft' && (
                      <form action={confirmOrder}>
                        <input type="hidden" name="orderId" value={o.id} />
                        <button type="submit" className="text-xs px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors whitespace-nowrap">
                          确认 → 生产
                        </button>
                      </form>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Create Order */}
          {canOrder && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">创建订单</CardTitle></CardHeader>
              <CardContent>
                <form action={createOrder} className="space-y-2">
                  <input type="hidden" name="companyId" value={id} />
                  <input type="hidden" name="contactId" value={firstContact?.id ?? ''} />
                  {approvedSample && <input type="hidden" name="sampleId" value={approvedSample.id} />}
                  <div className="grid grid-cols-2 gap-2">
                    <input name="orderRef" placeholder="订单号 / PO#" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="orderValue" type="number" placeholder="金额 (USD)" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="moq" type="number" placeholder="总数量" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="requiredDelivery" type="date" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="paymentTerms" placeholder="付款条款" className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2" />
                    <input name="destinationPort" placeholder="目的港" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <input name="shippingMethod" placeholder="运输方式" className="text-xs px-2 py-1.5 border rounded-md bg-background" />
                    <textarea name="productLines" placeholder="产品行，每行一条：款式:数量:单价" rows={2} className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2 font-mono" />
                    <textarea name="brandRequirements" placeholder="品牌要求（认证、吊牌、唛头）" rows={2} className="text-xs px-2 py-1.5 border rounded-md bg-background col-span-2" />
                  </div>
                  <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors w-full">
                    创建订单草稿
                  </button>
                </form>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column: Contacts + Social */}
        <div className="space-y-4">
          {/* Contacts */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm">联系人</CardTitle>
              <form action={triggerApolloLookup}>
                <input type="hidden" name="companyId" value={id} />
                <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">用 Apollo 查决策人</button>
              </form>
            </CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const ap = (company.source_raw as Record<string, unknown> | null)?.apollo as { error?: string; found?: number; saved?: number } | undefined
                if (ap?.error) return <p className="text-[11px] text-amber-700">⚠ {ap.error}（去 /settings 或让管理员配置后重试）</p>
                if (ap && typeof ap.found === 'number') return <p className="text-[11px] text-muted-foreground">Apollo：找到 {ap.found} 人，新增 {ap.saved}。</p>
                return null
              })()}
              {contacts && contacts.length > 0 ? contacts.map((contact) => (
                <div key={contact.id} className="border-b last:border-0 pb-3 last:pb-0">
                  <div className="font-medium text-sm">{contact.full_name ?? 'Unknown'}</div>
                  <div className="text-xs text-muted-foreground">{contact.title}</div>
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="text-xs text-blue-600 hover:underline block mt-0.5">
                      {contact.email}
                    </a>
                  )}
                  {contact.linkedin_url && (
                    <a href={contact.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline block">
                      LinkedIn
                    </a>
                  )}
                  {contact.reply_probability && (
                    <div className="text-xs text-muted-foreground mt-1">
                      回复概率：{(contact.reply_probability * 100).toFixed(0)}%
                    </div>
                  )}
                </div>
              )) : (
                <p className="text-xs text-muted-foreground">暂无联系人。点击「富集信息」自动查找。</p>
              )}
            </CardContent>
          </Card>

          {/* Social */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">社媒信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {company.instagram_handle && (
                <div>
                  <span className="text-muted-foreground">Instagram：</span>
                  <a href={`https://instagram.com/${company.instagram_handle}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    @{company.instagram_handle}
                  </a>
                  {company.instagram_followers && (
                    <span className="text-xs text-muted-foreground ml-1">
                      ({(company.instagram_followers / 1000).toFixed(1)}k)
                    </span>
                  )}
                </div>
              )}
              {company.tiktok_handle && (
                <div>
                  <span className="text-muted-foreground">TikTok：</span>
                  <a href={`https://tiktok.com/@${company.tiktok_handle}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    @{company.tiktok_handle}
                  </a>
                </div>
              )}
              {company.linkedin_url && (
                <div>
                  <span className="text-muted-foreground">LinkedIn：</span>
                  <a href={company.linkedin_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    查看主页
                  </a>
                </div>
              )}
              {company.amazon_store_url && (
                <div>
                  <span className="text-muted-foreground">Amazon：</span>
                  <a href={company.amazon_store_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    店铺
                  </a>
                </div>
              )}
              {!company.instagram_handle && !company.tiktok_handle && !company.linkedin_url && (
                <p className="text-xs text-muted-foreground">暂未发现社媒链接</p>
              )}
            </CardContent>
          </Card>

          {/* Recommended Strategy */}
          {score?.recommended_channels && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">建议触达渠道</CardTitle>
              </CardHeader>
              <CardContent className="flex gap-1.5 flex-wrap">
                {score.recommended_channels.map((channel: string) => (
                  <Badge key={channel} variant="secondary" className="text-xs capitalize">
                    {channel}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 海关数据 (ImportYeti via Serper) */}
          {(() => {
            const customs = (company.source_raw as Record<string, unknown> | null)?.customs as
              { importyetiUrl?: string | null; searchUrl?: string; snippets?: string[]; supplierHints?: string[]; checkedAt?: string } | undefined
            const searchUrl = customs?.searchUrl
              ?? `https://www.importyeti.com/search?q=${encodeURIComponent(decodeHtml(company.name))}`
            return (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">海关数据 (ImportYeti)</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-xs">
                  <div className="flex gap-1.5 flex-wrap">
                    <form action={triggerCustomsLookup}>
                      <input type="hidden" name="companyId" value={id} />
                      <button type="submit" className="text-xs px-2.5 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">
                        {customs ? '重新查询' : '查海关数据'}
                      </button>
                    </form>
                    <a href={customs?.importyetiUrl ?? searchUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs px-2.5 py-1 border rounded-md hover:bg-accent">在 ImportYeti 打开 ↗</a>
                  </div>
                  {company.current_supplier_hints && company.current_supplier_hints.length > 0 && (
                    <div>
                      <span className="text-muted-foreground">疑似现有供应商：</span>
                      <div className="flex gap-1 flex-wrap mt-1">
                        {company.current_supplier_hints.map((s: string) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {customs?.snippets && customs.snippets.length > 0 ? (
                    <ul className="space-y-1 text-muted-foreground border-t pt-2">
                      {customs.snippets.map((s, i) => <li key={i} className="line-clamp-3">{s}</li>)}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground">点「查海关数据」用 Serper 搜 ImportYeti 的进出口记录（谁从该公司进口 / 该公司用哪些工厂）。</p>
                  )}
                  {customs?.checkedAt && <p className="text-[10px] text-muted-foreground/70">更新于 {new Date(customs.checkedAt).toLocaleString()}</p>}
                  <form action={saveCustomsNotes} className="border-t pt-2 space-y-1">
                    <input type="hidden" name="companyId" value={id} />
                    <textarea name="notes" rows={2} placeholder="海关备注（看完 ImportYeti 手动记录：现供应商、走货量、切入点…）"
                      defaultValue={(company.source_raw as Record<string, unknown> | null)?.customs_notes as string ?? ''}
                      className="w-full text-[11px] px-2 py-1.5 border rounded-md bg-background" />
                    <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">保存备注</button>
                  </form>
                </CardContent>
              </Card>
            )
          })()}
        </div>
      </div>
    </div>
  )
}
