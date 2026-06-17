/**
 * resolveSendableEmail — the gate that stops bounces.
 *
 * Problem: we were sending to guessed / catch-all addresses that come back
 * "risky" / "unknown" / "accept_all" from Hunter and bounce. A paid product
 * cannot do that.
 *
 * This does a find → verify → decide waterfall and PERSISTS the verdict on the
 * contact (email_verified / email_deliverable / email_confidence / email_source):
 *   1. If the contact already has an email, verify it.
 *   2. If it's undeliverable or missing, try to FIND a better one
 *      (Hunter email-finder + pattern/SMTP) and verify that.
 *   3. Decide whether it's safe to send:
 *      - deliverable                → send (verified ✓)
 *      - undeliverable              → never send, flag bad
 *      - accept_all/risky/unknown   → send ONLY if the address has credible
 *        provenance (scraped / Hunter / Apollo / SMTP-valid, conf ≥ 0.6).
 *        A blind pattern guess on a catch-all domain is NOT sent.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { verifyEmail } from '@/lib/email/verify'
import { findEmails } from '@/lib/enrichment/email-finder'

const TRUSTED_SOURCES = ['hunter', 'apollo', 'scraped', 'pattern_smtp', 'domain_search']

export interface SendableEmail {
  email: string | null
  sendable: boolean
  status: string        // deliverable | accept_all | risky | undeliverable | unknown | none
  source: string
  confidence: number
  reason: string        // zh explanation when not sendable / when found a new one
}

function domainFromEmail(email?: string | null): string | null {
  if (!email || !email.includes('@')) return null
  return email.split('@')[1]?.toLowerCase() || null
}

function domainFromWebsite(website?: string | null): string | null {
  if (!website) return null
  try {
    const u = new URL(website.startsWith('http') ? website : `https://${website}`)
    return u.hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return null
  }
}

export interface ResolveOpts {
  contactId?: string | null
  email?: string | null
  source?: string | null
  confidence?: number | null
  firstName?: string | null
  lastName?: string | null
  fullName?: string | null
  website?: string | null
}

export async function resolveSendableEmail(opts: ResolveOpts): Promise<SendableEmail> {
  const supabase = await createServiceClient()

  const persist = async (patch: Record<string, unknown>) => {
    if (!opts.contactId) return
    try { await supabase.from('contacts').update(patch).eq('id', opts.contactId) } catch { /* noop */ }
  }

  // Decide sendability from a verified status + provenance.
  const decide = (email: string, status: string, source: string, confidence: number): SendableEmail => {
    if (status === 'deliverable') {
      return { email, sendable: true, status, source, confidence: Math.max(confidence, 0.9), reason: '邮箱已验证可达' }
    }
    if (status === 'undeliverable') {
      return { email, sendable: false, status, source, confidence, reason: `邮箱不可达（${status}），已拦截` }
    }
    // accept_all / risky / unknown / unverified / error → only send with credible provenance
    const trusted = TRUSTED_SOURCES.includes(source) || confidence >= 0.6
    if (trusted) {
      return { email, sendable: true, status, source, confidence, reason: `邮箱来源可信但未完全验证（${status}），允许发送` }
    }
    return { email, sendable: false, status, source, confidence, reason: `邮箱仅为推测且未通过验证（${status}），已暂缓发送，请人工核实或补充已验证邮箱` }
  }

  // ── Step 1: verify the email we already have ──────────────────────────────
  const current = (opts.email ?? '').trim()
  let bestSource = opts.source ?? 'unknown'
  if (current) {
    const v = await verifyEmail(current)
    const status = v.status
    if (status === 'deliverable') {
      await persist({ email: current, email_verified: true, email_deliverable: true, email_confidence: (v.score ?? 90) / 100 })
      return decide(current, status, bestSource, (v.score ?? 90) / 100)
    }
    if (status !== 'undeliverable') {
      // ambiguous — keep it as a fallback but try to find something better below
      const decision = decide(current, status, bestSource, opts.confidence ?? 0.4)
      if (decision.sendable) {
        await persist({ email: current, email_deliverable: null, email_confidence: opts.confidence ?? 0.4 })
        return decision
      }
      // not sendable on its own → fall through to finder
    } else {
      await persist({ email_deliverable: false, email_verified: false })
    }
  }

  // ── Step 2: try to FIND a better address ──────────────────────────────────
  const domain = domainFromEmail(current) ?? domainFromWebsite(opts.website)
  const first = (opts.firstName ?? opts.fullName?.split(/\s+/)[0] ?? '').trim()
  const last  = (opts.lastName ?? opts.fullName?.split(/\s+/).slice(1).join(' ') ?? '').trim()

  if (domain && (first || last)) {
    let found
    try {
      found = await findEmails({
        domain,
        existingEmails: current ? [current] : [],
        candidates: first || last ? [{ firstName: first, lastName: last, title: undefined }] : [],
      })
    } catch { found = null }

    const top = found?.contacts?.[0]
    if (top?.email && top.email.toLowerCase() !== current.toLowerCase()) {
      const v2 = await verifyEmail(top.email)
      const status2 = v2.status === 'unverified' && top.smtpResult === 'valid' ? 'deliverable' : v2.status
      const decision = decide(top.email, status2, top.source, top.confidence)
      // Persist the newly found address (replace the old bad one)
      const patch: Record<string, unknown> = {
        email: top.email,
        email_source: top.source,
        email_confidence: top.confidence,
        email_verified: status2 === 'deliverable',
        email_deliverable: status2 === 'deliverable' ? true : status2 === 'undeliverable' ? false : null,
      }
      await persist(patch)
      decision.reason = current ? `已替换为新找到的邮箱：${top.email}（${decision.reason}）` : decision.reason
      return decision
    }
  }

  // ── Step 3: nothing sendable ──────────────────────────────────────────────
  if (current) {
    return decide(current, 'undeliverable', bestSource, opts.confidence ?? 0)
  }
  return { email: null, sendable: false, status: 'none', source: 'none', confidence: 0, reason: '没有可用邮箱，且未能找到（缺少域名或姓名）' }
}
