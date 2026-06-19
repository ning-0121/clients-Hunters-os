/**
 * GitHub contact intelligence — a SECONDARY source that can surface hidden
 * contacts (engineering / digital / Shopify teams) when Apollo/RocketReach miss.
 *
 * Flow: find the company's GitHub org (matched by domain to avoid false orgs) →
 * read public org members → return members with a public name/email. These are
 * usually digital-team people (influencers, not buyers), so they add COVERAGE
 * rather than the primary decision-maker.
 *
 * Works unauthenticated at a low rate limit; uses GITHUB_TOKEN when present.
 * Conservative by design (exact-ish domain match) to avoid wrong-company noise.
 */
import { toPersonCandidate, type PersonCandidate } from '@/lib/enrichment/contact-types'

const GH_BASE = 'https://api.github.com'

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'araos-contact-intel',
  }
  const token = process.env.GITHUB_TOKEN
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function ghGet<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${GH_BASE}${path}`, { headers: ghHeaders(), signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

const rootDomain = (d: string) => d.toLowerCase().replace(/^www\./, '').trim()

export async function githubFindContacts(params: {
  companyName?: string | null
  domain?: string | null
  limit?: number
}): Promise<PersonCandidate[]> {
  const { companyName, domain } = params
  if (!companyName && !domain) return []
  const limit = params.limit ?? 4
  const wantDomain = domain ? rootDomain(domain) : null

  // 1. Find candidate orgs by name; keep the one whose blog/email matches the domain.
  const term = encodeURIComponent(`${companyName ?? domain} type:org`)
  const search = await ghGet<{ items?: Array<{ login: string }> }>(`/search/users?q=${term}&per_page=3`)
  const orgLogins = (search?.items ?? []).map((o) => o.login).slice(0, 3)
  if (!orgLogins.length) return []

  let orgLogin: string | null = null
  for (const login of orgLogins) {
    const org = await ghGet<{ login: string; blog?: string; email?: string }>(`/orgs/${login}`)
    if (!org) continue
    if (!wantDomain) { orgLogin = org.login; break } // no domain to match → take first org
    const blogDomain = org.blog ? rootDomain(org.blog.replace(/^https?:\/\//, '').split('/')[0]) : ''
    const emailDomain = org.email ? rootDomain(org.email.split('@')[1] ?? '') : ''
    if (blogDomain.includes(wantDomain) || emailDomain.includes(wantDomain)) { orgLogin = org.login; break }
  }
  if (!orgLogin) return []

  // 2. Public members → public profile (name/email).
  const members = await ghGet<Array<{ login: string }>>(`/orgs/${orgLogin}/public_members?per_page=10`)
  if (!members?.length) return []

  const out: PersonCandidate[] = []
  for (const m of members.slice(0, limit)) {
    const user = await ghGet<{ name?: string; email?: string; login: string }>(`/users/${m.login}`)
    if (!user?.name) continue
    // Only keep a public email if it's on the company domain (avoid personal gmail noise).
    const email = user.email && wantDomain && rootDomain(user.email.split('@')[1] ?? '').includes(wantDomain)
      ? user.email
      : undefined
    out.push(
      toPersonCandidate({
        fullName: user.name,
        title: 'Team (GitHub)',
        email,
        linkedinUrl: undefined,
        source: 'github',
      }),
    )
  }
  return out
}
