import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'

const GRADE_STYLES: Record<string, string> = {
  A: 'bg-green-100 text-green-800 border-green-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ discovery?: string; status?: string; grade?: string }>
}) {
  const params = await searchParams
  const supabase = await createClient()

  const [
    { data: leads },
    { count: rawCount },
    { count: enrichedCount },
    { count: scoredCount },
    { count: queuedJobs },
  ] = await Promise.all([
    supabase
      .from('companies')
      .select('id, name, domain, country, grade, total_score, status, company_type, source, created_at')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'raw'),
    supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'enriched'),
    supabase.from('companies').select('*', { count: 'exact', head: true }).eq('status', 'scored'),
    supabase.from('agent_queue').select('*', { count: 'exact', head: true }).in('status', ['waiting', 'active']),
  ])

  return (
    <div className="p-6">
      {params.discovery === 'queued' && (
        <div className="mb-4 flex items-center gap-2 bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-md text-sm">
          <span className="animate-pulse h-2 w-2 rounded-full bg-blue-500 inline-block" />
          Discovery job queued — new leads will appear automatically as AI finds them.
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Leads</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {(rawCount ?? 0) + (enrichedCount ?? 0) + (scoredCount ?? 0)} total ·
            {' '}{rawCount ?? 0} raw · {enrichedCount ?? 0} enriched · {scoredCount ?? 0} scored
            {(queuedJobs ?? 0) > 0 && ` · ${queuedJobs} jobs running`}
          </p>
        </div>
        <Link
          href="/leads/discovery"
          className="bg-primary text-primary-foreground text-sm px-4 py-2 rounded-md hover:bg-primary/90 transition-colors"
        >
          + New Discovery Run
        </Link>
      </div>

      {/* Pipeline mini-funnel */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-orange-500">{rawCount ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">Raw — awaiting enrich</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-500">{enrichedCount ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">Enriched — awaiting score</div>
        </div>
        <div className="bg-card border rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-500">{scoredCount ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">Scored — ready to contact</div>
        </div>
      </div>

      {/* Leads table */}
      <div className="rounded-md border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Company</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Country</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Type</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Grade</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Source</th>
              <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {leads?.map((lead) => (
              <tr key={lead.id} className="hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3">
                  <Link href={`/companies/${lead.id}`} className="font-medium hover:underline">
                    {lead.name}
                  </Link>
                  {lead.domain && (
                    <span className="text-xs text-muted-foreground ml-2">{lead.domain}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">{lead.country ?? '—'}</td>
                <td className="px-4 py-3 text-muted-foreground text-xs capitalize">
                  {lead.company_type?.replace(/_/g, ' ') ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {lead.grade ? (
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full border ${GRADE_STYLES[lead.grade]}`}>
                      {lead.grade}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge variant="outline" className="text-xs capitalize">{lead.source ?? '—'}</Badge>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    lead.status === 'scored' ? 'bg-green-100 text-green-700' :
                    lead.status === 'enriched' ? 'bg-blue-100 text-blue-700' :
                    lead.status === 'outreach' ? 'bg-purple-100 text-purple-700' :
                    'bg-gray-100 text-gray-600'
                  }`}>
                    {lead.status}
                  </span>
                </td>
              </tr>
            ))}
            {(!leads || leads.length === 0) && (
              <tr>
                <td colSpan={6} className="px-4 py-16 text-center text-muted-foreground">
                  <p className="text-base mb-2">No leads yet</p>
                  <Link href="/leads/discovery" className="text-primary hover:underline text-sm">
                    Start your first discovery run →
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
