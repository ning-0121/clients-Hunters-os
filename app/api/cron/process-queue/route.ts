/**
 * Always-on worker, serverless edition.
 *
 * Vercel Cron hits this every minute (Pro plan). It drains the agent_queue by
 * repeatedly running the existing worker cycle until the queue is empty or the
 * time budget runs out — so enrich / score / tier / report / followup jobs get
 * processed without a long-running worker process.
 *
 * Auth: Vercel automatically sends `Authorization: Bearer ${CRON_SECRET}` when
 * CRON_SECRET is set. Manual calls must include the same header.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { runWorkerCycle } from '@/workers/queue-worker'
import { createDirectClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 300 // Vercel Pro — up to 5 min per invocation

const TIME_BUDGET_MS = 270_000 // stop claiming new work after ~4.5 min

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true // not configured — allow (dev)
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function heartbeat(status: string, processed: number) {
  try {
    const sb = createDirectClient()
    await sb.from('worker_heartbeats').upsert(
      { worker_id: 'vercel_cron_queue', worker_type: 'vercel_cron', status,
        jobs_processed: processed, last_job_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'worker_id' },
    )
  } catch { /* heartbeat is best-effort */ }
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const start = Date.now()
  let total = 0
  let cycles = 0

  // Keep running cycles while there is work and time remains.
  while (Date.now() - start < TIME_BUDGET_MS) {
    let processed = 0
    try {
      processed = await runWorkerCycle()
    } catch (err) {
      await heartbeat('error', total)
      return NextResponse.json({ ok: false, error: String(err), processed: total, cycles }, { status: 500 })
    }
    total += processed
    cycles++
    if (processed === 0) break // queue drained
  }

  await heartbeat('running', total)
  return NextResponse.json({ ok: true, processed: total, cycles, ms: Date.now() - start })
}
