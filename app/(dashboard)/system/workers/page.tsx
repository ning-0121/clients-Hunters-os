import { createServiceClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'

function timeSince(iso: string): string {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 60)   return `${secs}s ago`
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  return `${Math.floor(secs / 3600)}h ago`
}

function HeartbeatDot({ updatedAt }: { updatedAt: string }) {
  const ageMs  = Date.now() - new Date(updatedAt).getTime()
  const isAlive = ageMs < 120_000
  return (
    <span className="relative flex h-3 w-3">
      {isAlive && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      )}
      <span className={`relative inline-flex rounded-full h-3 w-3 ${isAlive ? 'bg-green-500' : 'bg-gray-400'}`} />
    </span>
  )
}

export default async function WorkersPage() {
  const supabase   = await createServiceClient()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const since24h   = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const [
    { data: heartbeats },
    { count: waiting },
    { count: active },
    { count: completedToday },
    { count: dead },
    { data: deadJobs },
    { data: recentJobs },
    { data: jobRunStats },
  ] = await Promise.all([
    supabase.from('worker_heartbeats')
      .select('*').order('updated_at', { ascending: false }).limit(10),
    supabase.from('agent_queue').select('id', { count: 'exact', head: true }).eq('status', 'waiting'),
    supabase.from('agent_queue').select('id', { count: 'exact', head: true }).eq('status', 'active'),
    supabase.from('agent_queue').select('id', { count: 'exact', head: true })
      .eq('status', 'completed').gte('completed_at', todayStart.toISOString()),
    supabase.from('agent_queue').select('id', { count: 'exact', head: true }).eq('status', 'dead'),
    supabase.from('agent_queue').select('id, job_type, payload, error_log, failed_at')
      .eq('status', 'dead').order('failed_at', { ascending: false }).limit(10),
    supabase.from('agent_queue').select('id, job_type, status, created_at, completed_at')
      .order('created_at', { ascending: false }).limit(20),
    // Job runs in last 24h: aggregate by type
    supabase.from('job_runs')
      .select('job_type, status, duration_ms')
      .gte('started_at', since24h),
  ])

  const liveWorkers    = heartbeats?.filter(h => new Date(h.updated_at).getTime() > Date.now() - 120_000) ?? []
  const totalProcessed = heartbeats?.reduce((s, h) => s + (h.jobs_processed ?? 0), 0) ?? 0

  // Aggregate job_run stats by type
  const runsByType: Record<string, { total: number; failed: number; avgMs: number }> = {}
  for (const r of jobRunStats ?? []) {
    const t = r.job_type as string
    if (!runsByType[t]) runsByType[t] = { total: 0, failed: 0, avgMs: 0 }
    runsByType[t].total++
    if (r.status === 'failed') runsByType[t].failed++
    if (r.duration_ms) {
      runsByType[t].avgMs = Math.round(
        (runsByType[t].avgMs * (runsByType[t].total - 1) + (r.duration_ms as number)) / runsByType[t].total
      )
    }
  }
  const jobTypeRows = Object.entries(runsByType).sort((a, b) => b[1].total - a[1].total)

  const statusStyles: Record<string, string> = {
    completed: 'text-green-600',
    waiting:   'text-orange-600',
    active:    'text-blue-600',
    dead:      'text-red-600',
    failed:    'text-red-600',
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Workers</h1>
        <p className="text-sm text-muted-foreground mt-1">Real-time queue and worker status</p>
      </div>

      {/* Queue Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Waiting',     value: waiting ?? 0,        color: 'text-orange-600' },
          { label: 'Active',      value: active ?? 0,         color: 'text-blue-600'   },
          { label: 'Done Today',  value: completedToday ?? 0, color: 'text-green-600'  },
          { label: 'Dead Letter', value: dead ?? 0,           color: (dead ?? 0) > 0 ? 'text-red-600' : 'text-muted-foreground' },
        ].map(stat => (
          <div key={stat.label} className="rounded-lg border p-4">
            <div className={`text-3xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-muted-foreground mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Worker Instances */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40 flex items-center justify-between">
          <h2 className="font-semibold text-sm">Worker Instances</h2>
          <span className="text-xs text-muted-foreground">{liveWorkers.length} alive</span>
        </div>
        {heartbeats && heartbeats.length > 0 ? heartbeats.slice(0, 6).map(h => (
          <div key={h.id} className="px-5 py-3 flex items-center gap-3">
            <HeartbeatDot updatedAt={h.updated_at} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono truncate">{h.worker_id}</span>
                <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                  {h.worker_type ?? 'queue'}
                </span>
              </div>
              <div className="text-xs text-muted-foreground">
                {h.jobs_processed ?? 0} processed · beat {timeSince(h.updated_at)}
                {h.metadata?.scans_run ? ` · ${h.metadata.scans_run} scans` : ''}
              </div>
            </div>
            <Badge variant={h.status === 'running' ? 'default' : 'secondary'} className="text-xs">
              {h.status}
            </Badge>
          </div>
        )) : (
          <div className="px-5 py-8 text-center">
            <p className="text-sm text-muted-foreground">No workers running</p>
            <p className="text-xs text-muted-foreground mt-1">
              Start with: <code className="bg-muted px-1 rounded">npm run worker</code>
            </p>
          </div>
        )}
      </div>

      {/* Job Type Performance (last 24h) */}
      {jobTypeRows.length > 0 && (
        <div className="rounded-lg border divide-y">
          <div className="px-5 py-3 bg-muted/40">
            <h2 className="font-semibold text-sm">Job Performance (last 24h)</h2>
          </div>
          <div className="divide-y">
            {jobTypeRows.map(([type, stats]) => (
              <div key={type} className="px-5 py-2.5 flex items-center gap-4 text-sm">
                <span className="font-mono text-xs w-40 shrink-0">{type}</span>
                <div className="flex-1 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>{stats.total} runs</span>
                  {stats.failed > 0 && (
                    <span className="text-red-500">{stats.failed} failed</span>
                  )}
                  {stats.avgMs > 0 && (
                    <span>{(stats.avgMs / 1000).toFixed(1)}s avg</span>
                  )}
                </div>
                <div className="shrink-0">
                  {stats.failed > 0 ? (
                    <span className="text-xs text-red-500">
                      {Math.round((stats.failed / stats.total) * 100)}% error
                    </span>
                  ) : (
                    <span className="text-xs text-green-600">✓ clean</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Jobs */}
      <div className="rounded-lg border divide-y">
        <div className="px-5 py-3 bg-muted/40 flex items-center justify-between">
          <h2 className="font-semibold text-sm">Recent Jobs</h2>
          <span className="text-xs text-muted-foreground">last 20</span>
        </div>
        <div className="divide-y">
          {recentJobs?.map(job => {
            const statusStyle = statusStyles[job.status] ?? 'text-muted-foreground'
            return (
              <div key={job.id} className="px-5 py-2.5 flex items-center gap-3 text-sm">
                <span className={`text-xs font-medium w-20 shrink-0 ${statusStyle}`}>{job.status}</span>
                <span className="font-mono text-xs flex-1">{job.job_type}</span>
                <span className="text-xs text-muted-foreground shrink-0">
                  {timeSince(job.completed_at ?? job.created_at)}
                </span>
              </div>
            )
          })}
          {(!recentJobs || recentJobs.length === 0) && (
            <div className="px-5 py-6 text-center text-sm text-muted-foreground">No jobs yet</div>
          )}
        </div>
      </div>

      {/* Dead Letter Queue */}
      {(dead ?? 0) > 0 && (
        <div className="rounded-lg border border-red-200 divide-y">
          <div className="px-5 py-3 bg-red-50 flex items-center justify-between">
            <h2 className="font-semibold text-sm text-red-800">💀 Dead Letter Queue ({dead})</h2>
            <span className="text-xs text-red-600">Jobs that exhausted all retries</span>
          </div>
          {deadJobs?.map(job => (
            <div key={job.id} className="px-5 py-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-mono">{job.job_type}</span>
                <span className="text-xs text-muted-foreground">
                  {job.failed_at ? timeSince(job.failed_at) : '—'}
                </span>
              </div>
              <div className="text-xs text-red-600 truncate">
                {(job.error_log as Record<string, unknown>)?.error as string ?? 'Unknown error'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Total stats */}
      <div className="text-xs text-muted-foreground text-right">
        Total jobs processed (all workers, all time): {totalProcessed}
      </div>
    </div>
  )
}
