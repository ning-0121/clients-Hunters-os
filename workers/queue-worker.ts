import { createDirectClient } from '@/lib/supabase/server'
import { AgentFactory } from '@/agents/agent-factory'
import { startJobRun } from '@/lib/jobs/job-runs'
import { processPendingHandoffs } from '@/lib/metronome/client'

const WORKER_ID   = `worker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const CONCURRENCY = 3
const POLL_INTERVAL_MS   = 3_000
const HEARTBEAT_INTERVAL = 30_000   // every 30s

interface QueueJob {
  id:           string
  job_type:     string
  payload:      Record<string, unknown>
  priority:     number
  attempts:     number
  max_attempts: number
}

// ── Heartbeat ─────────────────────────────────────────────────────────────────

let _heartbeatRow: string | null = null
let _jobsProcessed = 0

async function initHeartbeat(): Promise<void> {
  const supabase = createDirectClient()
  const { data } = await supabase
    .from('worker_heartbeats')
    .upsert(
      { worker_id: WORKER_ID, worker_type: 'queue', status: 'running', jobs_processed: 0, updated_at: new Date().toISOString() },
      { onConflict: 'worker_id' }
    )
    .select('id')
    .single()
  _heartbeatRow = data?.id ?? null
  console.log(`[Worker] Heartbeat registered: ${_heartbeatRow}`)
}

async function sendHeartbeat(status = 'running', errorMessage?: string): Promise<void> {
  if (!_heartbeatRow) return
  const supabase = createDirectClient()
  await supabase
    .from('worker_heartbeats')
    .update({
      status,
      jobs_processed: _jobsProcessed,
      last_job_at: _jobsProcessed > 0 ? new Date().toISOString() : undefined,
      error_message: errorMessage ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', _heartbeatRow)
}

// ── Job claim / complete / fail ───────────────────────────────────────────────

async function claimJobs(limit: number): Promise<QueueJob[]> {
  const supabase = createDirectClient()
  const { data } = await supabase.rpc('claim_queue_jobs', {
    p_limit: limit,
    p_worker_id: WORKER_ID,
  })
  return (data as QueueJob[]) ?? []
}

async function markCompleted(jobId: string): Promise<void> {
  const supabase = createDirectClient()
  await supabase
    .from('agent_queue')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', jobId)
}

async function markFailed(job: QueueJob, error: string): Promise<void> {
  const supabase = createDirectClient()
  const willRetry = job.attempts < job.max_attempts
  await supabase
    .from('agent_queue')
    .update({
      status:        willRetry ? 'waiting' : 'dead',
      attempts:      job.attempts + 1,
      failed_at:     willRetry ? null : new Date().toISOString(),
      scheduled_for: willRetry
        ? new Date(Date.now() + Math.pow(2, job.attempts) * 60_000).toISOString()
        : undefined,
      error_log: { error, attempts: job.attempts + 1 },
    })
    .eq('id', job.id)

  if (!willRetry) {
    console.warn(`[Worker] 💀 Dead-letter: ${job.job_type} (${job.id}) after ${job.attempts + 1} attempts`)
  }
}

// ── Process single job ────────────────────────────────────────────────────────

async function processJob(job: QueueJob): Promise<void> {
  if (!AgentFactory.canHandle(job.job_type)) {
    console.warn(`[Worker] No handler for job type: ${job.job_type}`)
    await markFailed(job, `No handler for job type: ${job.job_type}`)
    return
  }

  const companyId = job.payload?.companyId as string | undefined

  // Start a job_run record for observability
  const run = await startJobRun({
    queueJobId:    job.id,
    workerId:      WORKER_ID,
    jobType:       job.job_type,
    companyId,
    payload:       job.payload,
    attemptNumber: job.attempts + 1,
  }).catch(() => null)

  console.log(`[Worker] ▶ ${job.job_type}`)
  const agent = AgentFactory.create(job.job_type)
  try {
    const result = await agent.execute({}, job.payload)
    if (result.success) {
      await markCompleted(job.id)
      _jobsProcessed++
      await run?.complete(result.data)
      console.log(`[Worker] ✓ ${job.job_type}`)
    } else {
      const err = result.error ?? 'Agent returned failure'
      await markFailed(job, err)
      await run?.fail(err)
      console.warn(`[Worker] ✗ ${job.job_type}: ${err}`)
    }
  } catch (err) {
    const msg = String(err)
    await markFailed(job, msg)
    await run?.fail(msg)
    console.error(`[Worker] 💥 ${job.job_type}:`, err)
  }
}

// ── Enqueue due followup_runs ─────────────────────────────────────────────────

async function enqueueFollowups(): Promise<void> {
  const supabase = createDirectClient()
  const { data: dueRuns } = await supabase
    .from('followup_runs')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', new Date().toISOString())
    .limit(10)

  if (!dueRuns || dueRuns.length === 0) return

  for (const run of dueRuns) {
    // Mark as queued (not sent!) to prevent double-processing.
    // FollowupAgent/SendEmailAgent will update to 'sent' after confirmed delivery.
    await supabase.from('followup_runs')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .eq('id', run.id).eq('status', 'scheduled')

    // Enqueue process_followup job
    await supabase.from('agent_queue').insert({
      job_type: 'process_followup',
      payload:  { followupRunId: run.id },
      priority: 4,
    })
  }

  if (dueRuns.length > 0) {
    console.log(`[Worker] 📋 Queued ${dueRuns.length} follow-up(s)`)
  }
}

// ── Main cycle ────────────────────────────────────────────────────────────────

export async function runWorkerCycle(): Promise<number> {
  // Check for due follow-ups before processing queue
  await enqueueFollowups()

  // Push any pending production-system handoffs (节拍器)
  await processPendingHandoffs().catch(err => console.error('[Worker] Handoff push error:', err))

  const jobs = await claimJobs(CONCURRENCY)
  if (jobs.length > 0) {
    await Promise.allSettled(jobs.map(processJob))
  }
  return jobs.length
}

let _running = true

export async function startWorker(): Promise<void> {
  console.log(`[Worker] 🚀 Starting ${WORKER_ID}`)

  await initHeartbeat()

  process.on('SIGTERM', () => { console.log('[Worker] SIGTERM — stopping…'); _running = false })
  process.on('SIGINT',  () => { console.log('[Worker] SIGINT — stopping…');  _running = false })

  const hbInterval = setInterval(() => { sendHeartbeat('running').catch(() => {}) }, HEARTBEAT_INTERVAL)

  while (_running) {
    try {
      const processed = await runWorkerCycle()
      if (processed > 0) {
        console.log(`[Worker] ⚡ Processed ${processed} job(s) | total: ${_jobsProcessed}`)
      }
      if (processed === 0) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
      }
    } catch (err) {
      console.error('[Worker] Cycle error:', err)
      await sendHeartbeat('error', String(err))
      await new Promise((r) => setTimeout(r, 5_000))
    }
  }

  clearInterval(hbInterval)
  await sendHeartbeat('stopped')
  console.log('[Worker] Stopped cleanly.')
}
