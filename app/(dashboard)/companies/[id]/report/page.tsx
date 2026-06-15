import { createServiceClient as createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { generateReport, createOutreachDraftFromReport, createTaskFromReport, submitReportReview } from '@/actions/reports'
import { recommendFactoryForCompany } from '@/lib/factory/recommend'
import { FACTORY_DECISION_LABELS } from '@/lib/factory/matcher'

const TIER_STYLES: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800 border-purple-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}
const MATCH_STYLES: Record<string, string> = {
  High: 'bg-green-100 text-green-700', Medium: 'bg-yellow-100 text-yellow-700', Low: 'bg-gray-100 text-gray-500',
}
const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-red-100 text-red-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-gray-100 text-gray-500',
}
const CONFIDENCE_STYLES: Record<string, string> = {
  Confirmed: 'bg-green-100 text-green-700',
  Likely: 'bg-blue-100 text-blue-700',
  'Needs verification': 'bg-amber-100 text-amber-700',
}

type Obj = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">{children}</CardContent>
    </Card>
  )
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ queued?: string }> }) {
  const { id } = await params
  const { queued } = await searchParams
  const supabase = await createClient()

  const [{ data: company }, { data: report }] = await Promise.all([
    supabase.from('companies').select('id, name, customer_tier, compliance_level, product_categories, product_match, recommended_factory_type').eq('id', id).single(),
    supabase.from('customer_intelligence_reports').select('*')
      .eq('company_id', id).order('report_version', { ascending: false }).limit(1).maybeSingle(),
  ])

  if (!company) notFound()

  const { data: reviews } = report
    ? await supabase.from('report_quality_reviews').select('*')
        .eq('report_id', report.id).order('created_at', { ascending: false })
    : { data: null }

  if (!report) {
    return (
      <div className="p-6 max-w-3xl">
        <Link href={`/companies/${id}`} className="text-xs text-muted-foreground hover:underline">← {company.name}</Link>
        <h1 className="text-2xl font-bold mt-2 mb-4">客户情报报告</h1>
        {queued ? (
          <Card><CardContent className="py-6 text-sm flex items-center justify-between gap-3">
            <span className="flex items-center gap-2"><span className="animate-pulse h-2 w-2 rounded-full bg-blue-500 inline-block" />报告生成中（已加入队列），通常 1-2 分钟。请稍后刷新本页。</span>
            <Link href={`/companies/${id}/report`} className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent shrink-0">刷新</Link>
          </CardContent></Card>
        ) : (
          <Card><CardContent className="py-6 text-sm text-muted-foreground flex items-center justify-between">
            <span>还没有为 {company.name} 生成报告。</span>
            <form action={generateReport}>
              <input type="hidden" name="companyId" value={id} />
              <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">生成报告</button>
            </form>
          </CardContent></Card>
        )}
        <p className="text-xs text-muted-foreground mt-3">提示：报告由后台 worker 生成，请确保已在电脑上运行 <code>npm run worker</code>。</p>
      </div>
    )
  }

  const summary = (report.executive_summary ?? {}) as Obj
  const profile = (report.company_profile ?? {}) as Obj
  const bizModel = (report.business_model ?? {}) as Obj
  const compliance = (report.compliance_requirements ?? {}) as Obj
  const entry = (report.supplier_entry_path ?? {}) as Obj
  const contactStrat = (report.contact_strategy ?? {}) as Obj
  const draft = (report.draft_messages ?? {}) as Obj
  const firstEmail = (draft.first_outreach_email ?? {}) as Obj
  const followEmail = (draft.follow_up_email ?? {}) as Obj
  const tier = str(report.customer_tier) ?? str(summary.tier) ?? '?'
  const isDomestic = report.report_kind === 'domestic'
  const dom = (report.domestic_report ?? {}) as Obj
  const factoryMatch = isDomestic ? null : await recommendFactoryForCompany(company).catch(() => null)

  return (
    <div className="p-6 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/companies/${id}`} className="text-xs text-muted-foreground hover:underline">← {company.name}</Link>
          <div className="flex items-center gap-3 mt-1">
            <h1 className="text-2xl font-bold">客户情报报告</h1>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${TIER_STYLES[tier] ?? ''}`}>{tier} 级</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            v{report.report_version} · {report.report_depth} ·{' '}
            {report.confidence_score != null && `置信度 ${(Number(report.confidence_score) * 100).toFixed(0)}% · `}
            {new Date(report.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <form action={generateReport}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">重新生成</button>
          </form>
          <form action={createOutreachDraftFromReport}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">生成开发信草稿</button>
          </form>
          <form action={createTaskFromReport}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">创建任务</button>
          </form>
        </div>
      </div>

      {isDomestic && <DomesticReportBody dom={dom} draft={draft} />}

      {!isDomestic && <>
      {/* 1. Executive Summary */}
      <Card className="border-primary/30">
        <CardHeader className="pb-2"><CardTitle className="text-sm">执行摘要</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          {str(summary.worth_developing) && <p>{str(summary.worth_developing)}</p>}
          <div className="grid grid-cols-2 gap-2 text-xs">
            {str(summary.horizon) && <div><span className="text-muted-foreground">开发周期：</span>{str(summary.horizon)?.replace('_', ' ')}</div>}
            {str(summary.best_product_angle) && <div><span className="text-muted-foreground">产品切入：</span>{str(summary.best_product_angle)}</div>}
            {str(summary.biggest_blocker) && <div className="col-span-2"><span className="text-muted-foreground">最大阻碍：</span>{str(summary.biggest_blocker)}</div>}
            {str(summary.next_step) && <div className="col-span-2"><span className="text-muted-foreground">下一步：</span>{str(summary.next_step)}</div>}
          </div>
        </CardContent>
      </Card>

      {/* 2. Company Profile */}
      <Section title="公司概况">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {([
            ['名称', profile.name], ['国家', profile.country], ['总部', profile.headquarters],
            ['成立年份', profile.founded_year], ['管理层', profile.leadership], ['门店数', profile.store_count],
            ['网站', profile.website], ['市场覆盖', profile.market_coverage], ['品牌定位', profile.brand_positioning],
          ] as [string, unknown][]).map(([label, v]) => (
            <div key={label}><span className="text-muted-foreground">{label}: </span>{str(v) ?? <span className="italic text-muted-foreground">未找到</span>}</div>
          ))}
        </div>
        {arr<string>(profile.ecommerce_channels).length > 0 && (
          <div className="flex gap-1.5 flex-wrap pt-1">
            {arr<string>(profile.ecommerce_channels).map((c) => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}
          </div>
        )}
      </Section>

      {/* 3. Business Model */}
      <Section title="业务模式">
        <div className="flex gap-1.5 flex-wrap">
          {arr<string>(bizModel.classification).map((c) => <Badge key={c} variant="outline" className="text-[10px] capitalize">{c.replace(/_/g, ' ')}</Badge>)}
        </div>
        {str(bizModel.reasoning) && <p className="text-xs text-muted-foreground">{str(bizModel.reasoning)}</p>}
      </Section>

      {/* 4. Product Lines */}
      {arr<Obj>(report.product_lines).length > 0 && (
        <Section title="产品线分析">
          <div className="flex gap-1.5 flex-wrap">
            {arr<Obj>(report.product_lines).map((p, i) => (
              <span key={i} className="text-xs px-2 py-0.5 rounded-full border flex items-center gap-1">
                {str(p.category)}
                {str(p.confidence) && <span className={`text-[9px] px-1 rounded ${CONFIDENCE_STYLES[str(p.confidence)!] ?? ''}`}>{str(p.confidence)}</span>}
              </span>
            ))}
          </div>
        </Section>
      )}

      {/* 5. Product Match */}
      {arr<Obj>(report.product_match).length > 0 && (
        <Section title="与 QIMO 产品匹配">
          {arr<Obj>(report.product_match).map((p, i) => (
            <div key={i} className="flex items-start gap-2 text-xs border-b last:border-0 pb-2 last:pb-0">
              <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${MATCH_STYLES[str(p.match_level) ?? ''] ?? 'bg-muted'}`}>{str(p.match_level)}</span>
              <div>
                <span className="font-medium">{str(p.category)}</span>
                {str(p.suggested_qimo_product) && <span className="text-muted-foreground"> → {str(p.suggested_qimo_product)}</span>}
                {str(p.why_it_matches) && <p className="text-muted-foreground mt-0.5">{str(p.why_it_matches)}</p>}
                {str(p.recommended_entry_sku) && <p className="text-muted-foreground">切入款：{str(p.recommended_entry_sku)}</p>}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* 6. Compliance */}
      <Section title="合规与验厂要求">
        {arr<Obj>(compliance.items).map((it, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <Badge variant="outline" className="text-[10px]">{str(it.status)}</Badge>
            <span className="font-medium">{str(it.requirement)}</span>
            {str(it.note) && <span className="text-muted-foreground">— {str(it.note)}</span>}
          </div>
        ))}
        <div className="text-xs space-y-1 pt-1 border-t mt-1">
          {str(compliance.current_factory_can_support) && <div><span className="text-muted-foreground">现工厂能否承接：</span>{str(compliance.current_factory_can_support)}</div>}
          <div><span className="text-muted-foreground">需要合作工厂：</span>{compliance.partner_factory_needed ? '是' : '否'}</div>
          <div><span className="text-muted-foreground">需要 SMETA 合作工厂：</span>{compliance.smeta_partner_needed ? '是' : '否'}</div>
          {str(compliance.bsci_wrap_renewal_enough) && <div><span className="text-muted-foreground">BSCI/WRAP 续证是否足够：</span>{str(compliance.bsci_wrap_renewal_enough)}</div>}
        </div>
      </Section>

      {/* Factory Match (deterministic, from factory matrix) */}
      {factoryMatch && (
        <Section title="工厂匹配">
          <div className={`rounded-md p-3 text-xs ${factoryMatch.decision === 'not_ready' ? 'bg-red-50' : factoryMatch.decision === 'partner' ? 'bg-amber-50' : 'bg-green-50'}`}>
            <div className="font-medium text-sm">{FACTORY_DECISION_LABELS[factoryMatch.decision]}{factoryMatch.factory_name ? ` — ${factoryMatch.factory_name}` : ''}</div>
            {company.recommended_factory_type && <div className="text-muted-foreground mt-0.5">建议类型：{company.recommended_factory_type.replace(/_/g, ' ')}</div>}
            {factoryMatch.factory_id && <div className="text-muted-foreground">工厂 ID：{factoryMatch.factory_id}</div>}
            {factoryMatch.compliance_gap.length > 0 && <div className="text-muted-foreground mt-0.5">合规缺口：{factoryMatch.compliance_gap.join(', ')}</div>}
            <div className="mt-1">所需行动：{factoryMatch.action_required}</div>
          </div>
        </Section>
      )}

      {/* 7. Supplier Entry Path */}
      <Section title="供应商准入路径">
        <div className="text-xs space-y-1">
          {str(entry.application_url)
            ? <div><span className="text-muted-foreground">申请入口：</span><a href={str(entry.application_url)!} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{str(entry.application_url)}</a></div>
            : <div className="text-muted-foreground">未发现供应商门户，按人工策略联系。</div>}
          {arr<string>(entry.required_documents).length > 0 && (
            <div><span className="text-muted-foreground">所需文件：</span>{arr<string>(entry.required_documents).join(', ')}</div>
          )}
          {arr<string>(entry.application_sequence).length > 0 && (
            <ol className="list-decimal pl-4">{arr<string>(entry.application_sequence).map((s, i) => <li key={i}>{s}</li>)}</ol>
          )}
          {str(entry.follow_up_method) && <div><span className="text-muted-foreground">跟进方式：</span>{str(entry.follow_up_method)}</div>}
          {str(entry.manual_strategy) && <div><span className="text-muted-foreground">人工联系策略：</span>{str(entry.manual_strategy)}</div>}
        </div>
      </Section>

      {/* 8. Contact Strategy */}
      <Section title="关键联系人策略">
        {arr<string>(contactStrat.target_titles).length > 0 && (
          <div className="flex gap-1.5 flex-wrap">{arr<string>(contactStrat.target_titles).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}</div>
        )}
        {arr<string>(contactStrat.linkedin_search_queries).length > 0 && (
          <ul className="list-disc pl-4 text-xs text-muted-foreground pt-1">{arr<string>(contactStrat.linkedin_search_queries).map((q, i) => <li key={i}>{q}</li>)}</ul>
        )}
        {str(contactStrat.notes) && <p className="text-xs text-muted-foreground">{str(contactStrat.notes)}</p>}
      </Section>

      {/* 9. Outreach Angles */}
      {arr<Obj>(report.outreach_angles).length > 0 && (
        <Section title="开发切入角度">
          {arr<Obj>(report.outreach_angles).map((a, i) => (
            <div key={i} className="text-xs border-b last:border-0 pb-2 last:pb-0">
              <span className="font-medium">{str(a.angle)}</span>
              {str(a.pitch) && <p className="text-muted-foreground mt-0.5">{str(a.pitch)}</p>}
            </div>
          ))}
        </Section>
      )}

      {/* 10. Risk Assessment */}
      {arr<Obj>(report.risk_assessment).length > 0 && (
        <Section title="风险评估">
          {arr<Obj>(report.risk_assessment).map((r, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${SEVERITY_STYLES[str(r.severity) ?? ''] ?? 'bg-muted'}`}>{str(r.severity)}</span>
              <div><span className="font-medium">{str(r.risk)}</span>{str(r.note) && <span className="text-muted-foreground"> — {str(r.note)}</span>}</div>
            </div>
          ))}
        </Section>
      )}

      {/* 11. Recommended Actions */}
      {arr<Obj>(report.recommended_actions).length > 0 && (
        <Section title="建议下一步行动">
          <ul className="space-y-1">
            {arr<Obj>(report.recommended_actions).map((a, i) => (
              <li key={i} className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="text-[10px]">{str(a.priority) ?? 'soon'}</Badge>
                <span>{str(a.action)}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* 12. Draft Messages */}
      <Section title="话术草稿">
        {(str(firstEmail.subject) || str(firstEmail.body)) && (
          <div className="border rounded-md p-3 bg-muted/30">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">首封开发信</p>
            {str(firstEmail.subject) && <p className="text-xs font-medium">{str(firstEmail.subject)}</p>}
            {str(firstEmail.body) && <p className="text-xs whitespace-pre-wrap mt-1">{str(firstEmail.body)}</p>}
          </div>
        )}
        {str(draft.linkedin_message) && (
          <div className="border rounded-md p-3 bg-muted/30">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">LinkedIn 消息</p>
            <p className="text-xs whitespace-pre-wrap">{str(draft.linkedin_message)}</p>
          </div>
        )}
        {(str(followEmail.subject) || str(followEmail.body)) && (
          <div className="border rounded-md p-3 bg-muted/30">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">跟进邮件</p>
            {str(followEmail.subject) && <p className="text-xs font-medium">{str(followEmail.subject)}</p>}
            {str(followEmail.body) && <p className="text-xs whitespace-pre-wrap mt-1">{str(followEmail.body)}</p>}
          </div>
        )}
        {str(draft.supplier_portal_intro) && (
          <div className="border rounded-md p-3 bg-muted/30">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">供应商门户介绍</p>
            <p className="text-xs whitespace-pre-wrap">{str(draft.supplier_portal_intro)}</p>
          </div>
        )}
        <p className="text-[10px] text-muted-foreground">草稿不会自动发送 —— 点击「生成开发信草稿」进入审批队列。</p>
      </Section>

      {/* Sources */}
      {arr<Obj>(report.source_urls).length > 0 && (
        <Section title="信息来源">
          <ul className="text-xs space-y-1">
            {arr<Obj>(report.source_urls).map((s, i) => (
              <li key={i}>
                <a href={str(s.url) ?? '#'} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{str(s.url)}</a>
                {str(s.used_for) && <span className="text-muted-foreground"> — {str(s.used_for)}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}
      </>}

      {/* Review Report Quality */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">报告质量评审</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <form action={submitReportReview} className="space-y-3">
            <input type="hidden" name="companyId" value={id} />
            <input type="hidden" name="reportId" value={report.id} />
            <input name="reviewer" placeholder="你的名字" className="text-xs px-2 py-1.5 border rounded-md bg-background w-48" />
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {[
                ['overall_score', '总体'],
                ['accuracy_score', '准确性'],
                ['usefulness_score', '可用度'],
                ['compliance_accuracy_score', '合规准确性'],
                ['product_match_score', '产品匹配'],
                ['next_action_quality_score', '下一步质量'],
              ].map(([name, label]) => (
                <label key={name} className="text-xs flex items-center justify-between gap-2 border rounded-md px-2 py-1.5">
                  <span className="text-muted-foreground">{label}</span>
                  <input name={name} type="number" min={1} max={10} placeholder="1-10" className="w-14 text-right bg-background border rounded px-1 py-0.5" />
                </label>
              ))}
            </div>
            <textarea name="notes" rows={2} placeholder="备注 —— 这份报告对实际开发有用吗？哪里不对或缺什么？" className="text-xs px-2 py-1.5 border rounded-md bg-background w-full" />
            <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">提交评审</button>
          </form>

          {reviews && reviews.length > 0 && (
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">历史评审（{reviews.length}）</p>
              {reviews.map((r) => (
                <div key={r.id} className="text-xs border rounded-md p-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{r.reviewer ?? 'team'}</span>
                    <span className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
                  </div>
                  <div className="flex gap-2 flex-wrap mt-1 text-muted-foreground">
                    {([
                      ['总体', r.overall_score], ['准确', r.accuracy_score], ['可用', r.usefulness_score],
                      ['合规', r.compliance_accuracy_score], ['匹配', r.product_match_score], ['下一步', r.next_action_quality_score],
                    ] as [string, number | null][]).filter(([, v]) => v != null).map(([l, v]) => (
                      <span key={l} className="px-1.5 py-0.5 bg-muted rounded">{l} {v}/10</span>
                    ))}
                  </div>
                  {r.notes && <p className="mt-1">{r.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DomesticReportBody({ dom, draft }: { dom: Obj; draft: Obj }) {
  const basic = (dom.公司基本信息 ?? {}) as Obj
  const exportMkt = (dom.出口市场 ?? {}) as Obj
  const order = (dom.订单合作可能性 ?? {}) as Obj
  const software = (dom.软件系统需求可能性 ?? {}) as Obj
  const formalEmail = (draft.formal_email ?? {}) as Obj

  return (
    <>
      <Section title="公司基本信息">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          {([
            ['名称', basic.名称], ['地区', basic.地区], ['成立年份', basic.成立年份],
            ['规模', basic.规模], ['网站', basic.网站],
          ] as [string, unknown][]).map(([l, v]) => (
            <div key={l}><span className="text-muted-foreground">{l}：</span>{str(v) ?? <span className="italic text-muted-foreground">待核实</span>}</div>
          ))}
        </div>
        {str(basic.简介) && <p className="text-xs text-muted-foreground pt-1">{str(basic.简介)}</p>}
      </Section>

      {arr<string>(dom.主营品类).length > 0 && (
        <Section title="主营品类">
          <div className="flex gap-1.5 flex-wrap">{arr<string>(dom.主营品类).map((c) => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)}</div>
        </Section>
      )}

      <Section title="出口市场">
        {arr<string>(exportMkt.主要市场).length > 0 && (
          <div className="flex gap-1.5 flex-wrap">{arr<string>(exportMkt.主要市场).map((m) => <Badge key={m} variant="outline" className="text-[10px]">{m}</Badge>)}</div>
        )}
        {str(exportMkt.说明) && <p className="text-xs text-muted-foreground">{str(exportMkt.说明)}</p>}
      </Section>

      {str(dom.业务模式) && <Section title="业务模式"><p className="text-xs">{str(dom.业务模式)}</p></Section>}

      <Section title="订单合作可能性">
        <div className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{str(order.评分) ?? '?'} / 10</Badge></div>
        {str(order.说明) && <p className="text-xs mt-1">{str(order.说明)}</p>}
      </Section>

      <Section title="软件系统需求可能性">
        <div className="flex items-center gap-2"><Badge variant="outline" className="text-[10px]">{str(software.评分) ?? '?'} / 10</Badge></div>
        {str(software.说明) && <p className="text-xs mt-1">{str(software.说明)}</p>}
      </Section>

      {arr<string>(dom.招聘扩张信号).length > 0 && (
        <Section title="招聘 / 扩张信号"><ul className="list-disc pl-4 text-xs">{arr<string>(dom.招聘扩张信号).map((s, i) => <li key={i}>{s}</li>)}</ul></Section>
      )}
      {arr<string>(dom.管理痛点推断).length > 0 && (
        <Section title="管理痛点推断"><ul className="list-disc pl-4 text-xs text-amber-700">{arr<string>(dom.管理痛点推断).map((s, i) => <li key={i}>{s}</li>)}</ul></Section>
      )}

      {str(dom.推荐合作模式) && <Section title="推荐合作模式"><p className="text-xs">{str(dom.推荐合作模式)}</p></Section>}
      {str(dom.推荐第一轮沟通话术) && <Section title="推荐第一轮沟通话术"><p className="text-xs whitespace-pre-wrap">{str(dom.推荐第一轮沟通话术)}</p></Section>}
      {str(dom.电话微信开场白) && <Section title="电话 / 微信开场白"><p className="text-xs whitespace-pre-wrap">{str(dom.电话微信开场白)}</p></Section>}

      {arr<string>(dom.下一步动作).length > 0 && (
        <Section title="下一步动作"><ul className="list-decimal pl-4 text-xs">{arr<string>(dom.下一步动作).map((s, i) => <li key={i}>{s}</li>)}</ul></Section>
      )}

      <Section title="开发话术 / 草稿">
        {str(draft.wechat_message) && (
          <div className="border rounded-md p-3 bg-muted/30"><p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">微信消息</p><p className="text-xs whitespace-pre-wrap">{str(draft.wechat_message)}</p></div>
        )}
        {str(draft.phone_script) && (
          <div className="border rounded-md p-3 bg-muted/30"><p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">电话脚本</p><p className="text-xs whitespace-pre-wrap">{str(draft.phone_script)}</p></div>
        )}
        {(str(formalEmail.subject) || str(formalEmail.body)) && (
          <div className="border rounded-md p-3 bg-muted/30"><p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">正式邮件</p>{str(formalEmail.subject) && <p className="text-xs font-medium">{str(formalEmail.subject)}</p>}{str(formalEmail.body) && <p className="text-xs whitespace-pre-wrap mt-1">{str(formalEmail.body)}</p>}</div>
        )}
        {str(draft.software_demo_invitation) && (
          <div className="border rounded-md p-3 bg-muted/30"><p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">软件演示邀约</p><p className="text-xs whitespace-pre-wrap">{str(draft.software_demo_invitation)}</p></div>
        )}
        {str(draft.order_cooperation_intro) && (
          <div className="border rounded-md p-3 bg-muted/30"><p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">订单合作介绍</p><p className="text-xs whitespace-pre-wrap">{str(draft.order_cooperation_intro)}</p></div>
        )}
        <p className="text-[10px] text-muted-foreground">草稿不会自动发送 — 使用「Create Outreach Draft」进入审批队列。</p>
      </Section>
    </>
  )
}
