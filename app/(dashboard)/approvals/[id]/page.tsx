import { createServiceClient as createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { approveAction, rejectAction } from '@/actions/approvals'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { scoreSpamRisk, SPAM_LEVEL_LABEL } from '@/lib/email/spam-score'

// Approve-button copy by approval type (behavior unchanged — copy only).
const APPROVE_LABELS: Record<string, string> = {
  email_first_touch: '批准并发送',
  quote_strategic:   '批准战略报价',
}
const approveLabel = (type?: string | null) => (type && APPROVE_LABELS[type]) || '批准'

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

  const STATUS_LABELS: Record<string, string> = {
    pending: '待审批',
    approved: '已批准',
    rejected: '已拒绝',
    expired: '已过期',
    executed: '已执行',
  }

  return (
    <div className="p-6 max-w-3xl">
      <Link href="/approvals" className="text-xs text-muted-foreground hover:underline">← 返回审批列表</Link>
      <div className="flex items-center gap-3 mt-2 mb-6">
        <span className={`text-lg font-bold ${levelColor}`}>{approval.approval_level}</span>
        <h1 className="text-xl font-bold">{approval.title}</h1>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">公司</CardTitle>
          </CardHeader>
          <CardContent>
            {company?.id ? (
              <Link href={`/companies/${String(company.id)}`} className="font-medium text-primary hover:underline">{String(company?.name ?? '—')}</Link>
            ) : <p className="font-medium">{String(company?.name ?? '—')}</p>}
            <p className="text-sm text-muted-foreground">评级 {String(company?.grade ?? '?')} · 分数 {String(company?.total_score ?? '?')}</p>
            <p className="text-sm text-muted-foreground">{String(company?.country ?? '—')}</p>
            {!!company?.id && <Link href={`/companies/${String(company.id)}`} className="text-xs text-primary hover:underline">查看评分依据 →</Link>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">联系人</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-medium">{String(contact?.full_name ?? '未知')}</p>
            <p className="text-sm text-muted-foreground">{String(contact?.title ?? '—')}</p>
            <p className="text-sm text-muted-foreground">{String(contact?.email ?? '—')}</p>
          </CardContent>
        </Card>
      </div>

      {draft && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">AI 草稿</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {draft.subject && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">主题</p>
                <p className="text-sm font-medium bg-muted px-3 py-2 rounded">{draft.subject}</p>
              </div>
            )}
            {draft.body && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">正文</p>
                <pre className="text-sm bg-muted px-3 py-3 rounded whitespace-pre-wrap font-sans">{draft.body}</pre>
              </div>
            )}
            {(() => {
              const spam = scoreSpamRisk(draft.subject ?? '', draft.body ?? '')
              return (
                <div className={`text-xs rounded px-3 py-2 ${spam.level === 'high' ? 'bg-red-50 text-red-700' : spam.level === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                  {SPAM_LEVEL_LABEL[spam.level]}（{spam.score}/100）
                  {spam.signals.length > 0 && <span className="ml-1">— {spam.signals.map((s) => `${s.label}：${s.hint}`).join('；')}</span>}
                  {spam.level !== 'low' && <span className="ml-1">→ 建议改写后再发，避免进垃圾箱。</span>}
                </div>
              )
            })()}
          </CardContent>
        </Card>
      )}

      {approval.status === 'pending' && (
        <div className="flex gap-3">
          <form action={approveAction}>
            <input type="hidden" name="approvalId" value={approval.id} />
            <Button type="submit" className="bg-green-600 hover:bg-green-700 text-white">
              {approveLabel(approval.approval_type as string | null)}
            </Button>
          </form>
          <form action={rejectAction}>
            <input type="hidden" name="approvalId" value={approval.id} />
            <Button type="submit" variant="destructive">
              拒绝
            </Button>
          </form>
        </div>
      )}

      {approval.status !== 'pending' && (
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-muted text-sm">
          <span className="capitalize font-medium">{STATUS_LABELS[approval.status] ?? approval.status}</span>
          {approval.decided_at && (
            <span className="text-muted-foreground">· {new Date(approval.decided_at).toLocaleString()}</span>
          )}
        </div>
      )}
    </div>
  )
}
