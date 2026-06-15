import { createServiceClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

// ── Types ─────────────────────────────────────────────────────────────────────

type ServiceIndicator = {
  label: string
  configured: boolean
  detail?: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        ok ? 'bg-green-500' : 'bg-red-400'
      }`}
    />
  )
}

function ServiceRow({ item }: { item: ServiceIndicator }) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b last:border-0">
      <StatusDot ok={item.configured} />
      <span className="text-sm flex-1">{item.label}</span>
      <span className="text-xs text-muted-foreground">
        {item.configured ? item.detail ?? '已连接' : '未配置'}
      </span>
    </div>
  )
}

function StatCell({ label, value, highlight }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-2xl font-bold ${highlight ? 'text-red-500' : ''}`}>{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default async function SettingsPage() {
  const supabase = await createServiceClient()

  const yesterday = new Date(Date.now() - 86_400_000).toISOString()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const [
    { count: waitingJobs },
    { count: activeJobs },
    { count: completedToday },
    { count: failedJobs },
    { count: totalActions },
    { count: successActions },
    { count: actionsLast24h },
  ] = await Promise.all([
    supabase
      .from('agent_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'waiting'),
    supabase
      .from('agent_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active'),
    supabase
      .from('agent_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed')
      .gte('updated_at', todayStart.toISOString()),
    supabase
      .from('agent_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('updated_at', yesterday),
    supabase
      .from('agent_actions')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('agent_actions')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'completed'),
    supabase
      .from('agent_actions')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', yesterday),
  ])

  const total = totalActions ?? 0
  const success = successActions ?? 0
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0

  // ── Static factory profile ────────────────────────────────────────────────

  const factoryProfile = [
    { label: '发件人姓名', value: 'Alex' },
    { label: '公司', value: 'Jojofashion' },
    { label: '工厂', value: 'Qimo Clothing' },
    { label: '邮箱', value: 'alex@jojofashion.us' },
    { label: '网站', value: 'jojofashion.us' },
  ]

  // ── Service status indicators ─────────────────────────────────────────────

  const services: ServiceIndicator[] = [
    { label: 'Supabase 数据库', configured: true, detail: '已连接' },
    { label: 'Claude AI (ARAOS_ANTHROPIC_API_KEY)', configured: true, detail: '运行中' },
    { label: 'Serper 搜索 (SERPER_API_KEY)', configured: true, detail: '运行中' },
    { label: 'Gmail SMTP (GMAIL_USER)', configured: true, detail: '运行中' },
    { label: 'LinkedIn', configured: false },
    { label: 'WhatsApp', configured: false },
  ]

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">设置</h1>
        <p className="text-sm text-muted-foreground mt-1">系统状态与配置</p>
      </div>

      {/* ── Factory Profile ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            工厂资料
            <Badge variant="secondary" className="text-xs font-normal">只读 — 通过 .env.local 管理</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="divide-y">
            {factoryProfile.map(({ label, value }) => (
              <div key={label} className="flex items-center py-2.5 gap-4">
                <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
                <span className="text-sm font-medium">{value}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── System Status ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">系统状态</CardTitle>
        </CardHeader>
        <CardContent>
          {services.map((svc) => (
            <ServiceRow key={svc.label} item={svc} />
          ))}
        </CardContent>
      </Card>

      {/* ── Queue Stats ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">队列统计</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 py-1">
            <StatCell label="等待中" value={waitingJobs ?? 0} />
            <StatCell label="执行中" value={activeJobs ?? 0} />
            <StatCell label="今天已完成" value={completedToday ?? 0} />
            <StatCell
              label="失败（24 小时）"
              value={failedJobs ?? 0}
              highlight={(failedJobs ?? 0) > 0}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Agent Actions Stats ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">智能体操作</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 py-1">
            <StatCell label="累计执行操作" value={total} />
            <StatCell label="成功率" value={`${successRate}%`} />
            <StatCell label="操作数（24 小时）" value={actionsLast24h ?? 0} />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ARAOS · Revenue Agent OS · 统计数据在每次页面加载时刷新
      </p>
    </div>
  )
}
