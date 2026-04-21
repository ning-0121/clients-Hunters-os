import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

const LEVEL_STYLES: Record<string, string> = {
  L2: 'bg-yellow-100 text-yellow-800',
  L3: 'bg-red-100 text-red-800',
}

const RISK_STYLES: Record<string, string> = {
  low:      'bg-green-100 text-green-800',
  medium:   'bg-yellow-100 text-yellow-800',
  high:     'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
}

export default async function ApprovalsPage() {
  const supabase = await createClient()

  const { data: pending } = await supabase
    .from('approvals')
    .select(`
      id, approval_level, approval_type, title, description,
      risk_level, estimated_value, created_at, expires_at,
      companies(name, grade)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Approvals</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {pending?.length ?? 0} pending — L3 items require boss approval
          </p>
        </div>
      </div>

      {pending && pending.length > 0 ? (
        <div className="space-y-3">
          {pending.map((item) => {
            const company = (Array.isArray(item.companies) ? item.companies[0] : item.companies) as { name: string; grade: string } | null
            const expiresAt = item.expires_at ? new Date(item.expires_at) : null
            const isExpiringSoon = expiresAt && expiresAt.getTime() - Date.now() < 4 * 60 * 60 * 1000

            return (
              <Link key={item.id} href={`/approvals/${item.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer border-l-4 border-l-orange-400">
                  <CardContent className="py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${LEVEL_STYLES[item.approval_level]}`}>
                            {item.approval_level}
                          </span>
                          {item.risk_level && (
                            <span className={`text-xs px-2 py-0.5 rounded-full ${RISK_STYLES[item.risk_level]}`}>
                              {item.risk_level} risk
                            </span>
                          )}
                          {isExpiringSoon && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                              Expiring soon
                            </span>
                          )}
                        </div>
                        <p className="font-medium mt-2 truncate">{item.title}</p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground mt-0.5 line-clamp-1">{item.description}</p>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {company?.name ?? 'Unknown company'} ·{' '}
                          {new Date(item.created_at).toLocaleDateString()}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {item.estimated_value && (
                          <p className="text-sm font-medium">${item.estimated_value.toLocaleString()}</p>
                        )}
                        {company?.grade && (
                          <span className="text-xs text-muted-foreground">Grade {company.grade}</span>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">All clear — no pending approvals</p>
          <p className="text-sm mt-1">AI is running autonomously within approved limits</p>
        </div>
      )}
    </div>
  )
}
