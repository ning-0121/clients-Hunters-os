/**
 * Email Send Throttle
 * Ramp-up schedule to protect domain reputation:
 *   Days 1-7:   20/day
 *   Days 8-14:  40/day
 *   Days 15-21: 80/day
 *   Days 22+:   150/day
 *
 * Also enforces minimum delay between sends (randomized 90-210s)
 */

import { createDirectClient } from '@/lib/supabase/server'

const RAMP_SCHEDULE = [
  { maxDays: 7,   limit: 20  },
  { maxDays: 14,  limit: 40  },
  { maxDays: 21,  limit: 80  },
  { maxDays: 999, limit: 150 },
]

export interface ThrottleResult {
  allowed: boolean
  reason?: string
  sentToday: number
  dailyLimit: number
  rampDay: number
  nextAllowedAt?: Date
}

export async function checkSendThrottle(): Promise<ThrottleResult> {
  const supabase = createDirectClient()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  // Count sent today
  const { count: sentToday } = await supabase
    .from('email_send_log')
    .select('id', { count: 'exact', head: true })
    .gte('sent_at', todayStart.toISOString())

  // Get first send date to determine ramp day
  const { data: firstSend } = await supabase
    .from('email_send_log')
    .select('sent_at')
    .order('sent_at', { ascending: true })
    .limit(1)
    .single()

  const rampStartDate = firstSend?.sent_at ? new Date(firstSend.sent_at) : new Date()
  const rampDay = Math.floor((Date.now() - rampStartDate.getTime()) / 86_400_000) + 1

  const dailyLimit = RAMP_SCHEDULE.find(s => rampDay <= s.maxDays)?.limit ?? 150

  const count = sentToday ?? 0

  if (count >= dailyLimit) {
    const tomorrow = new Date(todayStart)
    tomorrow.setDate(tomorrow.getDate() + 1)
    return {
      allowed: false,
      reason: `Daily limit reached (${count}/${dailyLimit}). Resets at midnight.`,
      sentToday: count,
      dailyLimit,
      rampDay,
      nextAllowedAt: tomorrow,
    }
  }

  // Check minimum delay since last send (randomized 90-210s)
  const { data: lastSend } = await supabase
    .from('email_send_log')
    .select('sent_at')
    .order('sent_at', { ascending: false })
    .limit(1)
    .single()

  if (lastSend?.sent_at) {
    // Fixed minimum delay — deterministic so re-queue scheduling is reliable
    const MIN_DELAY_MS = 120_000  // 2 minutes between sends
    const lastAt  = new Date(lastSend.sent_at).getTime()
    const elapsed = Date.now() - lastAt
    if (elapsed < MIN_DELAY_MS) {
      const waitMs = Math.ceil(MIN_DELAY_MS - elapsed)
      return {
        allowed: false,
        reason: `Rate limit: wait ${Math.ceil(waitMs / 1000)}s between sends`,
        sentToday: count,
        dailyLimit,
        rampDay,
        nextAllowedAt: new Date(lastAt + MIN_DELAY_MS),
      }
    }
  }

  return { allowed: true, sentToday: count, dailyLimit, rampDay }
}

export async function recordSend(params: {
  toEmail: string
  companyId?: string
  logId?: string
  method?: string
}): Promise<void> {
  const supabase = createDirectClient()
  await supabase.from('email_send_log').insert({
    to_email: params.toEmail,
    company_id: params.companyId,
    log_id: params.logId,
    method: params.method ?? 'gmail',
    sent_at: new Date().toISOString(),
  })
}

/** Get stats for display */
export async function getSendStats(): Promise<{
  sentToday: number
  sent7d: number
  sent30d: number
  dailyLimit: number
  rampDay: number
}> {
  const supabase = createDirectClient()
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const d7 = new Date(Date.now() - 7 * 86_400_000)
  const d30 = new Date(Date.now() - 30 * 86_400_000)

  const [{ count: c1 }, { count: c7 }, { count: c30 }, { data: firstSend }] = await Promise.all([
    supabase.from('email_send_log').select('id', { count: 'exact', head: true }).gte('sent_at', todayStart.toISOString()),
    supabase.from('email_send_log').select('id', { count: 'exact', head: true }).gte('sent_at', d7.toISOString()),
    supabase.from('email_send_log').select('id', { count: 'exact', head: true }).gte('sent_at', d30.toISOString()),
    supabase.from('email_send_log').select('sent_at').order('sent_at', { ascending: true }).limit(1).maybeSingle(),
  ])

  const rampStart = firstSend?.sent_at ? new Date(firstSend.sent_at) : new Date()
  const rampDay = Math.floor((Date.now() - rampStart.getTime()) / 86_400_000) + 1
  const dailyLimit = RAMP_SCHEDULE.find(s => rampDay <= s.maxDays)?.limit ?? 150

  return {
    sentToday: c1 ?? 0,
    sent7d: c7 ?? 0,
    sent30d: c30 ?? 0,
    dailyLimit,
    rampDay,
  }
}
