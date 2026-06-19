/**
 * Apollo.io contact discovery — the practical "LinkedIn" engine.
 *
 * LinkedIn's official API can't search people or send messages, so instead of
 * scraping LinkedIn we use Apollo's B2B people database: search a company's
 * domain for decision-maker titles and get back name + title + LinkedIn URL
 * (+ email when the plan unlocks it). Compliant, stable, no ban risk.
 *
 * Gracefully no-ops if APOLLO_API_KEY is unset.
 */

const APOLLO_BASE = 'https://api.apollo.io/api/v1'

/**
 * Decision-maker titles we target at apparel brands / importers — ordered by
 * BUYING INFLUENCE so Apollo surfaces the actual OEM/ODM buyers first.
 * P1 sourcing/production/merch  →  P2 product-dev/ops/supply-chain  →  P3 founder/CEO.
 */
export const APOLLO_TARGET_TITLES = [
  // P1 — primary buying influence
  'VP Sourcing', 'Director of Sourcing', 'Head of Sourcing', 'Sourcing Manager',
  'Director of Production', 'Production Manager',
  'Merchandising Director', 'Merchandising Manager',
  'Purchasing Manager', 'Procurement Manager',
  // P2 — product development / operations / supply chain
  'Product Development Manager', 'Product Developer', 'Head of Product',
  'Operations Manager', 'Supply Chain Manager',
  'Apparel Buyer', 'Buyer', 'Category Manager',
  // P3 — founder / CEO / owner (last: rarely the OEM buyer at brands with a sourcing org)
  'Founder', 'CEO', 'Owner',
]

export interface ApolloContact {
  firstName: string
  lastName: string
  fullName: string
  title: string
  linkedinUrl?: string
  email?: string
  seniority?: string
}

export function apolloConfigured(): boolean {
  return !!process.env.APOLLO_API_KEY
}

/**
 * Two-step Apollo flow (required on Basic plan):
 *   1. mixed_people/api_search → candidates (id + first_name + title, PII masked)
 *   2. people/match by id      → reveal full name + LinkedIn + verified email
 *
 * Step 2 costs ~1 credit per person, so `limit` caps how many we reveal.
 */
export async function apolloFindContacts(params: {
  domain?: string | null
  titles?: string[]
  limit?: number
}): Promise<ApolloContact[]> {
  const key = process.env.APOLLO_API_KEY
  if (!key || !params.domain) return []
  const limit = params.limit ?? 5

  try {
    // 1. Search — find who exists (cheap; returns Apollo person ids).
    const res = await fetch(`${APOLLO_BASE}/mixed_people/api_search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key },
      body: JSON.stringify({
        q_organization_domains: params.domain,
        person_titles: params.titles ?? APOLLO_TARGET_TITLES,
        page: 1,
        per_page: Math.max(limit, 10),
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      console.error(`[Apollo] search failed: ${res.status}`)
      return []
    }
    const data = await res.json() as { people?: ApolloRaw[] }
    const ids = (data.people ?? [])
      .filter((p) => p.id && (p.title ?? '').length > 0)
      .slice(0, limit)
      .map((p) => p.id as string)
    if (ids.length === 0) return []

    // 2. Reveal each candidate by id (parallel; 1 credit each).
    const revealed = await Promise.all(ids.map((id) => apolloMatch(id, key)))
    return revealed.filter((c): c is ApolloContact => !!c && c.fullName.length > 1)
  } catch (err) {
    console.error('[Apollo] error:', err)
    return []
  }
}

async function apolloMatch(id: string, key: string): Promise<ApolloContact | null> {
  try {
    const res = await fetch(`${APOLLO_BASE}/people/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': key },
      body: JSON.stringify({ id, reveal_personal_emails: false }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) return null
    const data = await res.json() as { person?: ApolloRaw }
    return data.person ? toContact(data.person) : null
  } catch {
    return null
  }
}

interface ApolloRaw {
  id?: string; first_name?: string; last_name?: string; name?: string; title?: string
  linkedin_url?: string; email?: string; email_status?: string; seniority?: string
}

function toContact(p: ApolloRaw): ApolloContact {
  const email = p.email && !/email_not_unlocked|not_unlocked/i.test(p.email) ? p.email : undefined
  return {
    firstName: p.first_name ?? '',
    lastName: p.last_name ?? '',
    fullName: p.name ?? `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    title: p.title ?? '',
    linkedinUrl: p.linkedin_url ?? undefined,
    email,
    seniority: p.seniority ?? undefined,
  }
}

/**
 * Map a contact to a priority (1 low .. 9 high) by BUYING INFLUENCE.
 * Sourcing/production/merchandising rank highest; founder/CEO are deliberately
 * below them (at a brand with a sourcing org, the founder isn't the OEM buyer).
 */
export function apolloPriority(c: ApolloContact): number {
  const t = (c.title ?? '').toLowerCase()
  const s = (c.seniority ?? '').toLowerCase()
  // P1 — sourcing / production / merchandising / purchasing
  if (/sourcing|purchas|procure|production|merchandis/.test(t)) {
    return /vp|head|director|chief/.test(t) || /vp|head|director|c_suite|cxo/.test(s) ? 9 : 8
  }
  // P2 — product development / operations / supply chain / buyer
  if (/product|develop|operation|supply chain|buyer|category/.test(t)) return 7
  // P3 — founder / CEO / owner
  if (/founder|ceo|owner|chief|president/.test(t) || /owner|founder|c_suite|cxo/.test(s)) return 5
  return 4
}

export function apolloRoleType(title: string): string {
  const t = (title ?? '').toLowerCase()
  if (/sourcing|purchas|procure|supply chain|buyer/.test(t)) return 'sourcing'
  if (/founder|ceo|owner|chief/.test(t)) return 'founder'
  if (/product|develop|merchand|category/.test(t)) return 'product'
  return 'other'
}
