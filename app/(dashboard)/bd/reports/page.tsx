import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { decodeHtml, TIER_STYLES, SEGMENT_LABELS } from '@/lib/bd/shared'
import { createOutreachDraftFromReport, createTaskFromReport } from '@/actions/reports'

export const dynamic = 'force-dynamic'

const FILTERS: { key: string; label: string; qs: string }[] = [
  { key: 'kind=overseas', label: '海外报告', qs: 'kind=overseas' },
  { key: 'kind=domestic', label: '国内报告', qs: 'kind=domestic' },
  { key: 'tier=A', label: 'A 级战略', qs: 'tier=A' },
  { key: 'tier=B', label: 'B 级行动', qs: 'tier=B' },
  { key: 'useful=7', label: '可用度 ≥7', qs: 'useful=7' },
  { key: 'review=needs', label: '待人工评审', qs: 'review=needs' },
  { key: 'blocker=compliance', label: '合规阻塞', qs: 'blocker=compliance' },
  { key: 'factory=partner', label: '需合作工厂', qs: 'factory=partner' },
]

type SP = { kind?: string; tier?: string; useful?: string; review?: string; blocker?: string; factory?: string }

export default async function BdReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const p = await searchParams
  const sb = await createClient()
  const active = p.kind ? `kind=${p.kind}` : p.tier ? `tier=${p.tier}` : p.useful ? 'useful=7'
    : p.review ? 'review=needs' : p.blocker ? 'blocker=compliance' : p.factory ? 'factory=partner' : ''

  let q = sb.from('customer_intelligence_reports')
    .select('id, company_id, report_version, report_depth, report_kind, customer_tier, confidence_score, created_at, companies(name, target_customer_segment, compliance_blockers, recommended_factory_type)')
    .order('created_at', { ascending: false }).limit(80)
  if (p.kind) q = q.eq('report_kind', p.kind)
  if (p.tier) q = q.eq('customer_tier', p.tier)

  let { data: reports } = await q
  reports = reports ?? []

  // Reviews → usefulness map (latest per report)
  const reportIds = reports.map((r) => r.id)
  const { data: reviews } = await sb.from('report_quality_reviews')
    .select('report_id, usefulness_score, reviewer, created_at').in('report_id', reportIds).order('created_at', { ascending: false })
  const reviewByReport = new Map<string, { usefulness?: number; humanReviewed: boolean }>()
  for (const rv of reviews ?? []) {
    const cur = reviewByReport.get(rv.report_id) ?? { usefulness: undefined, humanReviewed: false }
    if (cur.usefulness === undefined && rv.usefulness_score != null) cur.usefulness = rv.usefulness_score
    if (rv.reviewer && rv.reviewer !== 'auto-validation') cur.humanReviewed = true
    reviewByReport.set(rv.report_id, cur)
  }

  const one = (v: unknown) => (Array.isArray(v) ? v[0] : v) as { name?: string; target_customer_segment?: string; compliance_blockers?: unknown; recommended_factory_type?: string } | null

  if (p.useful) reports = reports.filter((r) => (reviewByReport.get(r.id)?.usefulness ?? 0) >= 7)
  if (p.review) reports = reports.filter((r) => !reviewByReport.get(r.id)?.humanReviewed)
  if (p.blocker) reports = reports.filter((r) => { const c = one(r.companies); return Array.isArray(c?.compliance_blockers) && c!.compliance_blockers.length > 0 })
  if (p.factory) reports = reports.filter((r) => one(r.companies)?.recommended_factory_type === 'partner_smeta')

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-4"><h1 className="text-2xl font-bold">客户报告中心</h1><p className="text-sm text-muted-foreground mt-1">{reports.length} 份报告</p></div>

      <div className="flex gap-2 mb-4 flex-wrap">
        <Link href="/bd/reports" className={`px-3 py-1 rounded-full text-xs border ${!active ? 'bg-foreground text-background' : 'text-muted-foreground hover:border-foreground'}`}>全部</Link>
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/bd/reports?${f.qs}`} className={`px-3 py-1 rounded-full text-xs border ${active === f.key ? 'bg-foreground text-background border-foreground' : 'border-border text-muted-foreground hover:border-foreground'}`}>{f.label}</Link>
        ))}
      </div>

      {reports.length === 0 ? (
        <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
          没有符合条件的报告。<Link href="/bd/leads" className="text-primary hover:underline">去客户池为推荐客户生成报告 →</Link>
        </CardContent></Card>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {reports.map((r) => {
            const c = one(r.companies); const rv = reviewByReport.get(r.id)
            const blockers = Array.isArray(c?.compliance_blockers) ? (c!.compliance_blockers as string[]) : []
            return (
              <Card key={r.id}><CardContent className="py-3 space-y-2">
                <div className="flex items-center gap-2">
                  {r.customer_tier && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${TIER_STYLES[r.customer_tier]}`}>{r.customer_tier}</span>}
                  <Link href={`/companies/${r.company_id}/report`} className="font-medium text-sm hover:underline truncate">{decodeHtml(c?.name ?? '客户')}</Link>
                  <Badge variant="outline" className="text-[10px]">{r.report_kind === 'domestic' ? '国内' : '海外'}</Badge>
                  {c?.target_customer_segment && <Badge variant="secondary" className="text-[10px]">{SEGMENT_LABELS[c.target_customer_segment] ?? c.target_customer_segment}</Badge>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>v{r.report_version} · {r.report_depth}</span>
                  {r.confidence_score != null && <span>置信 {(Number(r.confidence_score) * 100).toFixed(0)}%</span>}
                  {rv?.usefulness != null && <span>可用度 {rv.usefulness}/10</span>}
                  <span className={rv?.humanReviewed ? 'text-green-600' : 'text-amber-600'}>{rv?.humanReviewed ? '已人工评审' : '待人工评审'}</span>
                  <span className="ml-auto">{new Date(r.created_at).toLocaleDateString()}</span>
                </div>
                {blockers.length > 0 && <p className="text-[11px] text-amber-700">⚠ {blockers[0]}</p>}
                <div className="flex gap-1.5 flex-wrap pt-1">
                  <Link href={`/companies/${r.company_id}/report`} className="text-xs px-2 py-1 border rounded-md">打开 / 评审</Link>
                  <form action={createOutreachDraftFromReport}><input type="hidden" name="companyId" value={r.company_id} /><button className="text-xs px-2 py-1 border rounded-md">开发信草稿</button></form>
                  <form action={createTaskFromReport}><input type="hidden" name="companyId" value={r.company_id} /><button className="text-xs px-2 py-1 border rounded-md">建任务</button></form>
                </div>
              </CardContent></Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
