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
        {item.configured ? item.detail ?? 'Connected' : 'Not configured'}
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
    { label: 'Sender Name', value: 'Alex' },
    { label: 'Company', value: 'Jojofashion' },
    { label: 'Factory', value: 'Qimo Clothing' },
    { label: 'Email', value: 'alex@jojofashion.us' },
    { label: 'Website', value: 'jojofashion.us' },
  ]

  // ── Service status indicators ─────────────────────────────────────────────

  const services: ServiceIndicator[] = [
    { label: 'Supabase Database', configured: true, detail: 'Connected' },
    { label: 'Claude AI (ARAOS_ANTHROPIC_API_KEY)', configured: true, detail: 'Active' },
    { label: 'Serper Search (SERPER_API_KEY)', configured: true, detail: 'Active' },
    { label: 'Gmail SMTP (GMAIL_USER)', configured: true, detail: 'Active' },
    { label: 'LinkedIn', configured: false },
    { label: 'WhatsApp', configured: false },
  ]

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">System status and configuration</p>
      </div>

      {/* ── Factory Profile ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            Factory Profile
            <Badge variant="secondary" className="text-xs font-normal">Read-only — managed via .env.local</Badge>
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
          <CardTitle className="text-base">System Status</CardTitle>
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
          <CardTitle className="text-base">Queue Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 py-1">
            <StatCell label="Waiting" value={waitingJobs ?? 0} />
            <StatCell label="Active" value={activeJobs ?? 0} />
            <StatCell label="Completed today" value={completedToday ?? 0} />
            <StatCell
              label="Failed (24h)"
              value={failedJobs ?? 0}
              highlight={(failedJobs ?? 0) > 0}
            />
          </div>
        </CardContent>
      </Card>

      {/* ── Agent Actions Stats ── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Agent Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 py-1">
            <StatCell label="Total actions run" value={total} />
            <StatCell label="Success rate" value={`${successRate}%`} />
            <StatCell label="Actions (24h)" value={actionsLast24h ?? 0} />
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        ARAOS · Revenue Agent OS · Stats refresh on each page load
      </p>
    </div>
  )
}
