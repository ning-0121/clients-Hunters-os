import Link from 'next/link'
import { loadOpps, loadNeedsContact } from '@/lib/sales/load-opps'
import { moneyRow, DEV_CLASS } from '@/lib/sales/revenue-os'
import { FUNNEL_LABEL, stageIndex, type FunnelStage } from '@/lib/sales/order-engine'

export const dynamic = 'force-dynamic'
const usd = (n: number) => `$${Math.round(n / 1000)}k`

// Path to PO — milestones, current/passed dimmed, next one bold.
const MILESTONES: { stage: FunnelStage; label: string }[] = [
  { stage: 'outreach_sent', label: '触达' }, { stage: 'replied', label: '回复' },
  { stage: 'sample_sent', label: '样品' }, { stage: 'quotation', label: '报价' }, { stage: 'trial_order', label: 'PO' },
]

/**
 * Asset View — the salesperson holds a portfolio of revenue positions, not a
 * contact list. Each Asset = an account the system is actively driving toward a
 * PO: value + the move it's waiting on + the auto-plan ahead. Ranked by value.
 */
export default async function AssetsPage() {
  const [opps, needsContact] = await Promise.all([loadOpps(), loadNeedsContact()])
  const assets = opps.map(moneyRow).filter((m) => m.o.klass === 'develop').sort((a, b) => b.prob * b.value - a.prob * a.value)
  const portfolioUsd = assets.reduce((s, a) => s + a.prob * a.value, 0)

  const Path = ({ stage }: { stage: FunnelStage }) => (
    <span className="text-[11px]">
      {MILESTONES.map((m, i) => {
        const cur = stageIndex(stage)
        const here = stageIndex(m.stage) === Math.min(cur + 1, stageIndex('trial_order')) && cur < stageIndex('trial_order')
        const passed = stageIndex(m.stage) <= cur
        return (
          <span key={m.stage}>
            <span className={here ? 'font-bold text-primary' : passed ? 'text-muted-foreground line-through' : 'text-muted-foreground'}>{m.label}</span>
            {i < MILESTONES.length - 1 && <span className="text-muted-foreground/40"> ▸ </span>}
          </span>
        )
      })}
    </span>
  )

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">我的资产组合</h1>
      <p className="text-xs text-muted-foreground mb-4">不是客户清单，是收入头寸。每个资产系统都在主动操盘——你看价值、批准它的下一步。组合期望 PO 值 ~{usd(portfolioUsd)}。</p>

      <div className="space-y-3">
        {assets.map((a) => (
          <div key={a.o.companyId} className="rounded-lg border">
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between text-xs">
              <span className="font-semibold">{a.o.brand}</span>
              <span>{DEV_CLASS[a.o.klass ?? 'drop'].dot}{DEV_CLASS[a.o.klass ?? 'drop'].label} · {FUNNEL_LABEL[a.o.stage]}</span>
            </div>
            <div className="p-4 text-sm space-y-1.5">
              <div className="flex gap-6">
                <span><span className="text-muted-foreground">预期PO </span><b>{usd(a.value)}</b></span>
                <span><span className="text-muted-foreground">赢率 </span>{Math.round(a.prob * 100)}%</span>
                <span><span className="text-muted-foreground">联系人 </span>{a.o.dmName || '（待补）'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-xs">系统在做：</span>
                <span className="flex-1">{a.action}</span>
                <Link href={`/companies/${a.o.companyId}`} className="text-xs px-3 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 shrink-0">去执行 →</Link>
              </div>
              <div><span className="text-muted-foreground text-xs">计划：</span><Path stage={a.o.stage} /></div>
            </div>
          </div>
        ))}
      </div>

      {/* 🟡 待激活资产（高价值但联系不上）*/}
      {needsContact.length > 0 && (
        <>
          <h2 className="text-sm font-semibold mt-6 mb-2 text-amber-700">🟡 待激活资产（高价值，先补联系人才能操盘）· {needsContact.length}</h2>
          <div className="rounded-lg border border-amber-200 divide-y">
            {needsContact.slice(0, 10).map((n) => (
              <Link key={n.companyId} href={`/companies/${n.companyId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
                <span className="w-8 shrink-0">{n.potential}</span>
                <span className="font-medium w-44 truncate">{n.brand}</span>
                <span className="flex-1 truncate text-muted-foreground">{n.reason}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {assets.length === 0 && needsContact.length === 0 && <p className="text-sm text-muted-foreground">暂无资产。去「开发」搜索并加入客户。</p>}
    </div>
  )
}
