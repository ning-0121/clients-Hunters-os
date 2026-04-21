import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()

  const [
    { count: pendingApprovals },
    { count: totalCompanies },
    { count: scoredToday },
    { data: topLeads },
    { data: recentReplies },
  ] = await Promise.all([
    supabase.from('approvals').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('companies').select('*', { count: 'exact', head: true }).neq('status', 'raw'),
    supabase.from('companies').select('*', { count: 'exact', head: true })
      .eq('status', 'scored')
      .gte('scored_at', new Date(Date.now() - 86400000).toISOString()),
    supabase.from('companies')
      .select('id, name, grade, total_score, country, status')
      .in('grade', ['A', 'B'])
      .eq('status', 'scored')
      .order('total_score', { ascending: false })
      .limit(5),
    supabase.from('outreach_logs')
      .select('id, company_id, channel, reply_sentiment, replied_at, companies(name)')
      .not('replied_at', 'is', null)
      .order('replied_at', { ascending: false })
      .limit(5),
  ])

  const gradeColor: Record<string, string> = {
    A: 'bg-green-100 text-green-800',
    B: 'bg-blue-100 text-blue-800',
    C: 'bg-yellow-100 text-yellow-800',
    D: 'bg-gray-100 text-gray-500',
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Command Center</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-orange-600">{pendingApprovals ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">Pending Approvals</p>
            {(pendingApprovals ?? 0) > 0 && (
              <Link href="/approvals" className="text-xs text-orange-600 hover:underline">Review now →</Link>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold">{totalCompanies ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">Total Companies</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-green-600">{scoredToday ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">Scored Today</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-3xl font-bold text-blue-600">{recentReplies?.length ?? 0}</div>
            <p className="text-sm text-muted-foreground mt-1">Recent Replies</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top Leads to Contact Today */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Top Leads — Contact Today</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topLeads && topLeads.length > 0 ? topLeads.map((lead) => (
              <Link
                key={lead.id}
                href={`/companies/${lead.id}`}
                className="flex items-center justify-between p-2 rounded hover:bg-accent transition-colors"
              >
                <div>
                  <div className="text-sm font-medium">{lead.name}</div>
                  <div className="text-xs text-muted-foreground">{lead.country}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{lead.total_score?.toFixed(0)}</span>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${gradeColor[lead.grade ?? 'D']}`}>
                    {lead.grade}
                  </span>
                </div>
              </Link>
            )) : (
              <p className="text-sm text-muted-foreground">No scored leads yet. Run discovery to get started.</p>
            )}
          </CardContent>
        </Card>

        {/* Recent Replies */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent Replies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentReplies && recentReplies.length > 0 ? recentReplies.map((reply) => (
              <div key={reply.id} className="flex items-center justify-between p-2 rounded hover:bg-accent">
                <div>
                  <div className="text-sm font-medium">
                    {(reply.companies as { name: string } | null)?.name ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-muted-foreground capitalize">{reply.channel}</div>
                </div>
                <Badge variant={reply.reply_sentiment === 'positive' ? 'default' : 'secondary'} className="text-xs">
                  {reply.reply_sentiment ?? 'unknown'}
                </Badge>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground">No replies yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
