import { createServiceClient as createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { sendEmailAction } from '@/actions/outreach'

export default async function OutreachPage() {
  const supabase = await createClient()

  const { data: logs } = await supabase
    .from('outreach_logs')
    .select(`
      *,
      companies(id, name, grade),
      contacts(full_name, email)
    `)
    .order('created_at', { ascending: false })
    .limit(30)

  const statusLabels: Record<string, string> = {
    draft:            '草稿',
    pending_approval: '待审批',
    approved:         '已批准',
    sent:             '已发送',
    failed:           '发送失败',
    rejected:         '已拒绝',
    opened:           '已打开',
    replied:          '已回复',
  }

  const statusColor: Record<string, string> = {
    draft:    'bg-gray-100 text-gray-600',
    approved: 'bg-yellow-100 text-yellow-700',
    sent:     'bg-green-100 text-green-700',
    failed:   'bg-red-100 text-red-700',
    opened:   'bg-blue-100 text-blue-700',
    replied:  'bg-purple-100 text-purple-700',
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">开发信</h1>
        <p className="text-sm text-muted-foreground mt-1">共计 {logs?.length ?? 0} 封邮件</p>
      </div>

      <div className="space-y-3">
        {logs && logs.length > 0 ? logs.map((log) => {
          const company = (Array.isArray(log.companies) ? log.companies[0] : log.companies) as { id: string; name: string; grade: string } | null
          const contact = (Array.isArray(log.contacts) ? log.contacts[0] : log.contacts) as { full_name: string; email: string } | null
          return (
            <Card key={log.id}>
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor[log.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {statusLabels[log.status] ?? log.status}
                      </span>
                      <span className="font-medium text-sm">{company?.name ?? '—'}</span>
                      {company?.grade && (
                        <span className="text-xs text-muted-foreground">评级 {company.grade}</span>
                      )}
                    </div>
                    {contact?.email && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        收件人：{contact.full_name ? `${contact.full_name} <${contact.email}>` : contact.email}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleDateString()}</p>
                    {log.status === 'approved' && (
                      <form action={sendEmailAction} className="mt-1">
                        <input type="hidden" name="outreachLogId" value={log.id} />
                        <button
                          type="submit"
                          className="text-xs px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                        >
                          立即发送
                        </button>
                      </form>
                    )}
                  </div>
                </div>

                {log.subject && (
                  <div className="bg-muted/50 rounded px-3 py-2 mb-2">
                    <p className="text-xs text-muted-foreground">主题</p>
                    <p className="text-sm font-medium">{log.subject}</p>
                  </div>
                )}
                {log.body && (
                  <details className="group">
                    <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
                      查看邮件正文 ▾
                    </summary>
                    <pre className="mt-2 text-xs bg-muted px-3 py-3 rounded whitespace-pre-wrap font-sans leading-relaxed">
                      {log.body}
                    </pre>
                  </details>
                )}
              </CardContent>
            </Card>
          )
        }) : (
          <div className="text-center py-20 text-muted-foreground">
            <p>暂无开发信。</p>
            <p className="text-sm mt-1">先为公司评分，再点击「草拟开发信」生成第一封邮件。</p>
          </div>
        )}
      </div>
    </div>
  )
}
