/**
 * Reply scanner, serverless edition. Vercel Cron hits this every 5 minutes:
 * one Gmail IMAP scan + reply processing. Best-effort — if IMAP can't connect
 * from the serverless runtime it returns gracefully and the queue cron is
 * unaffected.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { runReplyScanOnce } from '@/workers/reply-scanner'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  try {
    const saved = await runReplyScanOnce()
    return NextResponse.json({ ok: true, replies: saved })
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 })
  }
}
