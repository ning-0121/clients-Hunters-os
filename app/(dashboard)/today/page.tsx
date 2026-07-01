import Link from 'next/link'
import { loadActionStream } from '@/lib/sales/load-action-stream'
import { isGmailConfigured } from '@/lib/email/gmail'
import { bulkApproveLowRisk } from '@/actions/action-stream'
import { ActionCardView } from './action-card'

export const dynamic = 'force-dynamic'

/**
 * /today — Execution OS Action Stream. The user sees ONLY actions to approve:
 * one PO_SCORE-ranked stream of executable Action Cards. No CRM, no dashboard,
 * no charts. Everything is Action → Approve → Outcome → Next Action.
 */
export default async function TodayPage() {
  const { stream, lowRisk, stuck, blocked, total } = await loadActionStream()
  const emailConfigured = isGmailConfigured()

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold mb-1">今日行动流</h1>
      <p className="text-xs text-muted-foreground mb-4">从上往下批准发送 —— 这就是数学上最优的 PO 产出顺序。你只审批，不写字。</p>

      {!emailConfigured && (
        <div className="rounded-md border-2 border-red-300 bg-red-50 px-4 py-2.5 mb-4 text-sm text-red-800">
          🔴 邮件未配置 —— 发送已禁用，不会假发送。在 Vercel 生产环境填入 GMAIL/SMTP 后即可一键发送。
        </div>
      )}

      {/* ── PRIMARY: one ranked Action Stream ── */}
      {stream.length === 0 ? (
        <div className="rounded-lg border px-4 py-10 text-center text-sm text-muted-foreground">
          没有可执行的行动卡。
          {blocked.length > 0 && <> {blocked.length} 个账户缺可达联系人 —— 见下方「缺联系人」。</>}
        </div>
      ) : (
        <div className="space-y-3">
          {stream.map((c) => (
            <ActionCardView key={c.accountId} card={c} emailConfigured={emailConfigured} />
          ))}
        </div>
      )}

      {/* ── SECONDARY collapsed lanes ── */}
      <div className="mt-6 space-y-2">
        {/* Low Risk Bulk Approve */}
        {lowRisk.length > 0 && (
          <details className="rounded-lg border">
            <summary className="px-4 py-2.5 text-sm font-medium cursor-pointer flex items-center justify-between">
              <span>🟢 低风险批量批准（{lowRisk.length}）—— 邮箱已验证，可一键发</span>
            </summary>
            <div className="p-3 border-t space-y-2">
              <form action={bulkApproveLowRisk}>
                <button
                  disabled={!emailConfigured}
                  className="px-4 py-2 rounded-md bg-green-600 text-white text-sm font-semibold hover:bg-green-700 disabled:opacity-40"
                >
                  ✅ 全部批准并发送（{lowRisk.length} 封）
                </button>
                {!emailConfigured && <span className="text-[11px] text-red-600 ml-2">邮件未配置</span>}
              </form>
              <div className="space-y-2 pt-1">
                {lowRisk.map((c) => (
                  <ActionCardView key={c.accountId} card={c} emailConfigured={emailConfigured} compact />
                ))}
              </div>
            </div>
          </details>
        )}

        {/* Stuck Opportunities */}
        {stuck.length > 0 && (
          <details className="rounded-lg border">
            <summary className="px-4 py-2.5 text-sm font-medium cursor-pointer">⏳ 卡住的机会（{stuck.length}）—— 长时间无进展，换钩子/换人</summary>
            <div className="p-3 border-t space-y-2">
              {stuck.map((c) => (
                <ActionCardView key={c.accountId} card={c} emailConfigured={emailConfigured} compact />
              ))}
            </div>
          </details>
        )}

        {/* Missing Contact (blocked) */}
        {blocked.length > 0 && (
          <details className="rounded-lg border border-amber-200">
            <summary className="px-4 py-2.5 text-sm font-medium cursor-pointer text-amber-700">
              🔒 缺联系人 · 已锁（{blocked.length}）—— 无可达决策人，先补联系人才能进队列
            </summary>
            <div className="p-3 border-t divide-y">
              {blocked.map((c) => (
                <Link key={c.accountId} href={`/companies/${c.accountId}`} className="flex items-center gap-3 px-1 py-2 text-sm hover:bg-accent/40">
                  <span className="font-medium w-44 truncate">{c.companyName}</span>
                  <span className="text-muted-foreground text-xs flex-1 truncate">预期PO影响 ${Math.round(c.poImpactUsd / 1000)}k · {c.whyNow}</span>
                  <span className="text-xs text-primary shrink-0">补联系人 →</span>
                </Link>
              ))}
            </div>
          </details>
        )}
      </div>

      <p className="text-[10px] text-muted-foreground/70 mt-4 text-center">共 {total} 个账户 · 按 PO_SCORE 排序 · Action → Approve → Outcome → Next Action</p>
    </div>
  )
}
