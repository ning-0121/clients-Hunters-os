/**
 * Reply Scanner Worker v2
 *
 * Polls Gmail INBOX via IMAP every 5 minutes.
 * Matches incoming emails to sent outreach_logs by In-Reply-To / References headers.
 *
 * On match:
 *   1. Creates reply_event record
 *   2. Updates outreach_log (replied_at, sentiment, intent)
 *   3. Updates conversation (status, reply_count, last_sentiment, last_intent)
 *   4. Advances company pipeline stage based on reply intent
 *      · want_meeting  → qualified
 *      · want_sample   → qualified
 *      · want_quote    → qualified
 *      · positive      → engaged
 *      · not_interested → closed_lost
 *   5. Cancels pending followup_runs for the company
 */

import { ImapFlow, type ImapFlowOptions } from 'imapflow'
import { createDirectClient } from '@/lib/supabase/server'
import { notify } from '@/lib/notify/notifier'

const SCAN_INTERVAL_MS   = 5 * 60 * 1000
const HEARTBEAT_INTERVAL = 60 * 1000
const WORKER_ID = `reply_scanner_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`

let _heartbeatRow:  string | null = null
let _scansRun     = 0
let _repliesFound = 0
let _running      = true

// ── Heartbeat ─────────────────────────────────────────────────────────────────

async function initHeartbeat(): Promise<void> {
  const sb = createDirectClient()
  const { data } = await sb.from('worker_heartbeats')
    .upsert(
      { worker_id: WORKER_ID, worker_type: 'reply_scanner', status: 'running', updated_at: new Date().toISOString() },
      { onConflict: 'worker_id' }
    )
    .select('id').single()
  _heartbeatRow = data?.id ?? null
}

async function sendHeartbeat(status = 'running', err?: string): Promise<void> {
  if (!_heartbeatRow) return
  const sb = createDirectClient()
  await sb.from('worker_heartbeats').update({
    status,
    jobs_processed: _repliesFound,
    error_message:  err ?? null,
    metadata:       { scans_run: _scansRun },
    updated_at:     new Date().toISOString(),
  }).eq('id', _heartbeatRow)
}

// ── IMAP config ───────────────────────────────────────────────────────────────

function getImapConfig(): ImapFlowOptions {
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!user || !pass) throw new Error('GMAIL_USER and GMAIL_APP_PASSWORD must be set')
  return {
    host:   'imap.gmail.com',
    port:   993,
    secure: true,
    auth:   { user, pass },
    logger: false as const,
    // TLS cert verification must stay enabled for gmail.com
    // Do NOT set rejectUnauthorized: false in production
  }
}

// ── Parsed email shape ────────────────────────────────────────────────────────

interface ParsedEmail {
  messageId:  string
  inReplyTo:  string | null
  references: string[]
  from:       string
  subject:    string
  body:       string
  date:       Date
}

// ── UID watermark (persisted in worker_heartbeats.metadata) ──────────────────

async function getLastSeenUid(): Promise<number> {
  if (!_heartbeatRow) return 0
  const sb = createDirectClient()
  const { data } = await sb.from('worker_heartbeats').select('metadata').eq('id', _heartbeatRow).single()
  return (data?.metadata as Record<string, unknown>)?.last_uid as number ?? 0
}

async function saveLastSeenUid(uid: number): Promise<void> {
  if (!_heartbeatRow) return
  const sb = createDirectClient()
  await sb.from('worker_heartbeats').update({
    metadata:   { scans_run: _scansRun, last_uid: uid },
    updated_at: new Date().toISOString(),
  }).eq('id', _heartbeatRow)
}

// ── Scan inbox ────────────────────────────────────────────────────────────────

async function scanInbox(): Promise<ParsedEmail[]> {
  const client = new ImapFlow(getImapConfig())
  await client.connect()
  const results: ParsedEmail[] = []

  try {
    const since      = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    const lastUid    = await getLastSeenUid()
    const lock       = await client.getMailboxLock('INBOX')
    let   maxUidSeen = lastUid

    try {
      const allUids = await client.search({ since }, { uid: true })
      if (!allUids || allUids.length === 0) return []

      // Only fetch UIDs we haven't processed yet (watermark), up to 100 at a time
      const newUids = lastUid > 0 ? allUids.filter(u => u > lastUid) : allUids.slice(-100)
      if (newUids.length === 0) return []

      for await (const msg of client.fetch(
        newUids,
        { envelope: true, source: true },
        { uid: true }
      )) {
        try {
          if (!msg.envelope) continue
          const env = msg.envelope

          // Track highest UID seen for watermark
          if (typeof msg.uid === 'number' && msg.uid > maxUidSeen) maxUidSeen = msg.uid

          const messageId = env.messageId ?? ''
          const from      = env.from?.[0]?.address ?? ''
          const subject   = env.subject ?? ''
          const date      = env.date ?? new Date()

          const raw           = msg.source?.toString('utf8') ?? ''
          const headerSection = raw.split(/\r?\n\r?\n/)[0] ?? ''

          const inReplyTo  = headerSection.match(/^In-Reply-To:\s*(.+)$/im)?.[1]?.trim() ?? null
          const refLine    = headerSection.match(/^References:\s*([\s\S]+?)(?=^\S)/im)?.[1] ?? ''
          const references = refLine.split(/\s+/).map(s => s.trim()).filter(Boolean)

          if (!inReplyTo && references.length === 0) continue

          // Strip quoted reply history before classification to avoid false-positive intent
          const rawBody = raw.split(/\r?\n\r?\n/).slice(1).join('\n')
          const body = rawBody
            .replace(/^>.*$/gm, '')                         // lines starting with >
            .replace(/^On .{0,120}wrote:$/gm, '')           // "On ... wrote:"
            .replace(/^-{3,}.*$/gm, '')                     // --- dividers
            .replace(/^From:.*$/gim, '')                    // forwarded From: lines
            .replace(/\n{3,}/g, '\n\n')                     // collapse blank lines
            .trim()
            .slice(0, 2000)
          results.push({ messageId, inReplyTo, references, from, subject, body, date })
        } catch {
          continue
        }
      }
    } finally {
      lock.release()
      // Persist watermark so next scan only fetches newer UIDs
      if (maxUidSeen > lastUid) await saveLastSeenUid(maxUidSeen)
    }
  } finally {
    await client.logout()
  }

  return results
}

// ── Sentiment + intent classifiers ────────────────────────────────────────────

function classifySentiment(body: string): string {
  const lower = body.toLowerCase()
  const neg = ['not interested','unsubscribe','remove me','stop emailing','no thanks','wrong person']
  const pos = ['interested','tell me more','sounds good','let\'s talk','schedule','would love',
                'send catalog','pricing','sample','quote','love to','can we']
  if (neg.some(w => lower.includes(w))) return 'not_interested'
  if (pos.some(w => lower.includes(w))) return 'positive'
  return 'neutral'
}

function classifyIntent(body: string): string {
  const lower = body.toLowerCase()
  if (lower.includes('sample'))                                                    return 'want_sample'
  if (lower.includes('catalog') || lower.includes('catalogue'))                   return 'want_catalog'
  if (lower.includes('price') || lower.includes('quote') || lower.includes('cost')) return 'want_quote'
  if (lower.includes('call') || lower.includes('meeting') || lower.includes('zoom') ||
      lower.includes('schedule') || lower.includes('chat'))                       return 'want_meeting'
  if (lower.includes('not interested') || lower.includes('unsubscribe'))          return 'not_interested'
  if (lower.includes('wrong person'))                                              return 'wrong_person'
  return 'general_reply'
}

/**
 * Map reply intent + sentiment to the correct pipeline status.
 * Only advance — never move backward.
 */
function pipelineStatusForReply(intent: string, sentiment: string): {
  status: string | null
  advanceOnly: boolean
} {
  if (sentiment === 'not_interested' || intent === 'not_interested') {
    return { status: 'closed_lost', advanceOnly: false }  // can always close
  }
  if (intent === 'want_meeting' || intent === 'want_sample' || intent === 'want_quote') {
    return { status: 'qualified', advanceOnly: true }
  }
  if (sentiment === 'positive' || intent === 'want_catalog' || intent === 'general_reply') {
    return { status: 'engaged', advanceOnly: true }
  }
  return { status: null, advanceOnly: true }
}

// ── Match replies to sent emails ──────────────────────────────────────────────

async function processReplies(emails: ParsedEmail[]): Promise<number> {
  if (emails.length === 0) return 0
  const sb = createDirectClient()
  let saved = 0

  const { data: sentLogs } = await sb
    .from('outreach_logs')
    .select('id, company_id, contact_id, gmail_message_id, subject')
    .eq('status', 'sent')
    .not('gmail_message_id', 'is', null)

  if (!sentLogs || sentLogs.length === 0) return 0
  const sentMap = new Map(sentLogs.map(l => [l.gmail_message_id as string, l]))

  for (const email of emails) {
    // Skip already-processed replies
    const { data: existing } = await sb
      .from('reply_events')
      .select('id')
      .eq('gmail_message_id', email.messageId)
      .maybeSingle()
    if (existing) continue

    // Match to a sent email via In-Reply-To or References chain
    let matchedLog = email.inReplyTo ? sentMap.get(email.inReplyTo) : null
    if (!matchedLog) {
      for (const ref of email.references) {
        if (sentMap.has(ref)) { matchedLog = sentMap.get(ref)!; break }
      }
    }
    if (!matchedLog) continue

    const sentiment = classifySentiment(email.body)
    const intent    = classifyIntent(email.body)
    const now       = new Date().toISOString()

    // 1. Upsert conversation (or get existing)
    const convUpsert = await sb.from('conversations').upsert(
      {
        company_id:        matchedLog.company_id,
        contact_id:        matchedLog.contact_id,
        first_outreach_id: matchedLog.id,
        status:            sentiment === 'not_interested' ? 'lost' : 'replied',
        thread_subject:    email.subject,
        last_activity_at:  email.date.toISOString(),
        last_sentiment:    sentiment,
        last_intent:       intent,
        updated_at:        now,
      },
      { onConflict: 'company_id' }
    ).select('id').single()

    const conversationId = convUpsert.data?.id ?? null

    // Increment reply_count via simple read-then-write (no RPC needed)
    if (conversationId) {
      try {
        const { data: conv } = await sb.from('conversations').select('reply_count').eq('id', conversationId).single()
        await sb.from('conversations').update({ reply_count: (conv?.reply_count ?? 0) + 1 }).eq('id', conversationId)
      } catch {}
    }

    // 2. Create reply_event
    const replyInsert = await sb.from('reply_events').insert({
      outreach_log_id:  matchedLog.id,
      company_id:       matchedLog.company_id,
      contact_id:       matchedLog.contact_id,
      conversation_id:  conversationId,
      gmail_message_id: email.messageId,
      gmail_thread_id:  null,  // Thread ID not available from standard IMAP envelope; use message ID for matching
      from_email:       email.from,
      reply_subject:    email.subject,
      reply_body:       email.body,
      reply_sentiment:  sentiment,
      reply_intent:     intent,
      received_at:      email.date.toISOString(),
    }).select('id').single()
    const replyEventId = replyInsert.data?.id ?? null

    // 3. Update outreach_log
    await sb.from('outreach_logs').update({
      replied_at:      email.date.toISOString(),
      reply_content:   email.body.slice(0, 500),
      reply_sentiment: sentiment,
      reply_intent:    intent,
    }).eq('id', matchedLog.id)

    // 4. Advance company pipeline stage
    if (matchedLog.company_id) {
      const { status: newStatus, advanceOnly } = pipelineStatusForReply(intent, sentiment)

      if (newStatus) {
        if (advanceOnly) {
          // Only move forward in pipeline — don't downgrade an already-qualified lead
          const STAGE_ORDER = ['raw','enriched','scored','outreach','engaged','qualified','closed_won','closed_lost']
          const { data: co } = await sb.from('companies').select('status').eq('id', matchedLog.company_id).single()
          const currentIdx = STAGE_ORDER.indexOf(co?.status ?? 'outreach')
          const newIdx     = STAGE_ORDER.indexOf(newStatus)
          if (newIdx > currentIdx) {
            await sb.from('companies').update({
              status:           newStatus,
              last_activity_at: now,
              updated_at:       now,
            }).eq('id', matchedLog.company_id)
          }
        } else {
          // Force status (e.g. closed_lost)
          await sb.from('companies').update({
            status:           newStatus,
            last_activity_at: now,
            updated_at:       now,
          }).eq('id', matchedLog.company_id)
        }
      }
    }

    // 5. Cancel pending follow-up steps (scheduled OR queued but not yet sent)
    await sb.from('followup_runs')
      .update({ status: 'replied', updated_at: now })
      .eq('company_id', matchedLog.company_id)
      .in('status', ['scheduled', 'queued'])

    // 6. Create a task so a salesperson actually acts on this reply (post-reply workflow)
    if (sentiment !== 'not_interested' && intent !== 'not_interested' && intent !== 'wrong_person') {
      const { taskType, priority, title, suggestion } = taskForReply(intent, sentiment, email.subject)
      await sb.from('tasks').insert({
        company_id:       matchedLog.company_id,
        contact_id:       matchedLog.contact_id,
        conversation_id:  conversationId,
        reply_event_id:   replyEventId,
        task_type:        taskType,
        priority,
        title,
        detail:           email.body.slice(0, 400),
        suggested_action: suggestion,
        status:           'open',
        source:           'ai',
        due_at:           now,  // actionable now
      })

      // 7. Notify the team immediately on high-value replies (A/B grade, or strong intent)
      const { data: co } = await sb.from('companies')
        .select('name, grade').eq('id', matchedLog.company_id).single()
      const hotIntent = ['want_meeting', 'want_sample', 'want_quote'].includes(intent)
      const isHighGrade = co?.grade === 'A' || co?.grade === 'B'
      if (hotIntent || isHighGrade) {
        await notify({
          title: `${co?.name ?? 'A lead'} replied — ${intent.replace(/_/g, ' ')}`,
          body:  `${co?.grade ? `Grade ${co.grade} · ` : ''}${sentiment} · ${email.from}\n"${email.body.slice(0, 160)}"`,
          url:   `/companies/${matchedLog.company_id}`,
          priority: (isHighGrade && hotIntent) ? 'high' : 'normal',
        })
      }
    }

    console.log(`[ReplyScanner] 📩 ${email.from} → ${sentiment} / ${intent}`)
    saved++
    _repliesFound++
  }

  return saved
}

/** Decide what task to create based on the reply intent. */
function taskForReply(intent: string, sentiment: string, subject: string): {
  taskType: string; priority: number; title: string; suggestion: string
} {
  const subj = subject ? ` re: "${subject.slice(0, 40)}"` : ''
  if (intent === 'want_meeting') {
    return { taskType: 'meeting_prep', priority: 1,
      title: `🗓️ Wants a meeting${subj}`,
      suggestion: 'Reply with 2-3 time slots (their timezone) + a Calendly link. Confirm what they want to discuss.' }
  }
  if (intent === 'want_sample') {
    return { taskType: 'reply_needed', priority: 1,
      title: `📦 Wants a sample${subj}`,
      suggestion: 'Confirm styles, quantity, and shipping address. Then create a Sample request to hand off to production.' }
  }
  if (intent === 'want_quote') {
    return { taskType: 'quote_followup', priority: 2,
      title: `💰 Wants a quote${subj}`,
      suggestion: 'Ask for target quantity, fabric, and any customization. Then prepare a quote.' }
  }
  if (intent === 'want_catalog') {
    return { taskType: 'reply_needed', priority: 3,
      title: `📖 Wants the catalog${subj}`,
      suggestion: 'Send the relevant catalog/lookbook and ask which categories interest them most.' }
  }
  return { taskType: 'reply_needed', priority: 3,
    title: `✉️ Replied${subj}`,
    suggestion: 'Read the reply and respond appropriately. Move the conversation toward sample or quote.' }
}

// ── Entry point ───────────────────────────────────────────────────────────────

export async function startReplyScanner(): Promise<void> {
  try {
    getImapConfig()
  } catch (err) {
    console.warn(`[ReplyScanner] Disabled (IMAP not configured): ${err}`)
    return
  }

  console.log(`[ReplyScanner] 🔍 Starting ${WORKER_ID}`)
  await initHeartbeat()

  const hbInterval = setInterval(() => { sendHeartbeat('running').catch(() => {}) }, HEARTBEAT_INTERVAL)

  process.on('SIGTERM', () => { _running = false })
  process.on('SIGINT',  () => { _running = false })

  while (_running) {
    try {
      const emails = await scanInbox()
      const found  = await processReplies(emails)
      _scansRun++
      if (found > 0 || emails.length > 0) {
        console.log(`[ReplyScanner] ✓ Scan #${_scansRun}: ${emails.length} emails, ${found} new replies`)
      }
    } catch (err) {
      console.error('[ReplyScanner] Error:', err)
      await sendHeartbeat('error', String(err))
    }

    await new Promise<void>((resolve) => {
      const t     = setTimeout(resolve, SCAN_INTERVAL_MS)
      const check = setInterval(() => {
        if (!_running) { clearTimeout(t); clearInterval(check); resolve() }
      }, 1000)
    })
  }

  clearInterval(hbInterval)
  await sendHeartbeat('stopped')
  console.log('[ReplyScanner] Stopped.')
}
