/**
 * Domain bounce-rate guardrail (deliverability P3).
 *
 * A high bounce rate is the fastest way to wreck a sending domain's reputation
 * and get everything routed to spam. This computes the recent bounce rate from
 * outreach_logs and, once there's enough volume, signals a send PAUSE so the team
 * cleans the list / fixes auth before continuing.
 */
import type { createServiceClient } from '@/lib/supabase/server'

export const WINDOW_DAYS = 14
export const MIN_VOLUME = 20        // need enough recent sends to judge a rate
export const PAUSE_THRESHOLD = 0.08 // 8%+ bounce rate → pause

export interface BounceHealth {
  sent: number          // total delivery attempts in window (sent + bounced)
  bounced: number
  rate: number          // 0..1
  paused: boolean
  reason?: string
}

/** Pure verdict: pause only when volume is meaningful AND the bounce rate is high. */
export function bounceVerdict(sent: number, bounced: number): BounceHealth {
  const rate = sent > 0 ? bounced / sent : 0
  const paused = sent >= MIN_VOLUME && rate >= PAUSE_THRESHOLD
  return {
    sent, bounced, rate, paused,
    reason: paused
      ? `近 ${WINDOW_DAYS} 天退信率 ${(rate * 100).toFixed(1)}% ≥ ${PAUSE_THRESHOLD * 100}%（${bounced}/${sent}）→ 暂停发送，先清洗列表 / 核对 SPF·DKIM·DMARC`
      : undefined,
  }
}

export async function checkBounceHealth(
  sb: Awaited<ReturnType<typeof createServiceClient>>,
): Promise<BounceHealth> {
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
  const base = sb.from('outreach_logs').select('*', { count: 'exact', head: true })
    .eq('direction', 'outbound').gte('created_at', cutoff)

  const [{ count: attempts }, { count: bounced }] = await Promise.all([
    base.in('status', ['sent', 'bounced']),
    sb.from('outreach_logs').select('*', { count: 'exact', head: true })
      .eq('direction', 'outbound').gte('created_at', cutoff).eq('status', 'bounced'),
  ])

  return bounceVerdict(attempts ?? 0, bounced ?? 0)
}
