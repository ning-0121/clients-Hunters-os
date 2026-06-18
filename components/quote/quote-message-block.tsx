'use client'

import { useState } from 'react'
import { generateQuoteMessage } from '@/actions/quote'

/**
 * P1 #5 — customer-readable quote message (LLM draft). The salesperson copies
 * it manually; nothing is auto-sent. Sample terms are added by hand.
 */
export function QuoteMessageBlock({
  companyId, message, lang, generatedAt, hasSnapshot,
}: {
  companyId: string
  message: string | null
  lang: string | null
  generatedAt: string | null
  hasSnapshot: boolean
}) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — user can select manually */ }
  }

  return (
    <div className="border-t pt-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] font-medium">报价话术（给客户 · 草稿）</span>
        {lang && <span className="text-[10px] text-muted-foreground uppercase">{lang}</span>}
        {generatedAt && <span className="text-[10px] text-muted-foreground">{new Date(generatedAt).toLocaleString()}</span>}
      </div>

      {!hasSnapshot ? (
        <p className="text-[11px] text-muted-foreground">先点上方「重新计算并保存快照」生成策略，再生成报价话术。</p>
      ) : message ? (
        <>
          <textarea readOnly value={message} rows={6}
            className="w-full text-[11px] px-2 py-1.5 border rounded-md bg-background leading-relaxed" />
          <div className="flex gap-1.5 items-center">
            <button type="button" onClick={copy} className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">
              {copied ? '已复制 ✓' : '复制'}
            </button>
            <form action={generateQuoteMessage}>
              <input type="hidden" name="companyId" value={companyId} />
              <button type="submit" className="text-[11px] px-2 py-1 border rounded-md hover:bg-accent">重新生成</button>
            </form>
          </div>
          <p className="text-[10px] text-muted-foreground/70">⚠ 草稿仅供参考：请审阅、自行补充样品条款后<strong>人工</strong>发送；系统不会自动发送给客户。</p>
        </>
      ) : (
        <form action={generateQuoteMessage}>
          <input type="hidden" name="companyId" value={companyId} />
          <button type="submit" className="text-xs px-3 py-1.5 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors w-full">
            生成报价话术（LLM）
          </button>
        </form>
      )}
    </div>
  )
}
