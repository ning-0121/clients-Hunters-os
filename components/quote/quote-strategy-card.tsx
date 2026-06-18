import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { createServiceClient } from '@/lib/supabase/server'
import { computeQuoteStrategyForCompany, triggerQuoteStrategy } from '@/actions/quote'
import { pct, type QuoteStrategy, type ScoreResult } from '@/lib/quote/engine'
import {
  QUOTE_CATEGORIES, DEFAULT_PRICING, FABRIC_COMPLEXITY_LABELS,
  type QuoteCategory, type FabricComplexity,
} from '@/lib/quote/pricing-config'
import { QuoteMessageBlock } from '@/components/quote/quote-message-block'

const COMPETITION_LABELS: Record<string, string> = { weak: '弱', normal: '一般', strong: '强', extreme: '极端' }
const COMPETITION_SOURCE_LABELS: Record<string, string> = { manual: '手动标注', stored: '已存标注', inferred: '海关推断', none: '未标注' }

const SAMPLE_LABELS: Record<QuoteStrategy['samplePolicy']['policy'], { label: string; cls: string }> = {
  free:    { label: '免费寄送（战略投资）', cls: 'bg-emerald-100 text-emerald-800' },
  partial: { label: '收成本 · 成交后可抵扣', cls: 'bg-amber-100 text-amber-800' },
  full:    { label: '全额收费（过滤比价）', cls: 'bg-gray-100 text-gray-600' },
}

/** Higher-is-better score bar (green→amber→gray). */
function ScoreBar({ label, s, invert = false }: { label: string; s: number; invert?: boolean }) {
  const good = invert ? s < 40 : s >= 60
  const mid = invert ? s < 60 : s >= 40
  const color = good ? 'bg-green-500' : mid ? 'bg-yellow-500' : invert ? 'bg-red-500' : 'bg-gray-400'
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-16 shrink-0">{label}</span>
      <div className="flex-1 bg-muted rounded-full h-1.5">
        <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${s}%` }} />
      </div>
      <span className="text-[11px] font-mono w-7 text-right">{s}</span>
    </div>
  )
}

function Factors({ r }: { r: ScoreResult }) {
  if (!r.factors.length) return null
  return (
    <ul className="space-y-0.5 mt-1">
      {r.factors.map((f, i) => (
        <li key={i} className="flex gap-1.5 text-[11px]">
          <span>{f.effect === 'good' ? '🟢' : f.effect === 'bad' ? '🔴' : '⚪'}</span>
          <span><span className="font-medium">{f.label}</span> — {f.note}</span>
        </li>
      ))}
    </ul>
  )
}

export async function QuoteStrategyCard({ companyId }: { companyId: string }) {
  const supabase = await createServiceClient()

  // Recent snapshots → form defaults, pending approval, message, history (P1 #7).
  // select('*') so the card still works if migration 011 (quote_message cols) isn't applied yet.
  const { data: history } = await supabase
    .from('quote_strategies')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(8)
  const last = history?.[0] ?? null

  const category = ((last?.category as string) && (QUOTE_CATEGORIES as string[]).includes(last!.category as string)
    ? last!.category : 'leggings') as QuoteCategory
  const baseline = DEFAULT_PRICING[category]
  const qty = (typeof last?.qty === 'number' && last.qty > 0 ? last.qty : baseline.moq * 20)
  const fabricComplexity = (['low', 'medium', 'high'].includes(String(last?.fabric_complexity))
    ? last!.fabric_complexity : 'medium') as FabricComplexity

  // Live, re-computable recommendation from current customer signals.
  const strategy = await computeQuoteStrategyForCompany(companyId, { category, qty, fabricComplexity })

  let approvalPending = false
  if (last?.approval_id) {
    const { data: appr } = await supabase.from('approvals').select('status').eq('id', last.approval_id as string).maybeSingle()
    approvalPending = appr?.status === 'pending'
  }

  if (!strategy) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">报价策略</CardTitle></CardHeader>
        <CardContent className="py-4 text-sm text-muted-foreground">无法计算报价策略（客户数据缺失）。</CardContent>
      </Card>
    )
  }

  const m = strategy.margins
  const p = strategy.prices
  const sample = SAMPLE_LABELS[strategy.samplePolicy.policy]

  return (
    <Card className={strategy.requiresOwnerApproval ? 'ring-2 ring-red-300' : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          报价策略
          <Badge variant="outline" className="text-[10px]">建议 · recommendation</Badge>
          {strategy.isStrategicCustomer && <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-100 text-purple-800">战略客户</span>}
          <span className="text-[10px] text-muted-foreground ml-auto">{strategy.categoryLabel} × {strategy.qty}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">

        {/* Owner-approval banner (red) — sub-floor strategic band unlocked */}
        {strategy.requiresOwnerApproval && (
          <div className="rounded-md border border-red-300 bg-red-50 p-2 space-y-1">
            <p className="text-red-700 font-medium">⚠ 含战略报价（低于普通底线）— 仅老板审批后允许执行</p>
            <p className="text-red-700/80 text-[11px]">{strategy.strategicNote}</p>
            <p className="text-red-700/80 text-[11px]">业务员不可自行标记为可报价。{approvalPending ? '已创建审批，去 ' : '保存后将创建审批；去 '}<Link href="/approvals" className="underline">审批中心</Link> 处理。</p>
          </div>
        )}

        {/* Scores */}
        <div className="space-y-1">
          <ScoreBar label="成交概率" s={strategy.scores.winProbability.score} />
          <ScoreBar label="风险" s={strategy.scores.risk.score} invert />
          <ScoreBar label="定价权" s={strategy.scores.pricing.score} />
          <ScoreBar label="单值" s={strategy.scores.dealValue.score} />
          <ScoreBar label="战略价值" s={strategy.scores.strategicValue.score} />
        </div>

        {/* Competition signal provenance (P1 #6) */}
        {strategy.competition && (strategy.competition.level || strategy.competition.isPriceComparing !== null) && (
          <p className="text-[10px] text-muted-foreground">
            竞争：{strategy.competition.level ? COMPETITION_LABELS[strategy.competition.level] : '—'}
            {strategy.competition.isPriceComparing === true ? ' · 比价' : strategy.competition.isPriceComparing === false ? ' · 不比价' : ''}
            <span className="ml-1">（{COMPETITION_SOURCE_LABELS[strategy.competition.source]}）</span>
          </p>
        )}

        {/* Margin ladder */}
        <div className="border-t pt-2 space-y-1">
          <div className="flex items-center gap-1 flex-wrap text-[11px]">
            <span className="text-muted-foreground">利润率</span>
            {strategy.requiresOwnerApproval && (
              <><span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">战略 {pct(m.strategic)}</span><span className="text-muted-foreground">→</span></>
            )}
            <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">底线 {pct(m.floor)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">推荐 {pct(m.recommended)}</span>
            <span className="text-muted-foreground">→</span>
            <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">目标 {pct(m.target)}</span>
          </div>
          <div className="text-[11px]">
            <span className="text-muted-foreground">推荐报价 </span>
            <span className="font-mono font-medium">${p.recommended}/件</span>
            <span className="text-muted-foreground">　区间 </span>
            <span className="font-mono">${p.rangeLow}–${p.rangeHigh}</span>
            <span className="text-muted-foreground">　(成本基准 ${p.unitCost}/件)</span>
          </div>
          {strategy.needsRealCost && (
            <p className="text-[10px] text-amber-700">⚠ 成本为系统默认基准，请在 pricing_config 确认真实成本后再据此报价</p>
          )}
        </div>

        {/* Allow / forbid */}
        <div className="border-t pt-2 space-y-1.5">
          {strategy.negotiation.allow.length > 0 && (
            <div>
              <p className="text-green-700 font-medium text-[11px]">✅ 可以让步</p>
              <ul className="space-y-0.5 mt-0.5">
                {strategy.negotiation.allow.map((r, i) => (
                  <li key={i} className="text-[11px]"><span className="font-medium">{r.label}</span> <span className="text-muted-foreground">— {r.reason}</span></li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-red-700 font-medium text-[11px]">⛔ 禁止</p>
            <ul className="space-y-0.5 mt-0.5">
              {strategy.negotiation.forbid.map((r, i) => (
                <li key={i} className="text-[11px]"><span className="font-medium">{r.label}</span> <span className="text-muted-foreground">— {r.reason}</span></li>
              ))}
            </ul>
          </div>
          {strategy.negotiation.warnings.map((w, i) => (
            <p key={i} className="text-[11px] text-amber-700">⚠ {w}</p>
          ))}
        </div>

        {/* Sample policy */}
        <div className="border-t pt-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-muted-foreground text-[11px]">样品策略</span>
            <span className={`text-[10px] px-2 py-0.5 rounded-full ${sample.cls}`}>{sample.label}</span>
            {strategy.samplePolicy.requiresOwnerApproval && <span className="text-[10px] text-red-700">（免费样品建议老板审批）</span>}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{strategy.samplePolicy.reason}</p>
        </div>

        {/* Explainability */}
        <details className="border-t pt-2">
          <summary className="text-[11px] text-muted-foreground cursor-pointer select-none">为什么这样建议？（点开看解释 + 评分依据）</summary>
          <div className="mt-1.5 space-y-1.5 text-[11px]">
            <p><span className="font-medium">利润率：</span>{strategy.explanation.margin}</p>
            <p><span className="font-medium">让步：</span>{strategy.explanation.concession}</p>
            <p><span className="font-medium">样品：</span>{strategy.explanation.sample}</p>
            <p className="text-muted-foreground">{strategy.explanation.overall}</p>
            <div className="grid grid-cols-1 gap-1.5 pt-1">
              {([
                ['成交概率', strategy.scores.winProbability],
                ['风险', strategy.scores.risk],
                ['定价权', strategy.scores.pricing],
                ['单值', strategy.scores.dealValue],
                ['战略价值', strategy.scores.strategicValue],
              ] as [string, ScoreResult][]).map(([lbl, r]) => (
                <div key={lbl} className="border-t pt-1">
                  <span className="font-medium text-[11px]">{lbl} {r.score}</span>
                  <Factors r={r} />
                </div>
              ))}
            </div>
          </div>
        </details>

        {/* Recompute form */}
        <form action={triggerQuoteStrategy} className="border-t pt-2 space-y-1.5">
          <input type="hidden" name="companyId" value={companyId} />
          <div className="grid grid-cols-2 gap-1.5">
            <label className="text-[10px] text-muted-foreground">品类
              <select name="category" defaultValue={category} className="mt-0.5 w-full text-xs px-2 py-1 border rounded-md bg-background">
                {QUOTE_CATEGORIES.map((c) => <option key={c} value={c}>{DEFAULT_PRICING[c].label}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-muted-foreground">数量
              <input name="qty" type="number" min={1} defaultValue={qty} className="mt-0.5 w-full text-xs px-2 py-1 border rounded-md bg-background" />
            </label>
            <label className="text-[10px] text-muted-foreground">面料复杂度
              <select name="fabricComplexity" defaultValue={fabricComplexity} className="mt-0.5 w-full text-xs px-2 py-1 border rounded-md bg-background">
                {(['low', 'medium', 'high'] as FabricComplexity[]).map((c) => <option key={c} value={c}>{FABRIC_COMPLEXITY_LABELS[c]}</option>)}
              </select>
            </label>
            <label className="text-[10px] text-muted-foreground">是否比价
              <select name="isPriceComparing" defaultValue="" className="mt-0.5 w-full text-xs px-2 py-1 border rounded-md bg-background">
                <option value="">未知</option>
                <option value="yes">在比价</option>
                <option value="no">不比价</option>
              </select>
            </label>
            <label className="text-[10px] text-muted-foreground col-span-2">竞争强度
              <select name="competitionLevel" defaultValue="" className="mt-0.5 w-full text-xs px-2 py-1 border rounded-md bg-background">
                <option value="">未标注</option>
                <option value="weak">弱</option>
                <option value="normal">一般</option>
                <option value="strong">强</option>
                <option value="extreme">极端（红海）</option>
              </select>
            </label>
          </div>
          <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-full">
            重新计算并保存快照
          </button>
        </form>

        {/* Quote message (P1 #5) — customer-readable draft, copy only, never auto-sent */}
        <QuoteMessageBlock
          companyId={companyId}
          message={(last?.quote_message as string) ?? null}
          lang={(last?.quote_message_lang as string) ?? null}
          generatedAt={(last?.quote_message_at as string) ?? null}
          hasSnapshot={!!last}
        />

        {/* History (P1 #7) */}
        {history && history.length > 0 && (
          <details className="border-t pt-2">
            <summary className="text-[11px] text-muted-foreground cursor-pointer select-none">历史报价（{history.length}）</summary>
            <div className="mt-1.5 space-y-1">
              {history.map((h) => (
                <div key={h.id as string} className="flex items-center gap-2 text-[10px] border-b last:border-0 pb-1 flex-wrap">
                  <span className="text-muted-foreground shrink-0">{new Date(h.created_at as string).toLocaleDateString()}</span>
                  <span className="shrink-0">{DEFAULT_PRICING[h.category as QuoteCategory]?.label ?? (h.category as string)} ×{h.qty as number}</span>
                  <span className="text-muted-foreground">成交{h.win_probability as number} 险{h.risk_score as number} 战略{h.strategic_value_score as number}</span>
                  <span>推荐 {pct(Number(h.recommended_margin))} · ${h.recommended_price as number}/件</span>
                  <span className="text-muted-foreground">样品{({ free: '免', partial: '半', full: '全' } as Record<string, string>)[h.sample_policy as string] ?? '—'}</span>
                  {(h.requires_owner_approval as boolean) && <span className="text-red-600">需审批</span>}
                </div>
              ))}
            </div>
          </details>
        )}

        <p className="text-[10px] text-muted-foreground/70 border-t pt-1.5">{strategy.disclaimer}　获客投入(CAC)：待接入。</p>
      </CardContent>
    </Card>
  )
}
