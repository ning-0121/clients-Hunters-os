/**
 * Shared contact-discovery types.
 *
 * Every discovery source (Apollo / RocketReach / X-Ray / GitHub / website / AI)
 * returns the same `PersonCandidate` shape so the waterfall orchestrator and the
 * email verifier can treat them uniformly. Kept in its own file so source clients
 * and the orchestrator can import the type without a circular runtime dependency.
 */
export type ContactSource =
  | 'apollo'
  | 'rocketreach'
  | 'xray'
  | 'github'
  | 'website'
  | 'ai_inferred'
  | 'hunter'

export interface PersonCandidate {
  firstName: string
  lastName: string
  fullName: string
  title: string
  email?: string
  linkedinUrl?: string
  source: ContactSource
}

/** Build a PersonCandidate, splitting a full name into first/last when needed. */
export function toPersonCandidate(p: {
  firstName?: string
  lastName?: string
  fullName?: string
  title?: string
  email?: string
  linkedinUrl?: string
  source: ContactSource
}): PersonCandidate {
  let first = (p.firstName ?? '').trim()
  let last = (p.lastName ?? '').trim()
  const full = (p.fullName ?? `${first} ${last}`).trim()
  if ((!first || !last) && full) {
    const parts = full.split(/\s+/)
    first = first || parts[0] || ''
    last = last || (parts.length > 1 ? parts[parts.length - 1] : '')
  }
  return {
    firstName: first,
    lastName: last,
    fullName: full,
    title: (p.title ?? '').trim(),
    email: p.email?.trim() || undefined,
    linkedinUrl: p.linkedinUrl?.trim() || undefined,
    source: p.source,
  }
}
