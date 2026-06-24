import { createServiceClient as createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { triggerScoreCompany, triggerEnrichCompany } from '@/actions/companies'
import { triggerTierCompany } from '@/actions/tiering'
import { triggerCustomsLookup, saveCustomsNotes } from '@/actions/customs'
import { triggerImportYetiLookup } from '@/actions/importyeti'
import { triggerApolloLookup } from '@/actions/apollo'
import { verifyContactEmails } from '@/actions/email'
import { flagCompanyData, clearCompanyFlag } from '@/actions/data-quality'
import { triggerDomesticContactLookup } from '@/actions/domestic-contacts'
import { triggerIntentScan } from '@/actions/intent'
import { computeCredibility, isReachableTier } from '@/lib/contacts/credibility'
import { computeIntent, INTENT_BADGE } from '@/lib/intent/intent'
import { classifyRole, ROLE_LABELS } from '@/lib/contacts/roles'
import { generateReport, createTaskFromReport } from '@/actions/reports'
import { createSample } from '@/actions/samples'
import { createOrder, confirmOrder } from '@/actions/orders'
import {
  TIER_LABELS, COMPLIANCE_LABELS, FACTORY_TYPE_LABELS,
  type CustomerTier, type ComplianceLevel, type RecommendedFactoryType,
} from '@/lib/tiering/tiering'
import { recommendFactoryForCompany } from '@/lib/factory/recommend'
import { FACTORY_DECISION_LABELS } from '@/lib/factory/matcher'
import { assessCredit, parseShipments } from '@/lib/credit/assess'
import { buildBrief } from '@/lib/intel/brief'
import { companyFactsFromRow, briefContactsFromRows } from '@/lib/intel/inputs'
import { computeAccess, type AccessContact } from '@/lib/contacts/access'
import { devClass, DEV_CLASS, type Potential, type Reachability } from '@/lib/sales/revenue-os'
import { QuoteStrategyCard } from '@/components/quote/quote-strategy-card'
import { DealList, type DealRow } from '@/components/conversion/deal-list'
import { NewDealPopover } from '@/components/conversion/new-deal-popover'
import { TimelineFeed, type EventRow } from '@/components/conversion/timeline-feed'

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
  raw: '待富集', enriched: '已富集', scored: '已评分', awaiting_contact: '待补联系方式', outreach: '开发中',
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
    { data: dealRows },
    { data: timelineEvents },
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
    supabase.from('deals').select('id, title, stage, status, owner, next_action, next_action_due_at, stage_entered_at, est_value_usd, win_prob')
      .eq('company_id', id).order('created_at', { ascending: false }),
    supabase.from('customer_events').select('id, deal_id, event_type, direction, occurred_at, title, body, owner, source')
      .eq('company_id', id).order('occurred_at', { ascending: false }).limit(60),
  ])

  if (!company) notFound()

  // Deterministic factory recommendation (own vs partner vs not-ready) — not LLM.
  const factoryMatch = company.customer_tier
    ? await recommendFactoryForCompany(company).catch(() => null)
    : null

  // Grounded credit/payment-risk assessment (live, rule-based, no LLM/cost).
  const customsForCredit = (company.source_raw as Record<string, unknown> | null)?.customs as { snippets?: string[] } | undefined
  const credit = assessCredit({
    customsShipments: parseShipments((customsForCredit?.snippets ?? []).join(' ')),
    hasCustomsHistory: !!(customsForCredit?.snippets?.length) || (company.current_supplier_hints?.length ?? 0) > 0,
    employeeRange: company.employee_count_range,
    fundingDetected: !!company.funding_detected,
    foundedYear: company.founded_year ?? null,
    country: company.country ?? null,
    estRevenue: company.estimated_annual_revenue ?? null,
    pricePoint: company.price_point ?? null,
  })
  const CREDIT_BAND_STYLE: Record<string, string> = {
    低风险: 'bg-green-100 text-green-800', 中等: 'bg-yellow-100 text-yellow-800',
    偏高: 'bg-red-100 text-red-700', 数据不足: 'bg-gray-100 text-gray-500',
  }

  // Conversion OS — deals + unified timeline (customer_events) derived values.
  const deals = (dealRows ?? []) as DealRow[]
  const openDeals = deals.filter((d) => d.status === 'open')
  const timeline = (timelineEvents ?? []) as EventRow[]
  const urgentDeal = openDeals
    .filter((d) => d.next_action_due_at)
    .sort((a, b) => new Date(a.next_action_due_at!).getTime() - new Date(b.next_action_due_at!).getTime())[0]
  const ACCOUNT_LABEL: Record<string, string> = { prospect: '潜在客户', active_customer: '活跃客户', key_account: '关键客户', strategic_account: '战略客户' }
  const BAND_LABEL: Record<string, string> = { cold: '❄️ Cold', warm: '🌤️ Warm', hot: '🔥 Hot', champion: '🏆 Champion', dormant: '💤 Dormant', risk: '⚠️ Risk' }

  // Decision brief (pure, cheap) — powers the 10-second overview: who / why / next.
  const overviewBrief = buildBrief({
    company: companyFactsFromRow(company),
    contacts: briefContactsFromRows((contacts ?? []) as Record<string, unknown>[]),
    access: computeAccess((contacts ?? []) as AccessContact[]),
    quoteCategories: [],
    openDeals: openDeals.length,
  })
  const SOE_LABEL: Record<string, string> = { strike: '🎯 出手转化', hunt: '🔍 紧急找人', nurture: '🌱 培育', hold: '⏸ 持有', abandon: '🗑 放弃' }
  const fmtNum = (n?: number | null) => (n == null ? '' : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n))

  const firstContact = contacts?.[0]
  const canSample = ['outreach', 'engaged', 'qualified'].includes(company.status)
  const canOrder  = ['qualified', 'closed_won'].includes(company.status)
  const approvedSample = samples?.find((s) => s.status === 'approved')

  // Reachability gate for the headline grade. `company.grade` measures ICP FIT
  // only — it says nothing about whether we can contact anyone. An account whose
  // contacts are all guessed / AI-inferred (no verified or trusted email, no
  // LinkedIn) cannot be acted on or moved to Reachable, so a great-fit "A" must
  // not read as actionable. We surface that honestly next to the grade rather
  // than letting a 95/100 with three undeliverable addresses look like an A.
  const hasReachableContact = (contacts ?? []).some(
    (c) => isReachableTier(computeCredibility(c).tier) || !!c.linkedin_url,
  )

  // 3-color development class (same vocabulary as 今日行动): 🟢开发 / 🟡补联系人 / ⚫放弃
  const _sampleProb = ((company.source_raw as Record<string, unknown> | null)?.probs as { sample?: number } | undefined)?.sample ?? 0
  const _potential: Potential = (company.source_raw as Record<string, unknown> | null)?.qualified === false ? 'P0'
    : (company.grade === 'A' || _sampleProb >= 70) ? 'P1'
    : (company.grade === 'B' || _sampleProb >= 40) ? 'P2' : 'P3'
  const _reachability: Reachability = hasReachableContact ? 'R1' : (contacts?.length ? 'R2' : 'R3')
  const devKlass = devClass(_potential, _reachability)

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold">{decodeHtml(company.name)}</h1>
            <span
              className={`text-sm font-bold px-3 py-1 rounded-full ${devKlass === 'develop' ? 'bg-green-100 text-green-800' : devKlass === 'fill_contact' ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-500'}`}
              title={devKlass === 'develop' ? '可达 + 有价值 → 现在开发' : devKlass === 'fill_contact' ? '有价值但联系不上 → 先补/验证联系人' : '价值低或不匹配 → 放弃'}
            >
              {DEV_CLASS[devKlass].dot} {DEV_CLASS[devKlass].label}
            </span>
            {company.grade && (
              <span
                className={`text-sm font-bold px-3 py-1 rounded-full ${hasReachableContact ? GRADE_STYLES[company.grade] : 'bg-muted text-muted-foreground'}`}
                title={hasReachableContact ? undefined : '评级仅反映匹配度（ICP fit），不含可达性 — 当前无可达联系人'}
              >
                评级 {company.grade}{!hasReachableContact && '（仅匹配）'}
              </span>
            )}
            {company.grade && !hasReachableContact && (
              <span
                className="text-sm font-bold px-3 py-1 rounded-full bg-red-100 text-red-700 border border-red-200"
                title="联系人均为 AI 推断 / 猜测邮箱，未验证、不可发送。需先用 Apollo / 查国内联系方式补齐并验证关键人邮箱，账户才能进入「可达 Reachable」并推进。"
              >
                🔴 不可达 · 待补联系方式
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
            {(() => {
              const it = computeIntent(company)
              return <span className={`text-sm font-bold px-3 py-1 rounded-full ${INTENT_BADGE[it.level].cls}`} title={it.reason}>意图 {it.score}/10</span>
            })()}
            <form action={triggerIntentScan}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">刷新意图</button>
            </form>
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
            <Link href={`/companies/${id}/outreach`} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors">
              起草开发信
            </Link>
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
            </>
          )}
          <Link href={`/companies/${id}/outreach`} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent transition-colors">
            开发信工作台
          </Link>
        </div>
      </div>

      {/* Data-quality flag banner / report control */}
      {company.data_flag ? (
        <div className="mb-6 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <span className="text-sm text-amber-800">
            ⚠ 已报错：{company.data_flag === 'bad_info' ? '客户信息有误' : '联系方式有误'}
            {company.data_flag_note ? ` —— ${company.data_flag_note}` : ''}
            <span className="text-amber-600 text-xs ml-2">（{company.data_flag_by ?? ''} · 已排队重新富集自纠）</span>
          </span>
          <form action={clearCompanyFlag}>
            <input type="hidden" name="companyId" value={id} />
            <button className="text-xs px-2 py-1 border border-amber-400 rounded-md hover:bg-amber-100 shrink-0">标记已解决</button>
          </form>
        </div>
      ) : (
        <details className="mb-6">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">⚐ 信息或联系方式有误？点此报错（系统会自动重查）</summary>
          <form action={flagCompanyData} className="mt-2 flex flex-wrap items-center gap-2 rounded-md border bg-muted/30 px-3 py-2">
            <input type="hidden" name="companyId" value={id} />
            <select name="kind" className="text-xs px-2 py-1 border rounded-md bg-background">
              <option value="bad_contact">联系方式有误</option>
              <option value="bad_info">客户信息有误</option>
            </select>
            <input name="note" placeholder="说明（可选）" className="text-xs px-2 py-1 border rounded-md bg-background flex-1 min-w-[180px]" />
            <button className="text-xs px-3 py-1 border rounded-md hover:bg-accent">提交报错并重查</button>
          </form>
        </details>
      )}

      {company.status === 'awaiting_contact' && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 mb-4">
          <p className="text-sm font-medium text-amber-800">⏸ 已入池 · 待补有效联系方式</p>
          <p className="text-xs text-amber-700 mt-0.5">
            该客户匹配度可以，但暂无「已验证邮箱」或「有效电话/WhatsApp」，已暂停开发并入池标注。系统会定期自动重找联系人；也可手动用下方「用 Apollo 查决策人 / 验证邮箱 / 查国内联系方式」补齐——找到有效联系方式后即可进入开发。
          </p>
        </div>
      )}

      {/* 成交推进 — 30 秒条 + 机会列表 */}
      <div className="border rounded-lg p-4 mb-4 space-y-3">
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <span className="font-semibold">成交推进</span>
          {company.relationship_band ? <span className="px-2 py-0.5 rounded-full bg-accent text-xs">{BAND_LABEL[company.relationship_band as string] ?? String(company.relationship_band)}</span> : null}
          <span className="px-2 py-0.5 rounded-full border text-xs">{ACCOUNT_LABEL[(company.account_status as string) ?? 'prospect'] ?? '潜在客户'}</span>
          <span className="text-xs text-muted-foreground">进行中机会 {openDeals.length}</span>
          {company.assigned_to ? <span className="text-xs text-muted-foreground">负责人 {company.assigned_to as string}</span> : null}
          {urgentDeal?.next_action && <span className="text-xs ml-auto">最紧下一步：{urgentDeal.next_action} · {new Date(urgentDeal.next_action_due_at!).toLocaleDateString()}</span>}
        </div>
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground">机会 Deals</h3>
          <NewDealPopover companyId={id} />
        </div>
        <DealList deals={deals} />
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
                    <span className="text-xs whitespace-pre-line">{company.tier_reasoning}</span>
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

          {/* Overview — 10-second snapshot: who / why develop / next action */}
          <Card>
            <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-sm">公司概况</CardTitle>
              <Link href={`/companies/${id}/report`} className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent shrink-0">查看客户简报 →</Link>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* WHO — one-line identity */}
              <p className="text-sm">
                <b>{decodeHtml(company.name)}</b>
                {[company.country, company.company_type ? String(company.company_type).replace(/_/g, ' ') : null, company.price_point, company.product_categories?.slice(0, 3).join('/')]
                  .filter(Boolean).map((x, i) => <span key={i} className="text-muted-foreground"> · {x as string}</span>)}
              </p>
              {company.description && <p className="text-sm text-muted-foreground">{company.description}</p>}

              {/* WHY develop */}
              <div className="rounded-md bg-muted/40 px-3 py-2 text-xs space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold">为什么值得开发</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">{overviewBrief.customerType.label}</span>
                  {overviewBrief.executive.annualPotentialUsd && (
                    <span className="text-muted-foreground">年潜力 ~${Math.round(overviewBrief.executive.annualPotentialUsd.low / 1000)}–{Math.round(overviewBrief.executive.annualPotentialUsd.high / 1000)}k</span>
                  )}
                  <span className="text-muted-foreground">赢率 {overviewBrief.executive.winProbability}%</span>
                </div>
                <p className="text-muted-foreground">{score?.score_reasoning || company.tier_reasoning || overviewBrief.winningStrategy.summary}</p>
              </div>

              {/* NEXT action */}
              <div className="rounded-md border px-3 py-2 text-xs space-y-1.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">下一步开发动作</span>
                  <span className="px-1.5 py-0.5 rounded-full bg-accent">{SOE_LABEL[overviewBrief.resource.action] ?? overviewBrief.resource.action}</span>
                </div>
                <ol className="list-decimal pl-4 space-y-0.5 text-muted-foreground">
                  {overviewBrief.nextActions.slice(0, 3).map((a, i) => <li key={i}>{a.task}{a.detail ? ` — ${a.detail}` : ''}</li>)}
                </ol>
                <Link href={`/companies/${id}/outreach`} className="inline-block text-primary hover:underline">→ 开始开发（开发信工作台）</Link>
              </div>

              {/* FACTS grid */}
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-sm">
                {company.website && <div><span className="text-muted-foreground">官网：</span><a href={company.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{company.domain}</a></div>}
                {company.country && <div><span className="text-muted-foreground">国家：</span>{company.country}{company.city ? ` · ${company.city}` : ''}</div>}
                {company.employee_count_range && <div><span className="text-muted-foreground">员工：</span>{company.employee_count_range}</div>}
                {company.estimated_annual_revenue && <div><span className="text-muted-foreground">营收：</span>{company.estimated_annual_revenue}</div>}
                {company.founded_year && <div><span className="text-muted-foreground">成立：</span>{company.founded_year}</div>}
                {(company.instagram_followers || company.tiktok_followers) ? <div><span className="text-muted-foreground">社媒：</span>{company.instagram_followers ? `IG ${fmtNum(company.instagram_followers)}` : ''}{company.tiktok_followers ? `${company.instagram_followers ? ' · ' : ''}TT ${fmtNum(company.tiktok_followers)}` : ''}</div> : null}
                {company.source && <div><span className="text-muted-foreground">来源：</span>{company.source_url ? <a href={company.source_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{company.source}</a> : company.source}</div>}
                {company.total_score != null && <div><span className="text-muted-foreground">评分：</span>{Number(company.total_score).toFixed(0)}/100{company.grade ? ` (${company.grade})` : ''}</div>}
              </div>

              {/* category + shopify tags */}
              {(company.product_categories?.length || company.shopify_detected) ? (
                <div className="flex gap-1.5 flex-wrap">
                  {company.product_categories?.map((cat: string) => <Badge key={cat} variant="secondary" className="text-xs capitalize">{cat}</Badge>)}
                  {company.shopify_detected && <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">Shopify</span>}
                </div>
              ) : null}
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

          {/* 统一时间线（所有渠道：邮件/回复/样品/报价/订单/阶段 + 人工记录的电话/WhatsApp/会议/拜访…）*/}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">时间线</CardTitle>
            </CardHeader>
            <CardContent>
              <TimelineFeed
                events={timeline}
                companyId={id}
                deals={deals.map((d) => ({ id: d.id, title: d.title }))}
                contacts={(contacts ?? []).map((c) => ({ id: c.id as string, full_name: (c.full_name as string) ?? null }))}
              />
            </CardContent>
          </Card>

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
              <div className="flex gap-1.5">
                <form action={triggerApolloLookup}>
                  <input type="hidden" name="companyId" value={id} />
                  <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">用 Apollo 查决策人</button>
                </form>
                <form action={verifyContactEmails}>
                  <input type="hidden" name="companyId" value={id} />
                  <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">验证邮箱</button>
                </form>
                <form action={triggerDomesticContactLookup}>
                  <input type="hidden" name="companyId" value={id} />
                  <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">查国内联系方式</button>
                </form>
              </div>
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
                  <div className="font-medium text-sm flex items-center gap-1.5">
                    {contact.full_name ?? 'Unknown'}
                    <Badge variant="outline" className="text-[10px]">{ROLE_LABELS[classifyRole(contact.title)]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{contact.title}</div>
                  {(() => {
                    const cred = computeCredibility(contact)
                    if (!contact.email) return <div className="text-[11px] text-amber-700 mt-0.5">⚠ 无邮箱 — 点「验证邮箱」或「查国内联系方式」</div>
                    return (
                      <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <a href={`mailto:${contact.email}`} className={`text-xs hover:underline ${cred.tier === 'guessed' && contact.email_deliverable === false ? 'text-muted-foreground line-through' : 'text-blue-600'}`}>
                          {contact.email}
                        </a>
                        <span className={`text-[10px] px-1 rounded ${cred.badgeClass}`}>{cred.tierLabel}</span>
                        <span className="text-[10px] text-muted-foreground">{cred.riskLabel} · {cred.sourceLabel}</span>
                      </div>
                    )
                  })()}
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
                <p className="text-xs text-muted-foreground">暂无联系人。点击「富集信息」或「查国内联系方式」自动查找。</p>
              )}
              {(() => {
                const dc = (company.source_raw as Record<string, unknown> | null)?.domestic_contacts as
                  { phones?: string[]; emails?: string[]; wechats?: string[]; sources?: string[] } | undefined
                if (!dc || (!dc.phones?.length && !dc.emails?.length && !dc.wechats?.length)) return null
                return (
                  <div className="border-t pt-2 mt-1 text-[11px] space-y-1">
                    <p className="text-muted-foreground font-medium">网络检索到的联系方式：</p>
                    {dc.phones?.length ? <div>☎ {dc.phones.join('、')}</div> : null}
                    {dc.emails?.length ? <div>✉ {dc.emails.join('、')}</div> : null}
                    {dc.wechats?.length ? <div>💬 微信：{dc.wechats.join('、')}</div> : null}
                    <p className="text-muted-foreground/70">⚠ 网络公开信息，请人工核实后再使用</p>
                  </div>
                )
              })()}
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

          {/* 海关数据 (ImportYeti) — modern, evidence-first layout */}
          {(() => {
            const sr = (company.source_raw as Record<string, unknown> | null) ?? {}
            const customs = sr.customs as { snippets?: string[]; checkedAt?: string } | undefined
            const iy = sr.importYeti as {
              totalShipments?: number; countryCode?: string; mostRecentShipment?: string; companyUrl?: string
              originCountries?: string[]; suppliers?: { name: string; countryCode: string; shipments?: number }[]
              matched?: boolean; confidence?: string; candidateUrl?: string; candidateName?: string
            } | undefined
            const hqAddress = sr.hqAddress as string | undefined
            const ISO_ZH: Record<string, string> = { CN: '中国', VN: '越南', BD: '孟加拉', IN: '印度', KH: '柬埔寨', ID: '印尼', TR: '土耳其', PK: '巴基斯坦', PT: '葡萄牙', LK: '斯里兰卡', TW: '中国台湾', TH: '泰国', MM: '缅甸', HK: '中国香港' }
            const nm = decodeHtml(company.name)
            const isDomestic = company.country === 'China' || company.country === '中国'
              || (typeof company.target_customer_segment === 'string' && company.target_customer_segment.startsWith('domestic'))
              || !!company.domestic_company_type
            const googleCustoms = isDomestic
              ? `https://www.google.com/search?q=${encodeURIComponent(`"${nm}" 进出口 OR 海关 OR 客户 OR 供应商`)}`
              : `https://www.google.com/search?q=${encodeURIComponent(`site:importyeti.com ${nm}`)}`
            const hasData = !!(iy?.totalShipments)
            const origins = iy?.originCountries ?? []
            return (
              <Card>
                <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    {isDomestic ? '供应链 / 进出口线索' : '海关数据'}
                    {hasData && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">ImportYeti</span>}
                  </CardTitle>
                  <div className="flex gap-1.5">
                    <form action={isDomestic ? triggerCustomsLookup : triggerImportYetiLookup}>
                      <input type="hidden" name="companyId" value={id} />
                      <button type="submit" className="text-[11px] px-2.5 py-1 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">{iy || customs ? '重新查询' : '查海关数据'}</button>
                    </form>
                    <a href={iy?.companyUrl ?? iy?.candidateUrl ?? googleCustoms} target="_blank" rel="noopener noreferrer" className="text-[11px] px-2.5 py-1 border rounded-md hover:bg-accent">{iy?.companyUrl ? 'ImportYeti ↗' : 'Google ↗'}</a>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3 text-xs">
                  {isDomestic && <p className="text-[11px] text-amber-700">国内客户 · ImportYeti 是美国进口数据，通常查不到；用 Google 搜进出口/供应链线索更有效。</p>}

                  {hasData ? (
                    <>
                      {/* Stat grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-md bg-muted/40 px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">进口票数</div>
                          <div className="text-lg font-semibold leading-tight">{iy!.totalShipments!.toLocaleString()}</div>
                        </div>
                        <div className="rounded-md bg-muted/40 px-3 py-2">
                          <div className="text-[10px] text-muted-foreground">目的国 · 最近</div>
                          <div className="text-sm font-medium leading-tight pt-1">{iy!.countryCode ?? '—'}{iy!.mostRecentShipment ? ` · ${iy!.mostRecentShipment}` : ''}</div>
                        </div>
                      </div>
                      {hqAddress && (
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-0.5">总部 / 进口地址</div>
                          <div className="text-xs">{hqAddress}</div>
                        </div>
                      )}
                      {origins.length > 0 && (
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1">原产国（海关记录）</div>
                          <div className="flex gap-1.5 flex-wrap">
                            {origins.map((c) => <span key={c} className="text-[11px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">{ISO_ZH[c] ?? c}</span>)}
                          </div>
                        </div>
                      )}
                      {(iy?.suppliers?.length || company.current_supplier_hints?.length) ? (
                        <div>
                          <div className="text-[10px] text-muted-foreground mb-1">现供应商</div>
                          <div className="flex gap-1.5 flex-wrap">
                            {(iy?.suppliers?.length ? iy.suppliers.map((s) => `${s.name}${s.countryCode ? ` · ${ISO_ZH[s.countryCode] ?? s.countryCode}` : ''}`) : (company.current_supplier_hints ?? [])).map((s: string) => (
                              <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-muted-foreground">现供应商名称未解析（已知原产国如上）。</p>
                      )}
                    </>
                  ) : iy?.confidence === 'low' ? (
                    <p className="text-[11px] text-amber-700">找到低置信候选「{iy.candidateName}」，但名称不完全匹配，未自动采用 —— <a href={iy.candidateUrl ?? googleCustoms} target="_blank" rel="noopener noreferrer" className="underline">点此人工确认 ↗</a>，确认后可手动记入下方备注。</p>
                  ) : (
                    <p className="text-muted-foreground">点「查海关数据」拉取真实进口记录（HQ 地址 · 走货量 · 原产国 · 供应商）。</p>
                  )}

                  {/* Raw HS snippets — secondary, collapsed */}
                  {customs?.snippets && customs.snippets.length > 0 && (
                    <details className="border-t pt-2">
                      <summary className="cursor-pointer text-[11px] text-muted-foreground">原始海关条目 ({customs.snippets.length})</summary>
                      <ul className="space-y-1 text-muted-foreground mt-1">{customs.snippets.map((s, i) => <li key={i} className="line-clamp-3">{s}</li>)}</ul>
                    </details>
                  )}
                  {customs?.checkedAt && <p className="text-[10px] text-muted-foreground/70">更新于 {new Date(customs.checkedAt).toLocaleString()}</p>}

                  <form action={saveCustomsNotes} className="border-t pt-2 space-y-1">
                    <input type="hidden" name="companyId" value={id} />
                    <textarea name="notes" rows={2} placeholder="海关备注（手动补充：走货量趋势、真实供应商、切入点…）"
                      defaultValue={(sr.customs_notes as string) ?? ''}
                      className="w-full text-[11px] px-2 py-1.5 border rounded-md bg-background" />
                    <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">保存备注</button>
                  </form>
                </CardContent>
              </Card>
            )
          })()}

          {/* 信用与风险评估（规则化，零成本，实时） */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                信用与风险评估
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${CREDIT_BAND_STYLE[credit.band]}`}>{credit.band}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">风险分</span>
                <div className="flex-1 bg-muted rounded-full h-1.5">
                  <div className={`h-1.5 rounded-full ${credit.riskScore <= 3.5 ? 'bg-green-500' : credit.riskScore <= 6 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${(credit.riskScore / 10) * 100}%` }} />
                </div>
                <span className="font-mono">{credit.riskScore}/10</span>
                <span className="text-muted-foreground">置信 {(credit.confidence * 100).toFixed(0)}%</span>
              </div>
              <ul className="space-y-0.5">
                {credit.factors.map((f, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span>{f.effect === 'good' ? '🟢' : f.effect === 'bad' ? '🔴' : '⚪'}</span>
                    <span><span className="font-medium">{f.label}</span> — {f.note}</span>
                  </li>
                ))}
              </ul>
              <p className="border-t pt-1.5 text-muted-foreground">建议：{credit.recommendation}</p>
              <p className="text-[10px] text-muted-foreground/70">基于公开信号的参考评估，非征信背书；大单建议人工核实 / 中信保。</p>
            </CardContent>
          </Card>

          {/* 报价策略（Quote Intelligence Engine — 决策建议，不自动报价） */}
          <div id="quote-strategy" className="scroll-mt-4">
            <QuoteStrategyCard companyId={id} />
          </div>
        </div>
      </div>
    </div>
  )
}
