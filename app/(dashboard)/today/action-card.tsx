'use client'

import { useState } from 'react'
import { approveAndSendCard, skipActionCard } from '@/actions/action-stream'
import { ACTION_LABEL, type ActionCard } from '@/lib/sales/action-card'
import { validateActionCard } from '@/lib/sales/execution-contract'

const URGENCY: Record<string, { dot: string; cls: string }> = {
  NOW: { dot: '🔴 NOW', cls: 'text-red-600' },
  TODAY: { dot: '🟠 TODAY', cls: 'text-amber-600' },
  SOON: { dot: '🟡 SOON', cls: 'text-yellow-600' },
}
const RISK: Record<string, string> = { LOW: 'text-green-700 bg-green-50', MEDIUM: 'text-amber-700 bg-amber-50', HIGH: 'text-red-700 bg-red-50' }
const usd = (n: number) => `$${Math.round(n / 1000)}k`

export function ActionCardView({ card, emailConfigured, compact = false }: { card: ActionCard; emailConfigured: boolean; compact?: boolean }) {
  const [skipping, setSkipping] = useState(false)
  const u = URGENCY[card.urgency]
  const contract = validateActionCard(card) // deterministic execution gate
  const canSend = emailConfigured && contract.executable

  return (
    <div className={`rounded-lg border ${card.urgency === 'NOW' ? 'border-red-300' : 'border-border'} ${compact ? '' : 'shadow-sm'}`}>
      {/* header — company · score · urgency (no dashboard metrics) */}
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between gap-2 text-xs">
        <span className="flex items-center gap-2 min-w-0">
          <span className="font-bold text-sm truncate">{card.companyName}</span>
          <span className={`px-1.5 py-0.5 rounded ${RISK[card.riskLevel]}`}>{card.riskLevel}</span>
          <span className="text-muted-foreground">{ACTION_LABEL[card.actionType]}</span>
        </span>
        <span className={`font-semibold shrink-0 ${u.cls}`}>{u.dot}</span>
      </div>

      <div className="p-4 space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span>PO_SCORE <b className="text-base text-foreground">{card.poScore}</b></span>
          <span className="text-muted-foreground">预期PO影响 <b className="text-foreground">{usd(card.poImpactUsd)}</b></span>
          <span className="text-muted-foreground">
            联系人 {card.contact.name}
            {card.contact.role !== 'unknown' && ` · ${card.contact.role}`}
            {card.contact.reachable ? ' 🟢' : ' 🔴未验证'}
          </span>
        </div>

        {/* strategy attribution + causal vector (Strategy OS · V7) */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-medium">🎯 {card.strategyName}</span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">wedge: {card.wedge}</span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">cta: {card.cta}</span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">→ {card.expectedOutcome}</span>
          <span className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            向量 M{card.strategyVector.message.toFixed(2)}·T{card.strategyVector.timing.toFixed(2)}·C{card.strategyVector.contact.toFixed(2)}
          </span>
        </div>
        <div className="text-[11px] text-indigo-600/80">{card.whyStrategySelected}</div>

        {/* why now — one line */}
        <div className="text-sm"><span className="text-muted-foreground text-xs">为什么现在：</span>{card.whyNow}</div>

        {/* prewritten message — editable, submitted with Approve */}
        <form action={approveAndSendCard} className="space-y-1.5">
          <input type="hidden" name="accountId" value={card.accountId} />
          <input type="hidden" name="contactId" value={card.contactId ?? ''} />
          <input name="subject" defaultValue={card.message.subject} className="w-full px-2 py-1 border rounded text-xs bg-background font-medium" />
          <textarea name="body" defaultValue={card.message.body} rows={compact ? 3 : 4} className="w-full px-2 py-1.5 border rounded text-xs bg-background font-sans leading-relaxed" />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={!canSend}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-40"
            >
              ✅ Approve &amp; Send
            </button>
            <button type="button" onClick={() => setSkipping((s) => !s)} className="px-3 py-2 border rounded-md text-sm text-muted-foreground hover:bg-accent">
              跳过
            </button>
            {!emailConfigured && <span className="text-[11px] text-red-600">邮件未配置</span>}
            {emailConfigured && !contract.executable && (
              <span className="text-[11px] text-amber-700">不可执行：{contract.riskFlags.join('·') || contract.missingFields.join('·')}</span>
            )}
            {contract.allowAutoSend && <span className="text-[11px] text-green-700">✓ 可自动发送</span>}
          </div>
        </form>

        {/* skip → require reason (downgrades / defers) */}
        {skipping && (
          <form action={skipActionCard} className="flex items-center gap-2 pt-1">
            <input type="hidden" name="accountId" value={card.accountId} />
            <input name="reason" required placeholder="跳过原因（累积为学习信号）" className="flex-1 px-2 py-1 border rounded text-xs bg-background" />
            <button type="submit" className="px-3 py-1.5 border rounded text-xs hover:bg-accent">确认跳过</button>
          </form>
        )}

        {/* next step preview */}
        {card.nextStepPreview && (
          <div className="text-[11px] text-muted-foreground pt-0.5">下一步：{card.nextStepPreview}</div>
        )}
      </div>
    </div>
  )
}
