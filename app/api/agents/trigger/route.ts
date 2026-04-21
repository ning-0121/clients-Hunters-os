import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { AgentFactory } from '@/agents/agent-factory'

export async function POST(req: NextRequest) {
  // Simple auth check — replace with proper auth in production
  const authHeader = req.headers.get('authorization')
  const appSecret = process.env.APP_SECRET
  if (appSecret && appSecret !== 'your_random_secret_32_chars_min' && authHeader !== `Bearer ${appSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json() as { jobType: string; payload?: Record<string, unknown>; runSync?: boolean }
  const { jobType, payload = {}, runSync = false } = body

  if (!jobType) {
    return NextResponse.json({ error: 'jobType is required' }, { status: 400 })
  }

  if (!AgentFactory.canHandle(jobType)) {
    return NextResponse.json({ error: `Unknown job type: ${jobType}` }, { status: 400 })
  }

  // runSync = true: execute immediately in this request (for small jobs / dev)
  // runSync = false: queue for background worker
  if (runSync) {
    try {
      const agent = AgentFactory.create(jobType)
      const result = await agent.execute({}, payload)
      return NextResponse.json({ queued: false, result })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('agent_queue')
    .insert({ job_type: jobType, payload, priority: 3 })
    .select('id')
    .single()

  return NextResponse.json({ queued: true, jobId: data?.id })
}

// GET: process one job from queue (for cron/polling)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const appSecret = process.env.APP_SECRET
  if (appSecret && appSecret !== 'your_random_secret_32_chars_min' && authHeader !== `Bearer ${appSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  const { data: jobs } = await supabase.rpc('claim_queue_jobs', {
    p_limit: 1,
    p_worker_id: `api_worker_${Date.now()}`,
  })

  if (!jobs || jobs.length === 0) {
    return NextResponse.json({ processed: 0, message: 'Queue empty' })
  }

  const job = jobs[0] as { id: string; job_type: string; payload: Record<string, unknown> }

  try {
    const agent = AgentFactory.create(job.job_type)
    const result = await agent.execute({}, job.payload)

    await supabase
      .from('agent_queue')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', job.id)

    return NextResponse.json({ processed: 1, jobId: job.id, result })
  } catch (err) {
    await supabase
      .from('agent_queue')
      .update({ status: 'failed', failed_at: new Date().toISOString(), error_log: { error: String(err) } })
      .eq('id', job.id)

    return NextResponse.json({ processed: 1, jobId: job.id, error: String(err) }, { status: 500 })
  }
}
