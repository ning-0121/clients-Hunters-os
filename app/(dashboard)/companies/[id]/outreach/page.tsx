import { createServiceClient as createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { composeOutreachDraft, saveOutreachEdit, submitOutreachForApproval } from '@/actions/outreach-studio'

export const dynamic = 'force-dynamic'

function decodeHtml(s: string): string {
  return (s ?? '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&#\d+;/g, (m) => String.fromCharCode(parseInt(m.slice(2, -1)))).trim()
}

export default async function OutreachStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const sb = await createClient()

  const [{ data: company }, { data: draft }, { data: contact }, { data: pending }] = await Promise.all([
    sb.from('companies').select('id, name, customer_tier, current_supplier_hints, product_match').eq('id', id).single(),
    sb.from('outreach_logs').select('*').eq('company_id', id).eq('status', 'draft').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    sb.from('contacts').select('full_name, title, email').eq('company_id', id).order('contact_priority', { ascending: false }).limit(1).maybeSingle(),
    sb.from('outreach_logs').select('id, subject, status, created_at').eq('company_id', id).in('status', ['pending_approval', 'approved', 'sent']).order('created_at', { ascending: false }).limit(5),
  ])
  if (!company) notFound()

  const analysis = (draft?.personalization_data as Record<string, unknown> | null)?.analysis as string | undefined
  const STATUS_LABELS: Record<string, string> = { pending_approval: '待审批', approved: '已批准', sent: '已发送' }

  return (
    <div className="p-6 max-w-4xl space-y-4">
      <div>
        <Link href={`/companies/${id}`} className="text-xs text-muted-foreground hover:underline">← {decodeHtml(company.name)}</Link>
        <h1 className="text-2xl font-bold mt-1">开发信工作台</h1>
        <p className="text-sm text-muted-foreground mt-1">
          基于采集信息做「我方能力 × 客户匹配」分析 → 生成开发信 → 可编辑/重生成 → 提交审批（不会自动发送）。
          {contact?.full_name && <> 决策人：<span className="font-medium">{contact.full_name}</span>（{contact.title ?? '—'}）</>}
        </p>
      </div>

      {/* Generate / Regenerate */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">生成 / 重新生成</CardTitle></CardHeader>
        <CardContent>
          <form action={composeOutreachDraft} className="flex gap-2 items-start">
            <input type="hidden" name="companyId" value={id} />
            <input name="feedback" placeholder="不满意？填调整要求，如：更短 / 强调价格 / 突出无缝产能 / 用中文 / 更正式"
              className="flex-1 text-sm px-3 py-2 border rounded-md bg-background" />
            <button type="submit" className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 whitespace-nowrap">
              {draft ? '按要求重写' : '生成开发信'}
            </button>
          </form>
          {!draft && <p className="text-xs text-muted-foreground mt-2">提示：先在客户页跑「富集 / Apollo 查决策人 / 查海关数据 / 分级」，采集越全，开发信越精准。</p>}
        </CardContent>
      </Card>

      {draft && (
        <>
          {/* Match analysis (internal — not sent) */}
          {analysis && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2"><CardTitle className="text-sm">匹配分析（内部参考，不发给客户）</CardTitle></CardHeader>
              <CardContent><p className="text-sm whitespace-pre-wrap text-muted-foreground">{analysis}</p></CardContent>
            </Card>
          )}

          {/* Editable draft */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">开发信草稿（可直接编辑）</CardTitle></CardHeader>
            <CardContent>
              <form action={saveOutreachEdit} className="space-y-2">
                <input type="hidden" name="companyId" value={id} />
                <input type="hidden" name="logId" value={draft.id} />
                <div>
                  <label className="text-xs text-muted-foreground">主题</label>
                  <input name="subject" defaultValue={draft.subject ?? ''} className="w-full mt-1 text-sm px-3 py-2 border rounded-md bg-background" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">正文</label>
                  <textarea name="body" defaultValue={draft.body ?? ''} rows={12} className="w-full mt-1 text-sm px-3 py-2 border rounded-md bg-background font-mono" />
                </div>
                <button type="submit" className="text-xs px-3 py-1.5 border rounded-md hover:bg-accent">保存编辑</button>
              </form>
            </CardContent>
          </Card>

          {/* Submit for approval */}
          <Card>
            <CardContent className="py-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">满意后提交审批；审批通过后才会真正发送。</p>
              <form action={submitOutreachForApproval}>
                <input type="hidden" name="companyId" value={id} />
                <input type="hidden" name="logId" value={draft.id} />
                <button type="submit" className="text-sm px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90">提交审批</button>
              </form>
            </CardContent>
          </Card>
        </>
      )}

      {/* History */}
      {pending && pending.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">已提交 / 已发送</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {pending.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-xs border-b last:border-0 pb-1">
                <span className="truncate">{p.subject ?? '(无主题)'}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-[10px]">{STATUS_LABELS[p.status] ?? p.status}</Badge>
                  {p.status === 'pending_approval' && <Link href="/approvals" className="text-primary hover:underline">去审批</Link>}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
