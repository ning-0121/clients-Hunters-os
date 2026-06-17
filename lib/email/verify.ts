/**
 * Email deliverability check via Hunter's email-verifier before sending.
 * Blocks confirmed-undeliverable addresses so we don't waste sends or hurt
 * sender reputation. Graceful: if no key / error, we don't block (flag only).
 */
export interface EmailVerifyResult {
  status: string        // deliverable | undeliverable | risky | unknown | unverified | error
  hunterStatus?: string // valid | invalid | accept_all | webmail | disposable | unknown
  score?: number        // 0–100 confidence from Hunter
  block: boolean        // true only when confirmed undeliverable
}

export async function verifyEmail(email: string): Promise<EmailVerifyResult> {
  const key = process.env.HUNTER_API_KEY
  if (!key || !email) return { status: 'unverified', block: false }
  try {
    const url = new URL('https://api.hunter.io/v2/email-verifier')
    url.searchParams.set('email', email)
    url.searchParams.set('api_key', key)
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
    if (!res.ok) return { status: `http_${res.status}`, block: false }
    const data = await res.json() as { data?: { result?: string; status?: string; score?: number } }
    const result = data?.data?.result ?? 'unknown'
    return {
      status: result,
      hunterStatus: data?.data?.status,
      score: data?.data?.score,
      block: result === 'undeliverable',
    }
  } catch {
    return { status: 'error', block: false }
  }
}
