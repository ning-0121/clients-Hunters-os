/**
 * Hiring Signal Detector
 *
 * Brands hiring sourcing/production/operations roles are actively building
 * their supply chain — the HIGHEST timing signal for OEM outreach.
 *
 * "A company hiring a Production Coordinator is at capacity with their
 *  current supplier. This is the perfect moment to reach out."
 *
 * Strategy:
 * 1. Check company's own /careers, /jobs, /work-with-us pages
 * 2. Detect relevant role keywords
 * 3. Return structured signal with urgency score
 */

export interface HiringSignal {
  detected:      boolean
  roles:         string[]
  urgency:       'high' | 'medium' | 'low'
  score:         number    // 0-10
  sourceUrl?:    string
  rawMatches?:   string[]
}

// Role patterns that signal OEM sourcing readiness
const HIGH_URGENCY_ROLES = [
  /production\s+coordinator/i,
  /sourcing\s+manager/i,
  /head\s+of\s+(sourcing|supply\s+chain|operations|production)/i,
  /supply\s+chain\s+manager/i,
  /textile\s+developer/i,
  /technical\s+designer/i,
  /garment\s+technologist/i,
  /apparel\s+developer/i,
  /vendor\s+manager/i,
  /manufacturing\s+manager/i,
]

const MEDIUM_URGENCY_ROLES = [
  /operations\s+manager/i,
  /operations\s+director/i,
  /logistics\s+coordinator/i,
  /quality\s+control/i,
  /product\s+developer/i,
  /brand\s+manager/i,
  /ecommerce\s+manager/i,
  /supply\s+chain/i,
]

const LOW_URGENCY_ROLES = [
  /warehouse/i,
  /inventory/i,
  /fulfillment/i,
  /customer\s+service/i,
]

const JOB_PAGE_PATHS = [
  '/careers',
  '/jobs',
  '/work-with-us',
  '/join-us',
  '/join-the-team',
  '/hiring',
  '/open-positions',
  '/pages/careers',
  '/pages/jobs',
]

export async function detectHiringSignals(website: string): Promise<HiringSignal> {
  const empty: HiringSignal = { detected: false, roles: [], urgency: 'low', score: 0 }
  if (!website) return empty

  const base = website.replace(/\/$/, '')
  const allText: string[] = []
  let sourceUrl: string | undefined

  // Scrape job pages
  for (const path of JOB_PAGE_PATHS) {
    try {
      const url = `${base}${path}`
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; research-bot/1.0)' },
        signal: AbortSignal.timeout(6000),
      })
      if (!res.ok) continue

      const html = await res.text()
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 8000)

      allText.push(text)
      if (!sourceUrl) sourceUrl = url
      break  // Found a careers page, stop looking
    } catch {
      continue
    }
  }

  if (allText.length === 0) return empty

  const fullText = allText.join('\n')
  const roles: string[]    = []
  const matches: string[]  = []
  let maxUrgency: 'high' | 'medium' | 'low' = 'low'

  // Check high-urgency roles
  for (const pattern of HIGH_URGENCY_ROLES) {
    const match = fullText.match(pattern)
    if (match) {
      roles.push(match[0])
      matches.push(match[0])
      maxUrgency = 'high'
    }
  }

  // Check medium-urgency only if no high found
  if (maxUrgency !== 'high') {
    for (const pattern of MEDIUM_URGENCY_ROLES) {
      const match = fullText.match(pattern)
      if (match) {
        roles.push(match[0])
        matches.push(match[0])
        if (maxUrgency === 'low') maxUrgency = 'medium'
      }
    }
  }

  if (roles.length === 0) return empty

  // Score: high=9, medium=6, low=3; bonus for multiple roles
  const baseScore = maxUrgency === 'high' ? 9 : maxUrgency === 'medium' ? 6 : 3
  const score     = Math.min(10, baseScore + Math.min(roles.length - 1, 1))

  return {
    detected:    true,
    roles:       [...new Set(roles)].slice(0, 5),
    urgency:     maxUrgency,
    score,
    sourceUrl,
    rawMatches:  matches,
  }
}

/**
 * Generate a hiring-signal-based icebreaker for email personalization
 */
export function hiringIcebreaker(signal: HiringSignal, companyName: string): string | null {
  if (!signal.detected || signal.roles.length === 0) return null
  const role = signal.roles[0]

  const templates = [
    `Saw that ${companyName} is hiring a ${role} — that usually means the current production setup is getting stretched. Timing-wise, might be worth a quick chat.`,
    `Noticed the ${role} opening at ${companyName} — brands at that stage often find MOQ flexibility matters more than price. Happy to share how we handle that.`,
    `The ${role} role you're hiring for at ${companyName} caught my eye — growing into that capacity is exactly when our manufacturing setup tends to be most useful.`,
  ]

  return templates[Math.floor(Math.random() * templates.length)]
}
