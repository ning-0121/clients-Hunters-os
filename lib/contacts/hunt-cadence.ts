/**
 * Hunting cadence — cooldown gating so parked (`awaiting_contact`) companies are
 * re-enriched on a sane schedule instead of in a tight enrich→score→tier loop.
 *
 * No new column: the last hunt time lives in `companies.source_raw.hunt.last_hunt_at`
 * (stamped by enrich + refind). High-value accounts (tier A/B) hunt more often than
 * the rest. All gating decisions take `nowMs` as a parameter so they're pure/testable.
 */
const HOUR = 60 * 60 * 1000

export type HuntValue = 'high' | 'normal'

/** A/B tiers are high-value (hunt sooner); everything else is normal. */
export function huntValue(tier?: string | null): HuntValue {
  return tier === 'A' || tier === 'B' ? 'high' : 'normal'
}

/** Cooldown window before a parked company may be re-enriched. */
export function huntCadenceMs(value: HuntValue): number {
  return value === 'high' ? 12 * HOUR : 72 * HOUR
}

/** Read `last_hunt_at` out of a company's `source_raw` jsonb (null if never hunted). */
export function lastHuntAt(sourceRaw: unknown): string | null {
  const hunt = (sourceRaw as { hunt?: { last_hunt_at?: string } } | null)?.hunt
  return hunt?.last_hunt_at ?? null
}

/** Due for a (re-)hunt? True if never hunted or the cooldown has elapsed. */
export function isHuntDue(lastIso: string | null | undefined, cadenceMs: number, nowMs: number): boolean {
  if (!lastIso) return true
  const t = Date.parse(lastIso)
  if (Number.isNaN(t)) return true
  return nowMs - t >= cadenceMs
}

/** Convenience gate for a company given its tier + source_raw + current time. */
export function companyHuntDue(opts: { tier?: string | null; sourceRaw?: unknown; nowMs: number }): boolean {
  return isHuntDue(lastHuntAt(opts.sourceRaw), huntCadenceMs(huntValue(opts.tier ?? null)), opts.nowMs)
}

/** Merge a fresh hunt timestamp into source_raw, preserving other keys/fields. */
export function stampHunt(sourceRaw: unknown, nowIso: string): Record<string, unknown> {
  const raw = (sourceRaw as Record<string, unknown>) ?? {}
  const hunt = (raw.hunt as Record<string, unknown>) ?? {}
  return { ...raw, hunt: { ...hunt, last_hunt_at: nowIso } }
}
