/**
 * Google X-Ray contact discovery — find decision-makers via public LinkedIn
 * profiles indexed by Google, using the Serper search API we already use.
 *
 * Query shape: site:linkedin.com/in "<Company>" (Sourcing OR Production OR ...)
 * LinkedIn result titles look like:
 *   "Jane Smith - Director of Sourcing - Gymshark | LinkedIn"
 * from which we extract name + title + the profile URL.
 *
 * No email here (LinkedIn doesn't expose it) — the verifier resolves emails from
 * the name + company domain. No-ops if SERPER_API_KEY is unset (never parses the
 * google-scraper mock results).
 */
import { googleSearch } from '@/agents/discovery/scrapers/google-scraper'
import { toPersonCandidate, type PersonCandidate } from '@/lib/enrichment/contact-types'

const DEFAULT_ROLE_TERMS = [
  'Sourcing', 'Procurement', 'Purchasing', 'Production',
  'Merchandising', 'Product Development', 'Buyer', 'Supply Chain',
]

export function xrayConfigured(): boolean {
  const k = process.env.SERPER_API_KEY
  return !!k && k !== 'your_serper_api_key'
}

export async function xrayFindContacts(params: {
  companyName?: string | null
  domain?: string | null
  roleTerms?: string[]
  limit?: number
}): Promise<PersonCandidate[]> {
  // Guard directly on the key so we never parse google-scraper's mock fallback.
  if (!xrayConfigured()) return []
  const company = params.companyName || params.domain
  if (!company) return []
  const limit = params.limit ?? 5
  const terms = (params.roleTerms?.length ? params.roleTerms : DEFAULT_ROLE_TERMS).slice(0, 8)

  const query = `site:linkedin.com/in "${company}" (${terms.join(' OR ')})`

  try {
    const results = await googleSearch(query, 10)
    const out: PersonCandidate[] = []
    for (const r of results) {
      if (!/linkedin\.com\/in\//i.test(r.link)) continue
      const parsed = parseLinkedInTitle(r.title)
      if (!parsed) continue
      out.push(
        toPersonCandidate({
          fullName: parsed.name,
          title: parsed.title,
          linkedinUrl: r.link.split('?')[0],
          source: 'xray',
        }),
      )
      if (out.length >= limit) break
    }
    return out
  } catch (err) {
    console.error('[X-Ray] error:', err)
    return []
  }
}

/**
 * Parse "Jane Smith - Director of Sourcing - Gymshark | LinkedIn" → name + title.
 * Returns null if it doesn't look like a real "First Last" + a role-bearing title.
 */
export function parseLinkedInTitle(raw: string): { name: string; title: string } | null {
  if (!raw) return null
  const cleaned = raw.replace(/\s*\|\s*LinkedIn.*$/i, '').trim()
  const parts = cleaned.split(/\s[-–—]\s/).map((s) => s.trim()).filter(Boolean)
  if (parts.length < 2) return null

  const name = parts[0]
  // Real person name = 2–3 capitalized words, no digits.
  if (!/^[A-Z][a-zA-Z'’.]+(?:\s+[A-Z][a-zA-Z'’.-]+){1,2}$/.test(name)) return null

  // Title = the first remaining segment that mentions a buying-relevant role.
  const roleRe = /sourcing|procure|purchas|production|merchandis|buyer|supply chain|product/i
  const title = parts.slice(1).find((p) => roleRe.test(p)) ?? parts[1]
  return { name, title }
}
