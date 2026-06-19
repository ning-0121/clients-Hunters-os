/**
 * Contact discovery waterfall — the core of the Contact Intelligence Engine.
 *
 * Runs every people source (Apollo → RocketReach → X-Ray → GitHub), each of which
 * no-ops without its key, then funnels EVERY candidate through one verification
 * chain (Hunter email-finder + SMTP) so a found name becomes a *verified* email.
 * This is what turns a high-value company into a reachable account: Apollo finds
 * the real Sourcing/Production decision-maker, and the verifier confirms the email
 * so it passes the A-tier "verified key contact" gate.
 *
 * Returns save-ready contacts (name, role, decision level, verified email,
 * confidence, source). Pure orchestration over existing clients — callers just
 * persist the result and dedupe against what they already have.
 */
import { apolloFindContacts, apolloConfigured } from '@/lib/enrichment/apollo'
import { rocketreachFindContacts } from '@/lib/enrichment/rocketreach'
import { xrayFindContacts } from '@/lib/enrichment/xray'
import { githubFindContacts } from '@/lib/enrichment/github'
import { findEmails, smtpVerify, type EmailCandidate } from '@/lib/enrichment/email-finder'
import { resolveMailDomain } from '@/lib/enrichment/mail-domain'
import { classifyRole, roleRank, type ContactRole } from '@/lib/contacts/roles'
import { toPersonCandidate, type PersonCandidate, type ContactSource } from '@/lib/enrichment/contact-types'

export type DecisionLevel = 'decision_maker' | 'influencer' | 'unknown'

export interface DiscoveredContact {
  fullName: string | null
  firstName: string | null
  lastName: string | null
  title: string
  roleType: ContactRole
  decisionLevel: DecisionLevel
  email: string | null
  emailVerified: boolean
  emailConfidence: number
  emailSource: string
  linkedinUrl: string | null
  contactPriority: number
  replyProbability: number
  source: ContactSource
}

const SENIOR_RE = /\bvp\b|vice president|head of|director|chief|founder|ceo|owner|president|c[ -]?level/i

/** Senior title OR a clear buyer role ⇒ decision-maker; known role ⇒ influencer. */
export function decisionLevelFor(title: string, role: ContactRole): DecisionLevel {
  if (SENIOR_RE.test(title)) return 'decision_maker'
  if ((role === 'sourcing' || role === 'production') && /manager|lead/i.test(title)) return 'decision_maker'
  return role === 'other' ? 'unknown' : 'influencer'
}

/** Contact priority 1..9 by buying influence (role rank + a senior-title bonus). */
export function contactPriorityFor(title: string, role: ContactRole): number {
  const base = roleRank(role)               // 0..10
  const bonus = SENIOR_RE.test(title) ? 1 : 0
  return Math.max(1, Math.min(9, base + bonus))
}

const nameKey = (c: PersonCandidate) => c.fullName.toLowerCase().replace(/\s+/g, ' ').trim()

/** Match a resolved email back to a candidate by first/last name (same heuristic as enrich). */
function matchEmail(c: PersonCandidate, cands: EmailCandidate[]): EmailCandidate | undefined {
  const fn = c.firstName.toLowerCase()
  const ln = c.lastName.toLowerCase()
  if (!fn || fn.length < 3) return undefined
  return cands.find((e) => {
    const em = e.email.toLowerCase()
    return em.includes(fn) || (ln.length >= 3 && em.includes(fn.slice(0, 4)) && em.includes(ln.slice(0, 4)))
  })
}

export async function discoverPeople(params: {
  domain?: string | null
  companyName?: string | null
  website?: string | null
  existingEmails?: string[]
  /** Bias the title search (used by refind escalation to rotate role focus). */
  roleTarget?: string[]
  /** Caller-provided candidates (e.g. website/AI-inferred) verified in the same pass. */
  extraCandidates?: PersonCandidate[]
  limit?: number
}): Promise<DiscoveredContact[]> {
  const { domain, companyName, website, existingEmails = [], roleTarget, extraCandidates = [] } = params
  const limit = params.limit ?? 6
  const titles = roleTarget?.length ? roleTarget : undefined
  // Email guessing/verification must target the corporate mail domain, not a
  // storefront/locale host (us.oneractive.com → oneractive.com). Apollo org search
  // and website scraping keep using the original `domain`/`website`.
  const mailDomain = (await resolveMailDomain({ domain, website, knownEmails: existingEmails })) ?? domain

  // 1. Run all API sources in parallel (each no-ops without its key).
  const [apolloRaw, rr, xray, gh] = await Promise.all([
    apolloConfigured() && domain
      ? apolloFindContacts({ domain, titles, limit: 6 }).then((list) =>
          list.map((p) => toPersonCandidate({ ...p, source: 'apollo' })))
      : Promise.resolve([] as PersonCandidate[]),
    rocketreachFindContacts({ domain, companyName, titles, limit: 4 }),
    xrayFindContacts({ companyName, domain, roleTerms: roleTarget, limit: 5 }),
    githubFindContacts({ companyName, domain, limit: 3 }),
  ])

  // 2. Combine in source-priority order (API sources first, caller extras last),
  //    then dedupe by name / LinkedIn URL.
  const seenName = new Set<string>()
  const seenUrl = new Set<string>()
  const candidates: PersonCandidate[] = []
  for (const c of [...apolloRaw, ...rr, ...xray, ...gh, ...extraCandidates]) {
    if (!c.fullName) continue
    const k = nameKey(c)
    if (seenName.has(k)) continue
    if (c.linkedinUrl && seenUrl.has(c.linkedinUrl)) continue
    seenName.add(k)
    if (c.linkedinUrl) seenUrl.add(c.linkedinUrl)
    candidates.push(c)
  }
  if (!candidates.length) return []

  // 3. Rank by buying influence, keep the top N for the (cost-bearing) verification.
  const ranked = candidates
    .map((c) => ({ c, role: classifyRole(c.title), prio: contactPriorityFor(c.title, classifyRole(c.title)) }))
    .sort((a, b) => b.prio - a.prio)
    .slice(0, limit)

  // 4a. Resolve emails for candidates with no source email (Hunter + SMTP).
  const needEmail = ranked.filter((r) => !r.c.email && r.c.firstName && r.c.lastName)
  let resolved: EmailCandidate[] = []
  if (mailDomain && needEmail.length) {
    const fe = await findEmails({
      domain: mailDomain,
      existingEmails,
      candidates: needEmail.map((r) => ({ firstName: r.c.firstName, lastName: r.c.lastName, title: r.c.title })),
      skipSmtp: false,
    })
    resolved = fe.contacts
  }

  // 4b. Verify source-provided emails (Apollo/RocketReach/GitHub) via SMTP.
  const smtpFor = new Map<string, 'valid' | 'invalid' | 'catchall' | 'timeout'>()
  await Promise.all(
    ranked
      .filter((r) => r.c.email)
      .map(async (r) => {
        const res = await smtpVerify(r.c.email as string, 4000).catch(() => 'timeout' as const)
        smtpFor.set(r.c.email as string, res)
      }),
  )

  // 5. Build save-ready contacts.
  const out: DiscoveredContact[] = []
  for (const { c, role, prio } of ranked) {
    let email: string | null = c.email ?? null
    let emailVerified = false
    let emailConfidence = 0
    let emailSource = c.source as string

    if (c.email) {
      const smtp = smtpFor.get(c.email)
      if (smtp === 'invalid') { email = null }            // bad address from source → drop
      else if (smtp === 'valid') { emailVerified = true; emailConfidence = 0.9 }
      else { emailConfidence = 0.5 }                       // catch-all/timeout: trusted source ⇒ "likely"
    } else {
      const found = matchEmail(c, resolved)
      if (found) {
        email = found.email
        emailSource = found.source
        emailConfidence = found.confidence
        emailVerified = found.source === 'hunter' || found.source === 'pattern_smtp' || found.smtpResult === 'valid'
      }
    }

    out.push({
      fullName: c.fullName || null,
      firstName: c.firstName || null,
      lastName: c.lastName || null,
      title: c.title,
      roleType: role,
      decisionLevel: decisionLevelFor(c.title, role),
      email,
      emailVerified,
      emailConfidence,
      emailSource,
      linkedinUrl: c.linkedinUrl ?? null,
      contactPriority: prio,
      replyProbability: emailVerified ? 0.35 : email ? 0.2 : 0.12,
      source: c.source,
    })
  }
  return out
}
