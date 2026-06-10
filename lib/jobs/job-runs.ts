/**
 * Job Runs — per-job execution tracking for worker observability.
 * Writes to the job_runs table created in migration 002.
 */
import { createDirectClient } from '@/lib/supabase/server'

export interface JobRunHandle {
  id: string
  complete: (output?: Record<string, unknown>) => Promise<void>
  fail: (error: string) => Promise<void>
}

/**
 * Start a job run record. Returns a handle with complete/fail methods.
 */
export async function startJobRun(params: {
  queueJobId: string
  workerId: string
  jobType: string
  companyId?: string
  payload?: Record<string, unknown>
  attemptNumber?: number
}): Promise<JobRunHandle> {
  const sb = createDirectClient()
  const startedAt = Date.now()

  const { data } = await sb.from('job_runs').insert({
    queue_job_id:   params.queueJobId,
    worker_id:      params.workerId,
    job_type:       params.jobType,
    company_id:     params.companyId ?? null,
    payload:        params.payload ?? null,
    status:         'running',
    attempt_number: params.attemptNumber ?? 1,
    started_at:     new Date(startedAt).toISOString(),
  }).select('id').single()

  const runId = data?.id ?? `local_${Date.now()}`

  return {
    id: runId,

    async complete(output?: Record<string, unknown>): Promise<void> {
      const durationMs = Date.now() - startedAt
      await sb.from('job_runs').update({
        status:       'completed',
        completed_at: new Date().toISOString(),
        duration_ms:  durationMs,
        output_data:  output ?? null,
      }).eq('id', runId)
    },

    async fail(error: string): Promise<void> {
      const durationMs = Date.now() - startedAt
      await sb.from('job_runs').update({
        status:        'failed',
        completed_at:  new Date().toISOString(),
        duration_ms:   durationMs,
        error_message: error,
      }).eq('id', runId)
    },
  }
}

/**
 * Get recent job run stats for a given time window.
 */
export async function getJobRunStats(windowHours = 24): Promise<{
  total: number
  completed: number
  failed: number
  avgDurationMs: number
  byType: Record<string, { count: number; failures: number }>
}> {
  const sb = createDirectClient()
  const since = new Date(Date.now() - windowHours * 3600_000).toISOString()

  const { data: runs } = await sb
    .from('job_runs')
    .select('job_type, status, duration_ms')
    .gte('started_at', since)

  if (!runs || runs.length === 0) {
    return { total: 0, completed: 0, failed: 0, avgDurationMs: 0, byType: {} }
  }

  const completed   = runs.filter(r => r.status === 'completed').length
  const failed      = runs.filter(r => r.status === 'failed').length
  const durations   = runs.filter(r => r.duration_ms).map(r => r.duration_ms as number)
  const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

  const byType: Record<string, { count: number; failures: number }> = {}
  for (const r of runs) {
    if (!byType[r.job_type]) byType[r.job_type] = { count: 0, failures: 0 }
    byType[r.job_type].count++
    if (r.status === 'failed') byType[r.job_type].failures++
  }

  return { total: runs.length, completed, failed, avgDurationMs: avgDuration, byType }
}
