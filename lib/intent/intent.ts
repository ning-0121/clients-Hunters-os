/**
 * Buying-Intent Engine V1 — "who is most worth contacting RIGHT NOW".
 *
 * computeIntent() is a zero-cost pure function over signals we already store on
 * the company (hiring, new products, funding, triggers, pain, engagement). A
 * separate scan action can refresh these from the web; this just scores them so
 * the BD desk and contact center can sort by intent immediately.
 */
export interface IntentSignalRow { label: string; weight: number; source?: string }

export interface IntentResult {
  score: number              // 0–10
  signals: IntentSignalRow[]
  reason: string             // one-line "why now"
  level: 'hot' | 'warm' | 'cool'
}

export interface IntentInput {
  hiring_signal?: boolean | null
  hiring_roles?: string[] | null
  recruitment_signals?: string[] | null
  management_pain_signals?: string[] | null
  new_products_detected?: boolean | null
  funding_detected?: boolean | null
  trigger_type?: string | null
  trigger_detail?: string | null
  status?: string | null
}

const PROCUREMENT_HINT = /(sourc|procure|采购|供应链|跟单|merchandis|buyer|supply)/i

export function computeIntent(c: IntentInput): IntentResult {
  const signals: IntentSignalRow[] = []
  let score = 0

  const roles = [...(c.hiring_roles ?? []), ...(c.recruitment_signals ?? [])]
  const hiringProcurement = roles.some((r) => PROCUREMENT_HINT.test(String(r)))
  if (hiringProcurement) { score += 4; signals.push({ label: '正在招采购/供应链/跟单岗 → 可能在找新供应商', weight: 4, source: 'hiring' }) }
  else if (c.hiring_signal || roles.length) { score += 2; signals.push({ label: '正在招人（扩张迹象）', weight: 2, source: 'hiring' }) }

  if (c.new_products_detected) { score += 2; signals.push({ label: '上新/增加产品线', weight: 2, source: 'website' }) }
  if (c.funding_detected) { score += 2; signals.push({ label: '近期融资（有预算）', weight: 2, source: 'news' }) }
  if (c.trigger_type) { score += 2; signals.push({ label: `触发事件：${c.trigger_detail || c.trigger_type}`, weight: 2, source: 'trigger' }) }
  if (Array.isArray(c.management_pain_signals) && c.management_pain_signals.length) {
    score += 1; signals.push({ label: `管理痛点：${c.management_pain_signals[0]}`, weight: 1, source: 'inferred' })
  }
  if (c.status === 'engaged' || c.status === 'qualified') { score += 2; signals.push({ label: '已在互动/有意向', weight: 2, source: 'crm' }) }

  score = Math.max(0, Math.min(10, score))
  const level = score >= 6 ? 'hot' : score >= 3 ? 'warm' : 'cool'
  const reason = signals.length ? signals.sort((a, b) => b.weight - a.weight)[0].label : '暂无明显采购信号'
  return { score, signals, reason, level }
}

export const INTENT_BADGE: Record<IntentResult['level'], { label: string; cls: string }> = {
  hot:  { label: '🔥 高意图', cls: 'bg-red-100 text-red-700' },
  warm: { label: '🟡 中意图', cls: 'bg-amber-100 text-amber-700' },
  cool: { label: '· 低意图', cls: 'bg-gray-100 text-gray-500' },
}
