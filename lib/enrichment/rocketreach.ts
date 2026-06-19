/**
 * RocketReach contact discovery — a second people-database source alongside Apollo.
 *
 * Two-step like Apollo: search by employer + target titles → look up the top
 * profiles to reveal emails. Lookups cost credits, so `limit` caps how many we
 * reveal. Gracefully no-ops if ROCKETREACH_API_KEY is unset.
 *
 * Docs: https://rocketreach.co/api  (v2 — header auth `Api-Key`)
 */
import { toPersonCandidate, type PersonCandidate } from '@/lib/enrichment/contact-types'

const RR_BASE = 'https://api.rocketreach.co/v2'

export function rocketreachConfigured(): boolean {
  return !!process.env.ROCKETREACH_API_KEY
}

interface RRProfile {
  id?: number
  name?: string
  first_name?: string
  last_name?: string
  current_title?: string
  current_employer?: string
  linkedin_url?: string
  emails?: Array<{ email?: string; smtp_valid?: string; type?: string }>
  status?: string
}

export async function rocketreachFindContacts(params: {
  domain?: string | null
  companyName?: string | null
  titles?: string[]
  limit?: number
}): Promise<PersonCandidate[]> {
  const key = process.env.ROCKETREACH_API_KEY
  const employer = params.companyName || params.domain
  if (!key || !employer) return []
  const limit = params.limit ?? 4

  try {
    // 1. Search — find candidate profiles at this employer with target titles.
    const res = await fetch(`${RR_BASE}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Key': key },
      body: JSON.stringify({
        query: {
          current_employer: [employer],
          ...(params.titles?.length ? { current_title: params.titles } : {}),
        },
        page: 1,
        page_size: Math.max(limit, 10),
      }),
      signal: AbortSignal.timeout(12000),
    })
    if (!res.ok) {
      console.error(`[RocketReach] search failed: ${res.status}`)
      return []
    }
    const data = (await res.json()) as { profiles?: RRProfile[] }
    const profiles = (data.profiles ?? []).filter((p) => p.id && (p.name || p.first_name)).slice(0, limit)
    if (!profiles.length) return []

    // 2. Look up each profile to reveal emails (1 credit each).
    const revealed = await Promise.all(profiles.map((p) => rocketreachLookup(p.id as number, key, p)))
    return revealed.filter((c): c is PersonCandidate => !!c)
  } catch (err) {
    console.error('[RocketReach] error:', err)
    return []
  }
}

async function rocketreachLookup(id: number, key: string, fallback: RRProfile): Promise<PersonCandidate | null> {
  let prof: RRProfile = fallback
  try {
    const res = await fetch(`${RR_BASE}/person/lookup?id=${id}`, {
      headers: { 'Api-Key': key },
      signal: AbortSignal.timeout(12000),
    })
    if (res.ok) prof = (await res.json()) as RRProfile
  } catch {
    /* fall back to the teaser profile from search */
  }

  const email = (prof.emails ?? [])
    .filter((e) => e.email && e.smtp_valid !== 'invalid')
    .sort((a, b) => (a.smtp_valid === 'valid' ? -1 : 1))[0]?.email

  const name = prof.name || `${prof.first_name ?? ''} ${prof.last_name ?? ''}`.trim()
  if (!name) return null

  return toPersonCandidate({
    firstName: prof.first_name,
    lastName: prof.last_name,
    fullName: name,
    title: prof.current_title,
    email,
    linkedinUrl: prof.linkedin_url,
    source: 'rocketreach',
  })
}
