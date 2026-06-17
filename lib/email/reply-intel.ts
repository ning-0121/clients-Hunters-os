/**
 * Reply intelligence — shared by the live IMAP scanner and the historical
 * reprocess action. Cleans MIME bodies and classifies replies into actionable
 * buckets. Bounce / auto-reply / unsubscribe must NOT become "客户回复待处理".
 */

/** Pull a readable text body out of a raw MIME message (or a half-parsed one). */
export function cleanReplyBody(raw: string): string {
  let text = raw ?? ''

  // If this looks like multipart MIME, extract the text/plain part.
  const boundaryMatch = text.match(/boundary="?([^"\s;]+)"?/i)
  if (boundaryMatch && /content-type:\s*multipart/i.test(text)) {
    const boundary = boundaryMatch[1]
    const parts = text.split(new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`))
    const plain = parts.find((p) => /content-type:\s*text\/plain/i.test(p))
    const html  = parts.find((p) => /content-type:\s*text\/html/i.test(p))
    const chosen = plain ?? html ?? ''
    // Drop the part headers (everything up to the first blank line).
    text = chosen.replace(/^[\s\S]*?\r?\n\r?\n/, '')
  }

  return text
    .replace(/<\/?[^>]+>/g, ' ')                       // strip HTML tags
    .replace(/^content-(type|transfer-encoding):.*$/gim, '')
    .replace(/^--[A-Za-z0-9'()+_,\-./:=?]+--?$/gm, '') // leftover MIME boundaries
    .replace(/=\r?\n/g, '')                            // quoted-printable soft breaks
    .replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/^>.*$/gm, '')                            // quoted history
    .replace(/^On .{0,120}wrote:$/gm, '')
    .replace(/^From:.*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, 2000)
}

export function isBounce(from: string, subject: string, body: string): boolean {
  const f = (from ?? '').toLowerCase()
  const s = (subject ?? '').toLowerCase()
  const b = (body ?? '').toLowerCase().slice(0, 1200)
  if (/mailer-daemon|postmaster@|mail delivery (system|subsystem)|no-?reply@.*(mail|delivery)/.test(f)) return true
  if (/delivery status notification|undelivered mail returned|mail delivery (failed|subsystem)|returned to sender|failure notice|delivery has failed|delivery incomplete/.test(s)) return true
  if (/address (not found|couldn'?t be found)|recipient.*(not found|rejected|does not exist)|550[ -]|no such user|user unknown|mailbox (unavailable|full|not found)/.test(b)) return true
  return false
}

export function isAutoReply(from: string, subject: string, body: string): boolean {
  const s = (subject ?? '').toLowerCase()
  const b = (body ?? '').toLowerCase().slice(0, 600)
  const f = (from ?? '').toLowerCase()
  if (/auto[- ]?reply|automatic reply|out of office|ooo|on (vacation|leave|holiday)|away from( the)? office|自动回复|休假/.test(s + ' ' + b)) return true
  if (/no-?reply@|donotreply@/.test(f) && !isBounce(from, subject, body)) return true
  return false
}

export function isUnsubscribe(body: string): boolean {
  const b = (body ?? '').toLowerCase()
  return /unsubscribe|remove me|stop emailing|opt[- ]?out|退订|取消订阅/.test(b)
}

export function classifySentiment(body: string): string {
  const lower = (body ?? '').toLowerCase()
  const neg = ['not interested', 'no thanks', 'wrong person', "don't contact", 'no need']
  const pos = ['interested', 'tell me more', 'sounds good', "let's talk", 'schedule', 'would love',
    'send catalog', 'pricing', 'sample', 'quote', 'love to', 'can we']
  if (isUnsubscribe(lower) || neg.some((w) => lower.includes(w))) return 'not_interested'
  if (pos.some((w) => lower.includes(w))) return 'positive'
  return 'neutral'
}

/** Full classification including bounce / auto-reply / unsubscribe / objection. */
export function classifyReplyIntent(from: string, subject: string, body: string): string {
  if (isBounce(from, subject, body)) return 'bounce'
  if (isAutoReply(from, subject, body)) return 'auto_reply'
  if (isUnsubscribe(body)) return 'unsubscribe'
  const lower = (body ?? '').toLowerCase()
  if (lower.includes('sample')) return 'want_sample'
  if (lower.includes('catalog') || lower.includes('catalogue')) return 'want_catalog'
  if (lower.includes('price') || lower.includes('quote') || lower.includes('cost')) return 'want_quote'
  if (/\b(call|meeting|zoom|schedule|chat)\b/.test(lower)) return 'want_meeting'
  if (lower.includes('wrong person') || lower.includes('not the right')) return 'wrong_person'
  if (lower.includes('not interested') || lower.includes('no thanks')) return 'not_interested'
  if (/too (expensive|high)|moq|already have|existing supplier|not now|maybe later|budget/.test(lower)) return 'objection'
  return 'general_reply'
}

/** Intents that must NOT create a "客户回复待处理" task. */
export const NON_ACTIONABLE_INTENTS = new Set(['bounce', 'auto_reply', 'unsubscribe', 'not_interested', 'wrong_person'])
