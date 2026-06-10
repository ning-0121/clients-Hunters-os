/**
 * Transient-error retry with exponential backoff + jitter.
 *
 * Used for LLM (Anthropic) calls and Supabase writes that occasionally hit
 * transient network/provider failures (Connection error, fetch failed,
 * ECONNRESET, ETIMEDOUT, 429, 5xx, overloaded). Deterministic failures
 * (Zod/schema/business-rule/parse-after-repair) must NOT be retried.
 */

const TRANSIENT_PATTERNS = [
  'connection error', 'fetch failed', 'econnreset', 'etimedout', 'enotfound',
  'socket hang up', 'network', 'timeout', 'overloaded', 'temporarily',
  'rate limit', 'too many requests', 'service unavailable', 'bad gateway', 'gateway timeout',
]

export function isTransientError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string } | undefined
  const status = e?.status ?? e?.statusCode
  if (typeof status === 'number') {
    if (status === 429 || status === 529 || status >= 500) return true
  }
  const msg = String(e?.message ?? err ?? '').toLowerCase()
  return TRANSIENT_PATTERNS.some((p) => msg.includes(p))
}

export interface RetryOptions {
  /** Total attempts (default 3): immediate, then short delay, then longer delay. */
  retries?: number
  label?: string
  /** Override which errors are retryable (default: isTransientError). */
  isRetryable?: (e: unknown) => boolean
  onRetry?: (attempt: number, err: unknown) => void
}

/** Run `fn`, retrying transient failures up to `retries` attempts. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3
  const isRetryable = opts.isRetryable ?? isTransientError
  let lastErr: unknown
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (attempt >= retries || !isRetryable(e)) break
      opts.onRetry?.(attempt, e)
      // attempt 1 fail → ~0.5s, attempt 2 fail → ~1.5s, plus jitter
      const base = attempt === 1 ? 500 : 1500
      const jitter = Math.floor(Math.random() * 300)
      await new Promise((r) => setTimeout(r, base + jitter))
    }
  }
  throw lastErr
}
