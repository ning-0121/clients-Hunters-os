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

/** Decision-maker titles we target at apparel brands / importers. */
export const APOLLO_TARGET_TITLES = [
  'Head of Sourcing', 'Sourcing Manager', 'Purchasing Manager', 'Procurement Manager',
  'Supply Chain Manager', 'Product Development Manager', 'Product Developer',
  'Apparel Buyer', 'Buyer', 'Category Manager', 'Merchandising Manager',
  'Head of Product', 'Founder', 'CEO', 'Owner',
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

/** Map seniority/title to a contact priority (1 low .. 9 high). */
export function apolloPriority(c: ApolloContact): number {
  const s = (c.seniority ?? '').toLowerCase()
  const t = (c.title ?? '').toLowerCase()
  if (/owner|founder|c_suite|cxo|ceo|chief/.test(s) || /founder|ceo|owner|chief/.test(t)) return 9
  if (/vp|head|director/.test(s) || /head of|vp |director/.test(t)) return 8
  if (/manager|sourcing|purchas|procure/.test(s) || /sourcing|purchas|procure|buyer|product develop/.test(t)) return 7
  return 5
}

export function apolloRoleType(title: string): string {
  const t = (title ?? '').toLowerCase()
  if (/sourcing|purchas|procure|supply chain|buyer/.test(t)) return 'sourcing'
  if (/founder|ceo|owner|chief/.test(t)) return 'founder'
  if (/product|develop|merchand|category/.test(t)) return 'product'
  return 'other'
}
