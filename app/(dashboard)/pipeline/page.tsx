import { createServiceClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'
import { bulkQueueAction } from '@/actions/bulk'

// ── Types ────────────────────────────────────────────────────────────────────

type CompanyRow = {
  id: string
  name: string
  grade: string | null
  total_score: number | null
  country: string | null
  status: string
  company_type: string | null
  instagram_followers: number | null
}

type OutreachCountRow = {
  company_id: string
  count: number
}

// ── Column config ─────────────────────────────────────────────────────────────

const COLUMNS: {
  key: string
  label: string
  color: string
  badgeClass: string
  headerClass: string
}[] = [
  {
    key: 'raw',
    label: '待富集',
    color: 'orange',
    badgeClass: 'bg-orange-100 text-orange-700 border-orange-200',
    headerClass: 'border-t-orange-400',
  },
  {
    key: 'enriched',
    label: '已富集',
    color: 'blue',
    badgeClass: 'bg-blue-100 text-blue-700 border-blue-200',
    headerClass: 'border-t-blue-400',
  },
  {
    key: 'scored',
    label: '已评分',
    color: 'purple',
    badgeClass: 'bg-purple-100 text-purple-700 border-purple-200',
    headerClass: 'border-t-purple-400',
  },
  {
    key: 'outreach',
    label: '开发中',
    color: 'green',
    badgeClass: 'bg-green-100 text-green-700 border-green-200',
    headerClass: 'border-t-green-400',
  },
  {
    key: 'engaged',
    label: '互动中',
    color: 'teal',
    badgeClass: 'bg-teal-100 text-teal-700 border-teal-200',
    headerClass: 'border-t-teal-400',
  },
  {
    key: 'qualified',
    label: '有意向',
    color: 'indigo',
    badgeClass: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    headerClass: 'border-t-indigo-400',
  },
]

// ── Grade badge style ─────────────────────────────────────────────────────────

const GRADE_CLASSES: Record<string, string> = {
  A: 'bg-green-100 text-green-800 border-green-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function PipelinePage() {
  const supabase = await createServiceClient()

  // Fetch all pipeline companies (exclude terminal statuses)
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, grade, total_score, country, status, company_type, instagram_followers')
    .in('status', ['raw', 'enriched', 'scored', 'outreach', 'engaged', 'qualified'])
    .order('total_score', { ascending: false, nullsFirst: false })

  const allCompanies: CompanyRow[] = companies ?? []

  // Fetch outreach log counts per company
  const { data: outreachRaw } = await supabase
    .from('outreach_logs')
    .select('company_id')
    .not('company_id', 'is', null)

  // Tally counts per company_id
  const outreachCounts: Record<string, number> = {}
  for (const row of outreachRaw ?? []) {
    if (row.company_id) {
      outreachCounts[row.company_id] = (outreachCounts[row.company_id] ?? 0) + 1
    }
  }

  // Group companies by status
  const grouped: Record<string, CompanyRow[]> = {}
  for (const col of COLUMNS) grouped[col.key] = []
  for (const c of allCompanies) {
    if (grouped[c.status]) grouped[c.status].push(c)
  }

  // Count per status (for header badges)
  const counts: Record<string, number> = {}
  for (const col of COLUMNS) counts[col.key] = grouped[col.key].length

  const totalRaw = counts['raw'] ?? 0

  return (
    <div className="p-6 flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">销售漏斗</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {allCompanies.length} 家进行中的公司
          </p>
        </div>
        {totalRaw > 0 && (
          <form action={bulkQueueAction}>
            <button
              type="submit"
              className="text-sm px-4 py-2 bg-orange-50 border border-orange-200 text-orange-700 rounded-md hover:bg-orange-100 transition-colors font-medium"
            >
              ⚡ 批量处理待富集 ({totalRaw})
            </button>
          </form>
        )}
      </div>

      {/* Kanban board — horizontal scroll */}
      <div className="flex gap-3 overflow-x-auto pb-4 flex-1 min-h-0 items-start">
        {COLUMNS.map((col) => {
          const cards = grouped[col.key]
          return (
            <div
              key={col.key}
              className={`flex flex-col shrink-0 w-[200px] rounded-lg border bg-muted/30 border-t-2 ${col.headerClass}`}
            >
              {/* Column header */}
              <div className="px-3 py-2.5 border-b bg-card rounded-t-lg">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold">{col.label}</span>
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full border ${col.badgeClass}`}
                  >
                    {counts[col.key]}
                  </span>
                </div>
              </div>

              {/* Cards */}
              <div className="flex flex-col gap-2 p-2 overflow-y-auto max-h-[calc(100vh-220px)]">
                {cards.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">暂无</p>
                )}
                {cards.map((c) => {
                  const emailCount = outreachCounts[c.id] ?? 0
                  const isScored = ['scored', 'outreach', 'engaged', 'qualified'].includes(c.status)

                  return (
                    <Card
                      key={c.id}
                      className="shadow-none hover:shadow-sm transition-shadow cursor-pointer"
                    >
                      <CardContent className="p-2.5 space-y-1.5">
                        {/* Name */}
                        <Link
                          href={`/companies/${c.id}`}
                          className="text-xs font-semibold leading-snug hover:underline line-clamp-2 block"
                        >
                          {c.name}
                        </Link>

                        {/* Grade + Score row */}
                        {isScored && c.grade && (
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                                GRADE_CLASSES[c.grade] ?? GRADE_CLASSES['D']
                              }`}
                            >
                              {c.grade}
                            </span>
                            {c.total_score != null && (
                              <span className="text-[10px] text-muted-foreground font-mono">
                                {Math.round(c.total_score)}
                              </span>
                            )}
                          </div>
                        )}

                        {/* Country */}
                        {c.country && (
                          <p className="text-[10px] text-muted-foreground leading-none">
                            {c.country}
                          </p>
                        )}

                        {/* Email count */}
                        {emailCount > 0 && (
                          <p className="text-[10px] text-muted-foreground">
                            已发送 {emailCount} 封邮件
                          </p>
                        )}

                        {/* IG followers */}
                        {c.instagram_followers != null && c.instagram_followers >= 10000 && (
                          <p className="text-[10px] text-muted-foreground">
                            {(c.instagram_followers / 1000).toFixed(0)}k IG
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
