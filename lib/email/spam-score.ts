/**
 * Lightweight spam-risk lint for outbound email drafts (deliverability P2).
 *
 * Not a full SpamAssassin — a fast heuristic that flags the patterns that most
 * commonly land cold B2B email in spam (trigger words, shouting, link/price
 * stuffing, group-blast salutations, AI-bloat length). Surfaced in the approval
 * UI so a human sees the risk before sending; also usable to gate auto-sends.
 */
export interface SpamSignal { label: string; hint: string; weight: number }
export interface SpamScore { score: number; level: 'low' | 'medium' | 'high'; signals: SpamSignal[] }

const TRIGGER_WORDS = [
  'free', 'guarantee', 'guaranteed', 'act now', 'limited time', 'click here', 'buy now',
  'order now', 'cheap', 'discount', 'lowest price', 'best price', 'risk-free', 'no risk',
  '100%', 'winner', 'congratulations', 'urgent', 'cash', 'earn money', 'make money',
  'special promotion', 'this is not spam', 'dear friend', 'amazing offer',
  'incredible', 'once in a lifetime', 'why pay more', 'satisfaction guaranteed',
]

// Domain acronyms that are legitimately upper-case (don't count as "shouting").
const OK_CAPS = new Set(['MOQ', 'OEM', 'ODM', 'GOTS', 'OEKO', 'TEX', 'GRS', 'BSCI', 'WRAP', 'SMETA', 'SEDEX', 'USA', 'EU', 'UK', 'FOB', 'DTC', 'PDF', 'AI', 'ISO', 'QC'])

export function scoreSpamRisk(subject = '', body = ''): SpamScore {
  const signals: SpamSignal[] = []
  const text = `${subject}\n${body}`
  const lower = text.toLowerCase()
  const add = (label: string, hint: string, weight: number) => signals.push({ label, hint, weight })

  const hits = TRIGGER_WORDS.filter((w) => lower.includes(w))
  if (hits.length) add('垃圾触发词', `含：${hits.slice(0, 5).join('、')}`, Math.min(40, hits.length * 12))

  const bangs = (text.match(/!/g) || []).length
  if (bangs >= 3) add('感叹号过多', `${bangs} 个 "!"`, Math.min(20, bangs * 4))

  const capsWords = (text.match(/\b[A-Z]{3,}\b/g) || []).filter((w) => !OK_CAPS.has(w))
  if (capsWords.length >= 3) add('全大写过多', `${capsWords.length} 个全大写词`, Math.min(20, capsWords.length * 4))

  const links = (text.match(/https?:\/\/[^\s)]+/g) || []).length
  if (links > 2) add('链接过多', `${links} 个链接（建议 ≤1）`, Math.min(20, (links - 2) * 8))

  const money = (text.match(/\$\s?\d|\d+\s?%|￥\s?\d/g) || []).length
  if (money >= 4) add('价格/百分比堆砌', `${money} 处`, Math.min(15, money * 3))

  if (/dear (friend|sir|sir or madam|customer|valued)/i.test(text)) add('群发称呼', '"Dear friend/sir" 群发感', 12)

  const words = body.trim().split(/\s+/).filter(Boolean).length
  if (words > 200) add('正文过长', `${words} 词（>200 像 AI 群发）`, 12)
  else if (words > 0 && words < 12) add('正文过短', `${words} 词`, 8)

  if (subject && /^[A-Z\s!?]{10,}$/.test(subject)) add('主题全大写', '主题全大写极易进垃圾箱', 15)
  if ((subject.match(/!/g) || []).length) add('主题含感叹号', '主题里的 "!" 触发过滤', 8)

  const score = Math.min(100, signals.reduce((s, x) => s + x.weight, 0))
  const level: SpamScore['level'] = score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low'
  return { score, level, signals }
}

export const SPAM_LEVEL_LABEL: Record<SpamScore['level'], string> = {
  low: '🟢 垃圾风险低', medium: '🟡 垃圾风险中', high: '🔴 垃圾风险高',
}
