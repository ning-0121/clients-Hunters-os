/**
 * Daily auto-discovery. Vercel Cron hits this once a day; if enabled in settings,
 * it ENQUEUES a run_discovery job per selected segment (split of the daily quota).
 * The per-minute process-queue cron then actually runs them. Self-protected by CRON_SECRET.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { createDirectClient } from '@/lib/supabase/server'
import { getAppConfig, segmentToDiscoveryParams } from '@/lib/config'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const cfg = await getAppConfig()
  if (!cfg.autoDiscoveryEnabled || cfg.segments.length === 0) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'auto-discovery disabled' })
  }

  const perSegment = Math.max(1, Math.round(cfg.dailyQuota / cfg.segments.length))
  const sb = createDirectClient()
  const jobs = cfg.segments.map((seg) => ({
    job_type: 'run_discovery',
    payload: segmentToDiscoveryParams(seg, perSegment),
    priority: 5,
  }))
  await sb.from('agent_queue').insert(jobs)

  return NextResponse.json({ ok: true, enqueued: jobs.length, perSegment, segments: cfg.segments })
}
