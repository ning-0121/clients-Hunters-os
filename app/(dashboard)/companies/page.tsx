import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

const STATUS_LABELS: Record<string, string> = {
  raw: 'Raw',
  enriched: 'Enriched',
  scored: 'Scored',
  outreach: 'Outreach',
  engaged: 'Engaged',
  qualified: 'Qualified',
  closed_won: 'Won',
  closed_lost: 'Lost',
  dormant: 'Dormant',
}

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-800 border-green-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ grade?: string; status?: string; q?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('companies')
    .select('id, name, country, grade, total_score, status, company_type, instagram_followers, created_at')
    .order('total_score', { ascending: false })
    .limit(50)

  if (params.grade) query = query.eq('grade', params.grade)
  if (params.status) query = query.eq('status', params.status)
  if (params.q) query = query.ilike('name', `%${params.q}%`)

  const { data: companies } = await query

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Companies</h1>
          <p className="text-sm text-muted-foreground mt-1">{companies?.length ?? 0} companies</p>
        </div>
        <Link
          href="/leads/discovery"
          className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
        >
          + Discover New Leads
        </Link>
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
            Grade {g}
          </Link>
        ))}
        <Link href="/companies" className="px-3 py-1 rounded-full text-xs border border-border text-muted-foreground hover:border-foreground">
          All
        </Link>
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Country</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Grade</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Score</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {companies?.map((c) => (
              <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/companies/${c.id}`} className="font-medium hover:underline">
                    {c.name}
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
                <td colSpan={6} className="px-4 py-12 text-center text-muted-foreground">
                  No companies found.{' '}
                  <Link href="/leads/discovery" className="text-primary hover:underline">
                    Start discovery →
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
