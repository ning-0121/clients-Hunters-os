/**
 * Contact reachability gate.
 *
 * A company only proceeds to outreach/work once we actually have a usable way to
 * reach a person. Per product decision, a "valid contact" =
 *   - a VERIFIED / deliverable email  (computeCredibility tier === 'verified'), OR
 *   - a usable phone / WhatsApp number.
 * Guessed / Apollo-unverified / bounced emails do NOT count.
 *
 * Email OUTREACH specifically still needs a verified EMAIL (you can't email a
 * phone) — see `pickEmailableContact`. Phone-only companies are reachable (not
 * parked) but won't be auto-emailed.
 */
import { computeCredibility, type CredibilityInput } from '@/lib/contacts/credibility'

export interface ReachContact extends CredibilityInput {
  phone?: string | null
  whatsapp?: string | null
}

const digits = (s?: string | null) => (s ?? '').replace(/\D/g, '')

/** A phone or WhatsApp number with enough digits to actually dial. */
export function hasUsablePhone(c: ReachContact): boolean {
  return digits(c.phone).length >= 6 || digits(c.whatsapp).length >= 6
}

/** A contact with a verified/deliverable email (safe to email). */
export function hasSendableEmail(c: ReachContact): boolean {
  return computeCredibility(c).tier === 'verified'
}

/** Reachable by any valid channel: verified email OR usable phone/WhatsApp. */
export function isReachable(c: ReachContact): boolean {
  return hasSendableEmail(c) || hasUsablePhone(c)
}

/** Does this company have at least one reachable contact? */
export function hasValidContact(contacts?: ReachContact[] | null): boolean {
  return (contacts ?? []).some(isReachable)
}

/** Pick a contact we can safely EMAIL (verified email), or null. */
export function pickEmailableContact<T extends ReachContact>(contacts?: T[] | null): T | null {
  return (contacts ?? []).find(hasSendableEmail) ?? null
}
