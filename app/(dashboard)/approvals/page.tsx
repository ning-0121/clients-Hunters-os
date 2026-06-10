import { createServiceClient as createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { approveAction, rejectAction } from '@/actions/approvals'

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
      action_payload,
      companies(name, grade),
      contacts(full_name, email)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: false })

  return (
    <div className="p-4 sm:p-6 max-w-4xl">
      <div className="mb-4 sm:mb-6">
        <h1 className="text-2xl font-bold">Approvals</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {pending?.length ?? 0} pending — review each AI-drafted email before it sends
        </p>
      </div>

      {pending && pending.length > 0 ? (
        <div className="space-y-4">
          {pending.map((item) => {
            const company = (Array.isArray(item.companies) ? item.companies[0] : item.companies) as { name: string; grade: string } | null
            const contact = (Array.isArray(item.contacts) ? item.contacts[0] : item.contacts) as { full_name: string; email: string } | null
            const payload = item.action_payload as Record<string, unknown> | null
            const draft = payload?.draft as { subject?: string; body?: string } | null
            const expiresAt = item.expires_at ? new Date(item.expires_at) : null
            const isExpiringSoon = expiresAt && expiresAt.getTime() - Date.now() < 4 * 60 * 60 * 1000

            return (
              <Card key={item.id} className="border-l-4 border-l-orange-400">
                <CardContent className="py-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${LEVEL_STYLES[item.approval_level]}`}>
                          {item.approval_level}
                        </span>
                        {item.risk_level && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${RISK_STYLES[item.risk_level]}`}>
                            {item.risk_level} risk
                          </span>
                        )}
                        {isExpiringSoon && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700">Expiring soon</span>
                        )}
                      </div>
                      <p className="font-medium">{company?.name ?? 'Unknown'} {company?.grade ? `— Grade ${company.grade}` : ''}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        To: {contact?.full_name ? `${contact.full_name} <${contact.email}>` : (contact?.email ?? 'No contact found')}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0">{new Date(item.created_at).toLocaleDateString()}</p>
                  </div>

                  {/* Email Subject */}
                  {draft?.subject && (
                    <div className="bg-muted/50 rounded px-3 py-2 mb-3">
                      <p className="text-xs text-muted-foreground mb-0.5">Subject</p>
                      <p className="text-sm font-medium">{draft.subject}</p>
                    </div>
                  )}

                  {/* Email Body (expandable) */}
                  {draft?.body && (
                    <details className="mb-3">
                      <summary className="text-xs text-blue-600 cursor-pointer hover:underline">
                        View full email ▾
                      </summary>
                      <pre className="mt-2 text-xs bg-muted px-3 py-3 rounded whitespace-pre-wrap font-sans leading-relaxed border-l-2 border-orange-300">
                        {draft.body}
                      </pre>
                    </details>
                  )}

                  {/* Action Buttons — large touch targets, stack on mobile */}
                  <div className="flex flex-col sm:flex-row gap-2 mt-3">
                    <form action={approveAction} className="flex-1 sm:flex-none">
                      <input type="hidden" name="approvalId" value={item.id} />
                      <button type="submit" className="w-full sm:w-auto px-5 py-3 sm:py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 active:bg-green-800 transition-colors font-medium">
                        ✓ Approve &amp; Send
                      </button>
                    </form>
                    <form action={rejectAction} className="flex-1 sm:flex-none">
                      <input type="hidden" name="approvalId" value={item.id} />
                      <button type="submit" className="w-full sm:w-auto px-5 py-3 sm:py-1.5 text-sm border border-red-300 text-red-600 rounded-md hover:bg-red-50 active:bg-red-100 transition-colors">
                        ✗ Skip
                      </button>
                    </form>
                    <Link href={`/approvals/${item.id}`} className="w-full sm:w-auto text-center px-5 py-3 sm:py-1.5 text-sm border rounded-md hover:bg-accent transition-colors text-muted-foreground">
                      Edit email
                    </Link>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No pending approvals</p>
          <p className="text-sm mt-1">Worker is processing companies — check back in a few minutes</p>
        </div>
      )}
    </div>
  )
}
