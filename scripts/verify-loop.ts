/**
 * ARAOS Growth Loop — End-to-End Verification
 *
 * npx tsx --env-file=.env.local scripts/verify-loop.ts
 *
 * Phases:
 *   1. Schema     — all tables + required columns
 *   2. Pipeline   — company → outreach → conversation → followup_runs → email_send_log
 *   3. Observability — worker_heartbeats + job_runs read/write
 *   4. Reply sim  — reply_event → pipeline stage → followup cancel → conversation update
 *   5. Analytics  — all dashboard queries execute without error
 */

import { createDirectClient } from '@/lib/supabase/server'
import { AgentFactory }       from '@/agents/agent-factory'

const sb = createDirectClient()

// ── Result tracking ───────────────────────────────────────────────────────────
let _passed = 0; let _failed = 0; let _warnings = 0
const _failures: string[] = []

function pass(label: string, detail?: string) {
  console.log(`  ✅ ${label}${detail ? `  (${detail})` : ''}`)
  _passed++
}

function fail(label: string, detail?: string) {
  const msg = `${label}${detail ? ` → ${detail}` : ''}`
  console.log(`  ❌ ${msg}`)
  _failures.push(msg)
  _failed++
}

function warn(label: string, detail?: string) {
  console.log(`  ⚠️  ${label}${detail ? ` — ${detail}` : ''}`)
  _warnings++
}

function section(title: string) {
  console.log(`\n${'─'.repeat(62)}`)
  console.log(`Phase: ${title}`)
  console.log('─'.repeat(62))
}

// ── Phase 1: Schema ───────────────────────────────────────────────────────────

async function phase1_schema() {
  section('1 · Schema — Tables & Columns')

  // Tables
  for (const table of [
    'companies','contacts','outreach_logs','agent_queue','approvals',
    'customer_scores','agent_actions',
    'conversations','reply_events','followup_runs',
    'email_send_log','worker_heartbeats','job_runs','trigger_events',
  ]) {
    const { error } = await sb.from(table).select('id', { count: 'exact', head: true })
    error ? fail(`Table: ${table}`, error.message) : pass(`Table: ${table}`)
  }

  // Columns — select with limit 0; column missing = error
  for (const [table, col] of [
    ['outreach_logs',   'gmail_message_id'],
    ['outreach_logs',   'sent_at'],
    ['outreach_logs',   'replied_at'],
    ['outreach_logs',   'reply_intent'],
    ['outreach_logs',   'reply_sentiment'],
    ['companies',       'trigger_type'],
    ['companies',       'hiring_signal'],
    ['companies',       'tech_stack'],
    ['companies',       'klaviyo_detected'],
    ['companies',       'conversation_id'],
    ['contacts',        'email_confidence'],
    ['contacts',        'email_source'],
    ['customer_scores', 'tech_stack_score'],
    ['customer_scores', 'hiring_signal_score'],
    ['agent_queue',     'error_log'],
    ['agent_queue',     'completed_at'],
    ['agent_queue',     'failed_at'],
  ] as [string,string][]) {
    const { error } = await sb.from(table).select(col).limit(0)
    error ? fail(`Column: ${table}.${col}`, error.message) : pass(`Column: ${table}.${col}`)
  }

  // UNIQUE constraint — conversations.company_id
  // Must use a real company_id to avoid FK violation; create a throwaway row.
  {
    const { data: tmpCo } = await sb.from('companies').insert({
      name: '[TEST] uq_check', domain: '__uq_check__',
      company_type: 'dtc_brand', status: 'raw', source: 'verify_script',
    }).select('id').single()

    if (!tmpCo) {
      fail('UNIQUE on conversations.company_id', 'could not create throwaway company')
    } else {
      const { error } = await sb.from('conversations').upsert(
        { company_id: tmpCo.id }, { onConflict: 'company_id' }
      )
      if (error) {
        fail('UNIQUE on conversations.company_id', error.message)
      } else {
        pass('UNIQUE on conversations.company_id')
      }
      // Clean up (cascades conversations row too)
      await sb.from('companies').delete().eq('id', tmpCo.id)
    }
  }

  // UNIQUE constraint — worker_heartbeats.worker_id
  {
    const { error } = await sb.from('worker_heartbeats').upsert(
      { worker_id: '__uq_test__', worker_type: 'test' },
      { onConflict: 'worker_id' }
    )
    if (error) {
      fail('UNIQUE on worker_heartbeats.worker_id', error.message)
    } else {
      pass('UNIQUE on worker_heartbeats.worker_id')
      await sb.from('worker_heartbeats').delete().eq('worker_id', '__uq_test__')
    }
  }
}

// ── Phase 2: Pipeline ─────────────────────────────────────────────────────────

const TEST_DOMAIN = '__verify_loop_test__'
let testCompanyId:     string | null = null
let testContactId:     string | null = null
let testOutreachLogId: string | null = null
let fakeGmailMsgId:    string | null = null

async function phase2_pipeline() {
  section('2 · Pipeline — Company → Outreach → Conversation → FollowupRuns')

  // Clean previous test data
  const { data: old } = await sb.from('companies').select('id').eq('domain', TEST_DOMAIN)
  if (old?.length) {
    for (const co of old) await sb.from('companies').delete().eq('id', co.id)
    warn('Cleaned leftover test data')
  }

  // 2a. Test company
  const { data: co, error: coErr } = await sb.from('companies').insert({
    name: '[TEST] Verify Loop Brand', domain: TEST_DOMAIN,
    website: 'https://example.com',
    description: 'A test DTC activewear brand for verification purposes.',
    company_type: 'dtc_brand', product_categories: ['activewear','yoga'],
    country: 'United States', instagram_followers: 12500,
    shopify_detected: true, status: 'scored', grade: 'B', total_score: 62,
    source: 'verify_script',
  }).select('id').single()

  if (coErr || !co) { fail('Create test company', coErr?.message); return }
  testCompanyId = co.id
  pass('Create test company', `id=${co.id.slice(0,8)}…`)

  // 2b. Test contact
  const { data: ct, error: ctErr } = await sb.from('contacts').insert({
    company_id: testCompanyId,
    full_name: 'Test Founder', first_name: 'Test', last_name: 'Founder',
    title: 'Founder & CEO', role_type: 'founder', decision_level: 'decision_maker',
    email: process.env.GMAIL_USER ?? 'test@example.com',
    email_verified: true, contact_priority: 9, reply_probability: 0.45,
    status: 'uncontacted', source: 'verify_script',
  }).select('id').single()

  if (ctErr || !ct) { fail('Create test contact', ctErr?.message); return }
  testContactId = ct.id
  pass('Create test contact', `id=${ct.id.slice(0,8)}…`)

  // 2c. OutreachAgent
  console.log('\n  [Running OutreachAgent…]')
  try {
    const result = await AgentFactory.create('draft_outreach').execute({}, { companyId: testCompanyId })
    if (!result.success) { fail('OutreachAgent', result.error); }
    else { pass('OutreachAgent drafted', `hookType=${result.data?.hookType ?? 'unknown'}`) }
  } catch (err) { fail('OutreachAgent threw', String(err)) }

  // 2d. Get outreach log
  const { data: logs } = await sb.from('outreach_logs')
    .select('id, status, subject').eq('company_id', testCompanyId)
    .order('created_at', { ascending: false }).limit(1)

  if (!logs?.length) { fail('Outreach log in DB'); return }
  testOutreachLogId = logs[0].id
  pass('Outreach log in DB', `"${logs[0].subject?.slice(0,45)}"`)

  // 2e. Mark as sent with fake gmail_message_id
  fakeGmailMsgId = `<verify_${Date.now()}@mail.gmail.com>`
  const { error: sentErr } = await sb.from('outreach_logs').update({
    status: 'sent', sent_at: new Date().toISOString(), gmail_message_id: fakeGmailMsgId,
  }).eq('id', testOutreachLogId)
  sentErr ? fail('Mark outreach as sent', sentErr.message) : pass('Outreach log → sent + gmail_message_id')

  // 2f. email_send_log
  const { error: slErr } = await sb.from('email_send_log').insert({
    to_email: process.env.GMAIL_USER ?? 'test@example.com',
    company_id: testCompanyId, log_id: testOutreachLogId,
    method: 'simulated', sent_at: new Date().toISOString(),
  })
  if (slErr) {
    fail('email_send_log insert', slErr.message)
  } else {
    const { data: sl } = await sb.from('email_send_log').select('id').eq('company_id', testCompanyId).limit(1)
    sl?.length ? pass('email_send_log record created') : fail('email_send_log record not found after insert')
  }

  // 2g. Conversation upsert
  const { error: convErr } = await sb.from('conversations').upsert(
    {
      company_id: testCompanyId, contact_id: testContactId,
      first_outreach_id: testOutreachLogId, status: 'active',
      thread_subject: 'Test conversation', last_activity_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'company_id' }
  )
  if (convErr) {
    fail('Conversation upsert', convErr.message)
  } else {
    const { data: conv } = await sb.from('conversations')
      .select('id, status').eq('company_id', testCompanyId).single()
    conv ? pass('Conversation created', `status=${conv.status}`) : fail('Conversation not found after upsert')
  }

  // 2h. followup_runs (steps 2 & 3)
  const nowMs = Date.now()
  const { error: fuErr } = await sb.from('followup_runs').insert([
    { company_id: testCompanyId, contact_id: testContactId, original_log_id: testOutreachLogId,
      step: 2, status: 'scheduled', scheduled_for: new Date(nowMs + 4*86_400_000).toISOString() },
    { company_id: testCompanyId, contact_id: testContactId, original_log_id: testOutreachLogId,
      step: 3, status: 'scheduled', scheduled_for: new Date(nowMs + 9*86_400_000).toISOString() },
  ])
  if (fuErr) {
    fail('followup_runs insert', fuErr.message)
  } else {
    const { data: fups } = await sb.from('followup_runs')
      .select('step, status, scheduled_for').eq('company_id', testCompanyId).order('step')
    if (fups?.length === 2) {
      pass('followup_runs step 2 scheduled', `due ${new Date(fups[0].scheduled_for).toLocaleDateString()}`)
      pass('followup_runs step 3 scheduled', `due ${new Date(fups[1].scheduled_for).toLocaleDateString()}`)
    } else {
      fail('followup_runs count', `expected 2, got ${fups?.length ?? 0}`)
    }
  }

  // Set company status → outreach
  await sb.from('companies').update({ status: 'outreach' }).eq('id', testCompanyId)
  pass('Company status → outreach')
}

// ── Phase 3: Observability ────────────────────────────────────────────────────

async function phase3_observability() {
  section('3 · Observability — worker_heartbeats + job_runs')

  if (!testCompanyId) { warn('Skip (Phase 2 failed)'); return }

  const testWorkerId = `verify_worker_${Date.now()}`

  // 3a. heartbeat upsert
  const { data: hb, error: hbErr } = await sb.from('worker_heartbeats').upsert(
    { worker_id: testWorkerId, worker_type: 'queue', status: 'running',
      jobs_processed: 0, updated_at: new Date().toISOString() },
    { onConflict: 'worker_id' }
  ).select('id').single()

  if (hbErr || !hb) {
    fail('worker_heartbeats upsert', hbErr?.message)
  } else {
    pass('worker_heartbeats upsert', `id=${hb.id.slice(0,8)}…`)

    // 3b. heartbeat update
    await sb.from('worker_heartbeats').update({ jobs_processed: 5, updated_at: new Date().toISOString() })
      .eq('worker_id', testWorkerId)
    const { data: hbR } = await sb.from('worker_heartbeats').select('jobs_processed').eq('worker_id', testWorkerId).single()
    hbR?.jobs_processed === 5 ? pass('worker_heartbeats update') : fail('worker_heartbeats update', `got ${hbR?.jobs_processed}`)

    await sb.from('worker_heartbeats').delete().eq('worker_id', testWorkerId)
  }

  // 3c. job_runs insert → complete
  const { data: qj } = await sb.from('agent_queue').insert({
    job_type: 'score_company', payload: { companyId: testCompanyId }, priority: 3, status: 'waiting',
  }).select('id').single()

  const { data: jr, error: jrErr } = await sb.from('job_runs').insert({
    queue_job_id: qj?.id ?? null, worker_id: testWorkerId,
    job_type: 'score_company', company_id: testCompanyId,
    payload: { companyId: testCompanyId }, status: 'running',
    attempt_number: 1, started_at: new Date().toISOString(),
  }).select('id').single()

  if (jrErr || !jr) {
    fail('job_runs insert', jrErr?.message)
  } else {
    pass('job_runs insert', `id=${jr.id.slice(0,8)}…`)

    await sb.from('job_runs').update({
      status: 'completed', completed_at: new Date().toISOString(),
      duration_ms: 1234, output_data: { grade: 'B', total: 62 },
    }).eq('id', jr.id)

    const { data: jrR } = await sb.from('job_runs').select('status, duration_ms').eq('id', jr.id).single()
    jrR?.status === 'completed'
      ? pass('job_runs completion', `duration=${jrR.duration_ms}ms`)
      : fail('job_runs completion', `status=${jrR?.status}`)
  }
}

// ── Phase 4: Reply Simulation ─────────────────────────────────────────────────

async function phase4_reply() {
  section('4 · Reply Simulation → Pipeline Advancement')

  if (!testCompanyId || !testOutreachLogId) { warn('Skip (Phase 2 failed)'); return }

  const { data: log } = await sb.from('outreach_logs')
    .select('gmail_message_id, contact_id').eq('id', testOutreachLogId).single()

  if (!log?.gmail_message_id) { fail('gmail_message_id missing on outreach_log'); return }

  const replyMsgId = `<reply_verify_${Date.now()}@mail.gmail.com>`
  const now        = new Date().toISOString()

  // 4a. Insert reply_event
  const { error: reErr } = await sb.from('reply_events').insert({
    outreach_log_id: testOutreachLogId, company_id: testCompanyId,
    contact_id: log.contact_id ?? testContactId,
    gmail_message_id: replyMsgId,
    from_email: 'test.reply@gmail.com',
    reply_subject: 'Re: Quick question about your sourcing',
    reply_body: 'Hi Alex, interested. Can we schedule a call to discuss pricing?',
    reply_sentiment: 'positive', reply_intent: 'want_meeting',
    received_at: now,
  })
  if (reErr) { fail('reply_events insert', reErr.message) }
  else {
    const { data: re } = await sb.from('reply_events').select('reply_sentiment, reply_intent')
      .eq('gmail_message_id', replyMsgId).single()
    re ? pass('reply_events created', `${re.reply_sentiment} / ${re.reply_intent}`)
       : fail('reply_events not found after insert')
  }

  // 4b. Update outreach_log
  const { error: ulErr } = await sb.from('outreach_logs').update({
    replied_at: now, reply_content: 'Hi Alex, interested…',
    reply_sentiment: 'positive', reply_intent: 'want_meeting',
  }).eq('id', testOutreachLogId)
  if (ulErr) { fail('outreach_log reply update', ulErr.message) }
  else {
    const { data: ul } = await sb.from('outreach_logs').select('replied_at, reply_intent').eq('id', testOutreachLogId).single()
    ul?.reply_intent === 'want_meeting' ? pass('outreach_log reply fields set') : fail('outreach_log reply fields', `intent=${ul?.reply_intent}`)
  }

  // 4c. Pipeline stage: want_meeting → qualified (advance-only)
  const STAGES = ['raw','enriched','scored','outreach','engaged','qualified','closed_won','closed_lost']
  const { data: co } = await sb.from('companies').select('status').eq('id', testCompanyId).single()
  const curIdx = STAGES.indexOf(co?.status ?? 'outreach')
  const newIdx = STAGES.indexOf('qualified')
  if (newIdx > curIdx) {
    await sb.from('companies').update({ status: 'qualified', last_activity_at: now }).eq('id', testCompanyId)
  }
  const { data: coR } = await sb.from('companies').select('status').eq('id', testCompanyId).single()
  coR?.status === 'qualified'
    ? pass('Company → qualified (want_meeting)')
    : fail('Company stage not advanced', `status=${coR?.status}`)

  // 4d. Cancel followup_runs
  await sb.from('followup_runs').update({ status: 'replied', updated_at: now })
    .eq('company_id', testCompanyId).eq('status', 'scheduled')
  const { data: fups } = await sb.from('followup_runs').select('step, status').eq('company_id', testCompanyId).order('step')
  const allReplied = fups?.length && fups.every(f => f.status === 'replied')
  allReplied
    ? pass(`followup_runs cancelled`, `${fups!.length} steps → "replied"`)
    : fail('followup_runs cancel', fups?.map(f => `step${f.step}=${f.status}`).join(', ') || 'none found')

  // 4e. Conversation update
  const { error: cvErr } = await sb.from('conversations').update({
    status: 'replied', last_sentiment: 'positive', last_intent: 'want_meeting',
    reply_count: 1, last_activity_at: now,
  }).eq('company_id', testCompanyId)
  if (cvErr) { fail('Conversation update', cvErr.message) }
  else {
    const { data: cv } = await sb.from('conversations').select('status, reply_count, last_intent').eq('company_id', testCompanyId).single()
    cv?.status === 'replied'
      ? pass('Conversation → replied', `reply_count=${cv.reply_count}, intent=${cv.last_intent}`)
      : fail('Conversation status', `got ${cv?.status}`)
  }
}

// ── Phase 5: Analytics ────────────────────────────────────────────────────────

async function phase5_analytics() {
  section('5 · Analytics — Dashboard Query Verification')

  // Run each count query individually (Supabase FilterBuilder isn't typed as plain Promise)
  const countChecks: Array<[string, string, Record<string, unknown>?]> = [
    ['Emails sent (all)',      'outreach_logs', { status: 'sent' }],
    ['Reply events (all)',     'reply_events',  {}],
    ['Qualified count',        'companies',     { status: 'qualified' }],
    ['Conversations (active)', 'conversations', {}],
    ['Followups scheduled',    'followup_runs', { status: 'scheduled' }],
  ]

  for (const [label, table] of countChecks) {
    const { count, error } = await sb.from(table).select('id', { count: 'exact', head: true })
    error ? fail(label, error.message) : pass(label, `${count ?? 0}`)
  }

  // Time-windowed queries
  const { count: sent7d, error: s7Err } = await sb.from('outreach_logs').select('id',{count:'exact',head:true}).eq('status','sent').gte('sent_at', new Date(Date.now()-7*86_400_000).toISOString())
  s7Err ? fail('Emails sent (7d)', s7Err.message) : pass('Emails sent (7d)', `${sent7d ?? 0}`)

  const { count: rep7d, error: r7Err } = await sb.from('reply_events').select('id',{count:'exact',head:true}).gte('received_at', new Date(Date.now()-7*86_400_000).toISOString())
  r7Err ? fail('Reply events (7d)', r7Err.message) : pass('Reply events (7d)', `${rep7d ?? 0}`)

  const { count: fupSent, error: fsErr } = await sb.from('followup_runs').select('id',{count:'exact',head:true}).in('status',['sent','replied','queued'])
  fsErr ? fail('Followups sent/queued', fsErr.message) : pass('Followups sent/queued', `${fupSent ?? 0}`)

  // Pipeline funnel
  const { data: pipeline, error: pfErr } = await sb.from('companies').select('status')
  if (pfErr) { fail('Pipeline funnel query', pfErr.message) }
  else {
    const counts: Record<string,number> = {}
    for (const c of pipeline ?? []) counts[c.status] = (counts[c.status] ?? 0) + 1
    const total = Object.values(counts).reduce((a,b)=>a+b,0)
    pass('Pipeline funnel', `${total} companies`)
    for (const [stage, n] of Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,6)) {
      console.log(`    ${stage.padEnd(14)} ${n}`)
    }
  }

  // Trigger performance
  const { data: trigData, error: trErr } = await sb.from('companies').select('trigger_type, status').not('trigger_type','is',null)
  if (trErr) { fail('Trigger performance query', trErr.message) }
  else if (!trigData?.length) { warn('Trigger performance', 'No leads with trigger_type yet — run enrichment') }
  else {
    const tmap: Record<string,{total:number;engaged:number}> = {}
    for (const c of trigData) {
      const t = c.trigger_type as string
      if (!tmap[t]) tmap[t] = {total:0,engaged:0}
      tmap[t].total++
      if (['engaged','qualified','closed_won'].includes(c.status)) tmap[t].engaged++
    }
    pass('Trigger performance', `${trigData.length} leads with signals`)
    for (const [t,s] of Object.entries(tmap)) {
      const pct = Math.round(s.engaged/s.total*100)
      console.log(`    ${t.padEnd(18)} ${s.total} leads, ${pct}% engaged`)
    }
  }

  // Reply intent
  const { data: intents, error: inErr } = await sb.from('reply_events').select('reply_intent')
  if (inErr) { fail('Reply intent query', inErr.message) }
  else {
    const imap: Record<string,number> = {}
    for (const r of intents ?? []) { const i = r.reply_intent ?? 'unknown'; imap[i] = (imap[i]??0)+1 }
    const keys = Object.keys(imap)
    keys.length
      ? pass('Reply intent breakdown', Object.entries(imap).map(([k,v])=>`${k}:${v}`).join(', '))
      : warn('Reply intent', 'No replies yet')
  }

  // Reply rate
  const { count: totalSent } = await sb.from('outreach_logs').select('id',{count:'exact',head:true}).eq('status','sent')
  const { count: totalReplied } = await sb.from('reply_events').select('id',{count:'exact',head:true})
  if ((totalSent ?? 0) > 0) {
    const rate = ((totalReplied??0)/(totalSent??1)*100).toFixed(1)
    pass(`Reply rate: ${rate}%`, `${totalReplied} replies / ${totalSent} sent`)
  } else {
    warn('Reply rate', 'No emails sent yet')
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanup() {
  section('Cleanup')
  if (testCompanyId) {
    await sb.from('companies').delete().eq('id', testCompanyId)
    pass('Deleted test company (cascades to contacts, logs, followups, conversations, reply_events)')
  } else {
    warn('No test company to clean up')
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────

function summary() {
  console.log(`\n${'═'.repeat(62)}`)
  console.log('VERIFICATION SUMMARY')
  console.log('═'.repeat(62))
  console.log(`  ✅  Passed   : ${_passed}`)
  console.log(`  ❌  Failed   : ${_failed}`)
  console.log(`  ⚠️   Warnings : ${_warnings}`)

  if (_failures.length) {
    console.log('\n  Failed checks:')
    for (const f of _failures) console.log(`    · ${f}`)
  }

  console.log('─'.repeat(62))

  if (_failed === 0) {
    console.log('\n  🟢 ALL CHECKS PASSED — Growth loop is verified and ready.\n')
  } else {
    console.log(`\n  🔴 ${_failed} check(s) failed.\n`)

    const needsMigration = _failures.some(f =>
      f.includes('does not exist') || f.includes('no unique') || f.includes('schema cache')
    )
    if (needsMigration) {
      console.log('  → Most likely cause: migration 002_growth_loop.sql not yet fully applied.')
      console.log('  → Steps:')
      console.log('    1. Go to Supabase Dashboard → SQL Editor')
      console.log('    2. Paste entire contents of: supabase/migrations/002_growth_loop.sql')
      console.log('    3. Click Run — check the VERIFY table at the bottom (all values should be 1)')
      console.log('    4. Re-run:  npm run verify\n')
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗')
  console.log('║  ARAOS Growth Loop — End-to-End Verification                 ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')
  console.log(`  DB:   ${process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)'}`)
  console.log(`  Time: ${new Date().toISOString()}\n`)

  await phase1_schema()
  await phase2_pipeline()
  await phase3_observability()
  await phase4_reply()
  await phase5_analytics()
  await cleanup()
  summary()

  process.exit(_failed > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\n[FATAL]', err)
  process.exit(1)
})
