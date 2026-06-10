/**
 * Email Finder — Top-Tier Contact Discovery
 *
 * Strategy (waterfall):
 * 1. Parse emails visible on the website (website-scraper already does this)
 * 2. Detect email pattern from discovered emails
 * 3. Generate all permutations for the target name
 * 4. SMTP-verify top candidates
 * 5. Optionally query Hunter.io API (if key is set)
 *
 * This replicates what Hunter.io charges $49+/mo for.
 */

import dns from 'dns/promises'

export interface EmailCandidate {
  email:       string
  confidence:  number    // 0.0 – 1.0
  source:      string    // 'pattern_smtp' | 'hunter' | 'scraped' | 'guessed'
  pattern?:    string    // e.g. "firstname.lastname"
  smtpResult?: 'valid' | 'catchall' | 'invalid' | 'timeout'
}

// ── Email Pattern Detection ────────────────────────────────────────────────────

export function detectEmailPattern(emails: string[], domain: string): string | null {
  const domainEmails = emails.filter(e => e.endsWith('@' + domain))
  if (domainEmails.length === 0) return null

  for (const email of domainEmails) {
    const local = email.split('@')[0]

    // firstname.lastname
    if (/^[a-z]+\.[a-z]+$/.test(local))  return 'firstname.lastname'
    // firstnamelastname (if we have a name to compare against)
    if (/^[a-z]{6,}$/.test(local))        return 'firstnamelastname'
    // f.lastname
    if (/^[a-z]\.[a-z]+$/.test(local))    return 'f.lastname'
    // flastname
    if (/^[a-z][a-z]{3,}$/.test(local))   return 'flastname'
    // firstname_lastname
    if (/^[a-z]+_[a-z]+$/.test(local))    return 'firstname_lastname'
  }
  return null
}

// ── Permutation Generator ─────────────────────────────────────────────────────

export function generatePermutations(
  firstName: string,
  lastName: string,
  domain: string
): string[] {
  const f  = firstName.toLowerCase().trim()
  const l  = lastName.toLowerCase().trim()
  const fi = f[0] ?? ''
  const li = l[0] ?? ''

  if (!f || !l) return []

  const candidates = [
    `${f}.${l}`,          // john.smith
    `${f}${l}`,           // johnsmith
    `${fi}.${l}`,         // j.smith
    `${fi}${l}`,          // jsmith
    `${f}`,               // john
    `${f}_${l}`,          // john_smith
    `${l}.${f}`,          // smith.john
    `${l}${f}`,           // smithjohn
    `${f}.${li}`,         // john.s
    `${f}${li}`,          // johns
    `${l}`,               // smith
    `${fi}_${l}`,         // j_smith
    `${f}-${l}`,          // john-smith
    `${fi}${li}`,         // js
    `${l}_${f}`,          // smith_john
  ]

  return [...new Set(candidates)].map(local => `${local}@${domain}`)
}

// ── SMTP Verification ─────────────────────────────────────────────────────────

/**
 * Probe the mail server to check if an email address is valid.
 * Uses RCPT TO trick — no email is actually sent.
 *
 * Returns:
 *   'valid'    — server accepted the address
 *   'invalid'  — server rejected the address
 *   'catchall' — server accepts everything (not reliable)
 *   'timeout'  — could not connect
 */
export async function smtpVerify(email: string, timeoutMs = 5000): Promise<'valid' | 'invalid' | 'catchall' | 'timeout'> {
  const domain = email.split('@')[1]
  if (!domain) return 'invalid'

  try {
    // Get MX records
    const mxRecords = await dns.resolveMx(domain).catch(() => null)
    if (!mxRecords || mxRecords.length === 0) return 'invalid'

    const mx = mxRecords.sort((a, b) => a.priority - b.priority)[0].exchange

    // Test with a random email to detect catch-all
    const testAddr = `probe_${Date.now()}@${domain}`

    const [realResult, catchAllResult] = await Promise.all([
      smtpProbe(email, mx, timeoutMs),
      smtpProbe(testAddr, mx, timeoutMs),
    ])

    if (catchAllResult === true) return 'catchall'
    if (realResult === true)     return 'valid'
    if (realResult === false)    return 'invalid'
    return 'timeout'

  } catch {
    return 'timeout'
  }
}

async function smtpProbe(email: string, mxHost: string, timeoutMs: number): Promise<boolean | null> {
  return new Promise((resolve) => {
    const net = require('net') as typeof import('net')

    const socket = net.createConnection({ host: mxHost, port: 25 })
    socket.setTimeout(timeoutMs)

    let stage = 0
    let buffer = ''

    const next = (cmd: string) => {
      socket.write(cmd + '\r\n')
    }

    const cleanup = (result: boolean | null) => {
      socket.destroy()
      resolve(result)
    }

    socket.on('timeout', () => cleanup(null))
    socket.on('error',   () => cleanup(null))

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      if (!buffer.includes('\n')) return

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const code = parseInt(line.slice(0, 3), 10)
        if (isNaN(code)) continue

        if (stage === 0 && code === 220) { stage = 1; next(`EHLO probe.check`);            continue }
        if (stage === 1 && code === 250) { stage = 2; next(`MAIL FROM:<probe@probe.check>`); continue }
        if (stage === 2 && code === 250) { stage = 3; next(`RCPT TO:<${email}>`);            continue }
        if (stage === 3) {
          cleanup(code === 250 || code === 251)
          return
        }
        if (code >= 400) { cleanup(false); return }
      }
    })

    socket.on('connect', () => {})
  })
}

// ── Hunter.io API Integration ─────────────────────────────────────────────────

export async function hunterEmailFinder(params: {
  firstName: string
  lastName:  string
  domain:    string
}): Promise<EmailCandidate | null> {
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return null

  try {
    const url = new URL('https://api.hunter.io/v2/email-finder')
    url.searchParams.set('api_key',    apiKey)
    url.searchParams.set('domain',     params.domain)
    url.searchParams.set('first_name', params.firstName)
    url.searchParams.set('last_name',  params.lastName)

    const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })
    const json = await res.json() as {
      data?: { email?: string; score?: number; status?: string }
      errors?: Array<{ id: string; details: string }>
    }

    if (!json.data?.email) return null

    return {
      email:      json.data.email,
      confidence: (json.data.score ?? 0) / 100,
      source:     'hunter',
      smtpResult: json.data.status === 'valid' ? 'valid' : undefined,
    }
  } catch {
    return null
  }
}

export async function hunterDomainSearch(domain: string): Promise<Array<{
  email: string; firstName: string; lastName: string; position: string; confidence: number
}>> {
  const apiKey = process.env.HUNTER_API_KEY
  if (!apiKey) return []

  try {
    const url = new URL('https://api.hunter.io/v2/domain-search')
    url.searchParams.set('api_key', apiKey)
    url.searchParams.set('domain', domain)
    url.searchParams.set('limit', '5')
    url.searchParams.set('type', 'personal')

    const res  = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) })
    const json = await res.json() as {
      data?: {
        emails?: Array<{
          value: string; first_name: string; last_name: string
          position: string; confidence: number
        }>
      }
    }

    return (json.data?.emails ?? []).map(e => ({
      email:      e.value,
      firstName:  e.first_name ?? '',
      lastName:   e.last_name ?? '',
      position:   e.position ?? '',
      confidence: e.confidence / 100,
    }))
  } catch {
    return []
  }
}

// ── Main Finder Orchestrator ──────────────────────────────────────────────────

export interface FindEmailResult {
  contacts:     EmailCandidate[]
  pattern:      string | null
  domainStatus: 'normal' | 'catchall' | 'no_mx'
  hunterUsed:   boolean
}

export async function findEmails(params: {
  domain:          string
  existingEmails?: string[]
  candidates?: Array<{ firstName: string; lastName: string; title?: string }>
  skipSmtp?:   boolean
}): Promise<FindEmailResult> {
  const { domain, existingEmails = [], candidates = [], skipSmtp = false } = params

  const results: EmailCandidate[] = []
  let domainStatus: FindEmailResult['domainStatus'] = 'normal'
  let hunterUsed = false

  // 1. Detect pattern from existing scraped emails
  const pattern = detectEmailPattern(existingEmails, domain)

  // 2. Try Hunter domain search first (free tier: 25/month)
  const hunterContacts = await hunterDomainSearch(domain)
  if (hunterContacts.length > 0) {
    hunterUsed = true
    for (const hc of hunterContacts) {
      results.push({
        email:       hc.email,
        confidence:  hc.confidence,
        source:      'hunter',
        smtpResult:  undefined,
      })
    }
  }

  // 3. For each named candidate, try permutations + SMTP
  for (const candidate of candidates.slice(0, 3)) {
    // Skip if hunter already found this person
    if (hunterUsed && results.some(r => r.email.toLowerCase().includes(
      candidate.firstName.toLowerCase()
    ))) continue

    // Try Hunter email-finder for this specific person
    const hunterResult = await hunterEmailFinder({
      firstName: candidate.firstName,
      lastName:  candidate.lastName,
      domain,
    })

    if (hunterResult) {
      hunterUsed = true
      results.push(hunterResult)
      continue
    }

    // Fallback: pattern-based permutations + SMTP
    if (skipSmtp) continue

    const permutations = generatePermutations(candidate.firstName, candidate.lastName, domain)

    // Test catch-all first
    if (permutations.length > 0) {
      const catchallTest = await smtpVerify(`probe_test_999@${domain}`, 4000)
      if (catchallTest === 'timeout') {
        domainStatus = 'no_mx'
        break
      }
      if (catchallTest === 'valid') {
        domainStatus = 'catchall'
        // Still generate best-guess from pattern
        if (pattern) {
          const guess = applyPattern(pattern, candidate.firstName, candidate.lastName, domain)
          if (guess) {
            results.push({
              email:      guess,
              confidence: 0.4,
              source:     'pattern_catchall',
              pattern,
              smtpResult: 'catchall',
            })
          }
        }
        break
      }

      // Normal domain — test permutations
      for (const perm of permutations.slice(0, 8)) {
        const smtpResult = await smtpVerify(perm, 4000)
        if (smtpResult === 'valid') {
          results.push({
            email:      perm,
            confidence: 0.85,
            source:     'pattern_smtp',
            pattern:    detectEmailPattern([perm], domain) ?? 'guessed',
            smtpResult: 'valid',
          })
          break  // Found a valid one, stop permutating
        }
      }
    }
  }

  // 4. Deduplicate and sort by confidence
  const seen = new Set<string>()
  const unique = results.filter(r => {
    if (seen.has(r.email.toLowerCase())) return false
    seen.add(r.email.toLowerCase())
    return true
  }).sort((a, b) => b.confidence - a.confidence)

  return { contacts: unique, pattern, domainStatus, hunterUsed }
}

function applyPattern(pattern: string, firstName: string, lastName: string, domain: string): string | null {
  const f  = firstName.toLowerCase()
  const l  = lastName.toLowerCase()
  const fi = f[0]

  const map: Record<string, string> = {
    'firstname.lastname':  `${f}.${l}`,
    'firstnamelastname':   `${f}${l}`,
    'f.lastname':          `${fi}.${l}`,
    'flastname':           `${fi}${l}`,
    'firstname_lastname':  `${f}_${l}`,
  }
  const local = map[pattern]
  return local ? `${local}@${domain}` : null
}
