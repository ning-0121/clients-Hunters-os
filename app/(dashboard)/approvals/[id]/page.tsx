import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { approveAction, rejectAction } from '@/actions/approvals'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: approval } = await supabase
    .from('approvals')
    .select(`
      *,
      companies(id, name, grade, total_score, website, country),
      contacts(full_name, title, email)
    `)
    .eq('id', id)
    .single()

  if (!approval) notFound()

  const company = approval.companies as Record<string, unknown> | null
  const contact = approval.contacts as Record<string, unknown> | null
  const payload = approval.action_payload as Record<string, unknown> | null
  const draft = payload?.draft as { subject?: string; body?: string } | null

  const levelColor = approval.approval_level === 'L3' ? 'text-red-600' : 'text-yellow-600'

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <span className={`text-lg font-bold ${levelColor}`}>{approval.approval_level}</span>
        <h1 className="text-xl font-bold">{approval.title}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Company</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{String(company?.name ?? '—')}</p>
            <p className="text-sm text-muted-foreground">Grade {String(company?.grade ?? '?')} · Score {String(company?.total_score ?? '?')}</p>
            <p className="text-sm text-muted-foreground">{String(company?.country ?? '—')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{String(contact?.full_name ?? 'Unknown')}</p>
            <p className="text-sm text-muted-foreground">{String(contact?.title ?? '—')}</p>
            <p className="text-sm text-muted-foreground">{String(contact?.email ?? '—')}</p>
          </CardContent>
        </Card>
      </div>

      {draft && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI Draft</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.subject && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Subject</p>
                <p className="text-sm font-medium bg-muted px-3 py-2 rounded">{draft.subject}</p>
              </div>
            )}
            {draft.body && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">Body</p>
                <pre className="text-sm bg-muted px-3 py-3 rounded whitespace-pre-wrap font-sans">{draft.body}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {approval.status === 'pending' && (
        <div className="flex gap-3">
          <form action={approveAction}>
            <input type="hidden" name="approvalId" value={approval.id} />
            <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white">
              Approve & Execute
            </Button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="approvalId" value={approval.id} />
            <Button type="submit" variant="destructive">
              Reject
            </Button>
          </form>
        </div>
      )}

      {approval.status !== 'pending' && (
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-muted text-sm">
          <span className="capitalize font-medium">{approval.status}</span>
          {approval.decided_at && (
            <span className="text-muted-foreground">· {new Date(approval.decided_at).toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  )
}
