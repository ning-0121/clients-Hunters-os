import { createServiceClient as createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { generateReport, createTaskFromReport } from '@/actions/reports'
import { rebuildBriefAction } from '@/actions/intel'
import { computeAccess, type AccessContact } from '@/lib/contacts/access'
import { buildBrief } from '@/lib/intel/brief'
import { companyFactsFromRow, briefContactsFromRows } from '@/lib/intel/inputs'
import { BriefView } from '@/components/intel/brief-view'
import type { BriefInputs } from '@/lib/intel/types'

type Obj = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

const CONTACT_COLS =
  'full_name,title,role_type,decision_level,email,email_verified,email_deliverable,email_confidence,email_source,status,contact_priority'

export default async function ReportPage({
  params, searchParams,
}: { params: Promise<{ id: string }>; searchParams: Promise<{ queued?: string }> }) {
  const { id } = await params
  const { queued } = await searchParams
  const supabase = await createClient()

  const { data: company } = await supabase.from('companies').select('*').eq('id', id).single()
  if (!company) notFound()

  const [{ data: contacts }, { data: quotes }, { data: deals }, { data: report }] = await Promise.all([
    supabase.from('contacts').select(CONTACT_COLS).eq('company_id', id).order('contact_priority', { ascending: false }),
    supabase.from('quote_strategies').select('product_category').eq('company_id', id),
    supabase.from('deals').select('status').eq('company_id', id).eq('status', 'open'),
    supabase.from('customer_intelligence_reports')
      .select('executive_summary,business_model,product_match,report_version,created_at')
      .eq('company_id', id).order('report_version', { ascending: false }).limit(1).maybeSingle(),
  ])

  const access = computeAccess((contacts ?? []) as AccessContact[])
  const inputs: BriefInputs = {
    company: companyFactsFromRow(company),
    contacts: briefContactsFromRows((contacts ?? []) as Obj[]),
    access,
    quoteCategories: (quotes ?? []).map((q) => (q as Obj).product_category as string).filter(Boolean),
    openDeals: (deals ?? []).length,
  }
  const brief = buildBrief(inputs)

  const rsum = (report?.executive_summary ?? {}) as Obj
  const rbiz = (report?.business_model ?? {}) as Obj
  const rmatch = arr<Obj>(report?.product_match)

  return (
    <div className="p-6 max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <Link href={`/companies/${id}`} className="text-xs text-muted-foreground hover:underline">← {company.name}</Link>
          <h1 className="text-2xl font-bold mt-1">客户决策简报</h1>
          <p className="text-xs text-muted-foreground mt-1">Customer Intelligence Brief · 由现有数据实时推断(规则引擎,无 LLM)</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <form action={rebuildBriefAction}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">刷新简报</button>
          </form>
          <Link href={`/companies/${id}/outreach`} className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">开发信工作台</Link>
          <form action={createTaskFromReport}>
            <input type="hidden" name="companyId" value={id} />
            <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">创建任务</button>
          </form>
        </div>
      </div>

      {/* The brief (decision-first) */}
      <BriefView brief={brief} />

      {/* 11. Raw Evidence — last, secondary */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">11. 原始证据 / Raw Evidence</CardTitle></CardHeader>
        <CardContent className="text-sm space-y-2">
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">展开原始 LLM 情报报告(背景资料,次要)</summary>
            <div className="pt-2 space-y-2">
              {report ? (
                <>
                  <p className="text-xs text-muted-foreground">v{report.report_version} · {report.created_at ? new Date(report.created_at).toLocaleDateString() : ''}</p>
                  {str(rsum.worth_developing) && <div><span className="text-muted-foreground">是否值得开发:</span>{str(rsum.worth_developing)}</div>}
                  {str(rsum.next_step) && <div><span className="text-muted-foreground">下一步:</span>{str(rsum.next_step)}</div>}
                  {str(rbiz.reasoning) && <div><span className="text-muted-foreground">商业模式:</span>{str(rbiz.reasoning)}</div>}
                  {rmatch.length > 0 && (
                    <div><span className="text-muted-foreground">产品匹配:</span>
                      <ul className="list-disc pl-4">{rmatch.map((m, i) => (
                        <li key={i}>{str(m.category)}{str(m.match_level) && ` (${str(m.match_level)})`}{str(m.suggested_qimo_product) && ` → ${str(m.suggested_qimo_product)}`}</li>
                      ))}</ul>
                    </div>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{queued ? '原始报告生成中(队列)…稍后刷新查看。' : '尚无原始 LLM 报告(可选;简报已可用)。'}</span>
                  <form action={generateReport}>
                    <input type="hidden" name="companyId" value={id} />
                    <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent shrink-0">生成原始报告</button>
                  </form>
                </div>
              )}
            </div>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
