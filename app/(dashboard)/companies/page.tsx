import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { bulkQueueAction } from '@/actions/bulk'

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
  raw: '待富集',
  enriched: '已富集',
  scored: '已评分',
  outreach: '开发中',
  engaged: '互动中',
  qualified: '有意向',
  closed_won: '已成交',
  closed_lost: '已流失',
  dormant: '沉睡',
}

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-800 border-green-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

const TIER_STYLES: Record<string, string> = {
  A: 'bg-purple-100 text-purple-800 border-purple-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

// Saved business-development filters for the sales team.
const TIER_FILTERS: { key: string; label: string; qs: string }[] = [
  { key: 'tier=B',                   label: 'B 级主攻',      qs: 'tier=B' },
  { key: 'tier=A',                   label: 'A 级战略',   qs: 'tier=A' },
  { key: 'compliance=sedex_smeta',   label: '需要 SMETA',           qs: 'compliance=sedex_smeta' },
  { key: 'factory=current',          label: '现工厂可做',       qs: 'factory=current' },
  { key: 'factory=partner_smeta',    label: '需合作工厂',    qs: 'factory=partner_smeta' },
  { key: 'quick=1',                  label: '可快速转化',         qs: 'quick=1' },
  { key: 'segment=domestic_trading_company', label: '国内外贸公司',        qs: 'segment=domestic_trading_company' },
  { key: 'domestic_type=software_prospect',  label: '软件客户 (software prospect)', qs: 'domestic_type=software_prospect' },
]

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string; status?: string; q?: string; tier?: string; compliance?: string; factory?: string; quick?: string; segment?: string; domestic_type?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()
  const activeFilter = params.tier ? `tier=${params.tier}`
    : params.compliance ? `compliance=${params.compliance}`
    : params.factory ? `factory=${params.factory}`
    : params.segment ? `segment=${params.segment}`
    : params.domestic_type ? `domestic_type=${params.domestic_type}`
    : params.quick ? 'quick=1' : ''

  let query = supabase
    .from('companies')
    .select('id, name, country, grade, customer_tier, total_score, status, company_type, instagram_followers, recommended_factory_type, target_customer_segment, created_at')
    .order('total_score', { ascending: false })
    .limit(50)

  if (params.grade) query = query.eq('grade', params.grade)
  if (params.status) query = query.eq('status', params.status)
  if (params.q) query = query.ilike('name', `%${params.q}%`)
  if (params.tier) query = query.eq('customer_tier', params.tier)
  if (params.compliance) query = query.eq('compliance_level', params.compliance)
  if (params.factory === 'current') query = query.in('recommended_factory_type', ['current', 'current_after_renewal'])
  else if (params.factory) query = query.eq('recommended_factory_type', params.factory)
  if (params.segment) query = query.eq('target_customer_segment', params.segment)
  if (params.domestic_type) query = query.eq('domestic_company_type', params.domestic_type)
  if (params.quick) query = query.gte('conversion_feasibility_score', 7)

  const { data: companies } = await query

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">客户公司</h1>
          <p className="text-sm text-muted-foreground mt-1">共 {companies?.length ?? 0} 家</p>
        </div>
        <div className="flex gap-2">
          <form action={bulkQueueAction}>
            <button
              type="submit"
              className="text-sm px-4 py-2 border rounded-md hover:bg-accent transition-colors"
            >
              ⚡ 批量处理待富集
            </button>
          </form>
          <Link
            href="/companies/new"
            className="text-sm px-4 py-2 border rounded-md hover:bg-accent transition-colors"
          >
            + 新建客户
          </Link>
          <Link
            href="/leads/discovery"
            className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
          >
            + 发现新线索
          </Link>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {['A', 'B', 'C', 'D'].map((g) => (
          <Link
            key={g}
            href={`/companies?grade=${g}`}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              params.grade === g
                ? GRADE_STYLES[g]
                : 'border-border text-muted-foreground hover:border-foreground'
            }`}
          >
            {g} 级
          </Link>
        ))}
        <Link href="/companies" className="px-3 py-1 rounded-full text-xs border border-border text-muted-foreground hover:border-foreground">
          全部
        </Link>
      </div>

      {/* Business-development tier filters */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {TIER_FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/companies?${f.qs}`}
            className={`px-3 py-1 rounded-full text-xs border transition-colors ${
              activeFilter === f.key
                ? 'bg-foreground text-background border-foreground'
                : 'border-border text-muted-foreground hover:border-foreground'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">公司</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">国家</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">类型</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">评级</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">级别</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">分数</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {companies?.map((c) => (
              <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                    {decodeHtml(c.name)}
                  </Link>
                  {c.instagram_followers && c.instagram_followers > 10000 && (
                    <span className="text-xs text-muted-foreground ml-2">
                      {(c.instagram_followers / 1000).toFixed(0)}k IG
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{c.country ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground capitalize">
                  {c.company_type?.replace('_', ' ') ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {c.grade && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${GRADE_STYLES[c.grade]}`}>
                      {c.grade}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.customer_tier && (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${TIER_STYLES[c.customer_tier]}`}>
                      {c.customer_tier}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-sm">
                  {c.total_score ? c.total_score.toFixed(0) : '—'}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs capitalize">
                    {STATUS_LABELS[c.status] ?? c.status}
                  </Badge>
                </td>
              </tr>
            ))}
            {(!companies || companies.length === 0) && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                  暂无客户公司。{' '}
                  <Link href="/leads/discovery" className="text-primary hover:underline">
                    运行线索发现 →
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
