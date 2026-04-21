import { createServiceClient } from '@/lib/supabase/server'
import { AgentFactory } from '@/agents/agent-factory'

const WORKER_ID = `worker_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const CONCURRENCY = 3
const POLL_INTERVAL_MS = 3000

interface QueueJob {
  id: string
  job_type: string
  payload: Record<string, unknown>
  priority: number
  attempts: number
  max_attempts: number
}

async function claimJobs(limit: number): Promise<QueueJob[]> {
  const supabase = await createServiceClient()
  const { data } = await supabase.rpc('claim_queue_jobs', {
    p_limit: limit,
    p_worker_id: WORKER_ID,
  })
  return (data as QueueJob[]) ?? []
}

async function markCompleted(jobId: string, result: Record<string, unknown>): Promise<void> {
  const supabase = await createServiceClient()
  await supabase
    .from('agent_queue')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
}

async function markFailed(job: QueueJob, error: string): Promise<void> {
  const supabase = await createServiceClient()
  const willRetry = job.attempts < job.max_attempts

  await supabase
    .from('agent_queue')
    .update({
      status: willRetry ? 'waiting' : 'failed',
      attempts: job.attempts + 1,
      failed_at: willRetry ? null : new Date().toISOString(),
      scheduled_for: willRetry
        ? new Date(Date.now() + Math.pow(2, job.attempts) * 60_000).toISOString()
        : undefined,
      error_log: { error, attempts: job.attempts + 1 },
    })
    .eq('id', job.id)
}

async function processJob(job: QueueJob): Promise<void> {
  if (!AgentFactory.canHandle(job.job_type)) {
    console.warn(`[Worker] No handler for job type: ${job.job_type}`)
    return
  }

  const agent = AgentFactory.create(job.job_type)
  try {
    const result = await agent.execute({}, job.payload)
    if (result.success) {
      await markCompleted(job.id, result.data ?? {})
    } else {
      await markFailed(job, result.error ?? 'Agent returned failure')
    }
  } catch (err) {
    await markFailed(job, String(err))
  }
}

export async function runWorkerCycle(): Promise<number> {
  const jobs = await claimJobs(CONCURRENCY)
  if (jobs.length > 0) {
    await Promise.allSettled(jobs.map(processJob))
  }
  return jobs.length
}

export async function startWorker(): Promise<void> {
  console.log(`[Worker] Starting ${WORKER_ID}`)
  while (true) {
    try {
      const processed = await runWorkerCycle()
      if (processed === 0) {
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      }
    } catch (err) {
      console.error('[Worker] Cycle error:', err)
      await new Promise((resolve) => setTimeout(resolve, 5000))
    }
  }
}
