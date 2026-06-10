/**
 * Worker Entry Point
 * Runs two workers in parallel:
 *   1. Queue Worker  — processes enrich / score / outreach / followup jobs
 *   2. Reply Scanner — polls Gmail INBOX every 5 minutes for replies
 *
 * Run with: npm run worker           (dev, loads .env.local via --env-file)
 *           npm run worker:prod      (production — env vars must be set externally)
 */
import { startWorker }       from './queue-worker'
import { startReplyScanner } from './reply-scanner'

// ── Startup env validation ─────────────────────────────────────────────────────
const REQUIRED_VARS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GMAIL_USER',
  'GMAIL_APP_PASSWORD',
]
const missing = REQUIRED_VARS.filter(v => !process.env[v])
if (missing.length > 0) {
  console.error(`[Worker] ❌ Missing required env vars: ${missing.join(', ')}`)
  console.error('[Worker] For local dev run: npm run worker  (uses --env-file=.env.local)')
  console.error('[Worker] For production: ensure env vars are set in the environment')
  process.exit(1)
}

Promise.all([
  startWorker().catch((err) => {
    console.error('[QueueWorker] Fatal:', err)
    process.exit(1)
  }),
  startReplyScanner().catch((err) => {
    // Non-fatal: scanner failure should not kill the queue worker
    console.error('[ReplyScanner] Fatal:', err)
  }),
])
