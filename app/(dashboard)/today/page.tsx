import Link from 'next/link'
import { loadOpps, loadNeedsContact } from '@/lib/sales/load-opps'
import { moneyRow, detectLeaks, DEV_CLASS, LEAK_LABEL } from '@/lib/sales/revenue-os'
import { FUNNEL_LABEL } from '@/lib/sales/order-engine'

export const dynamic = 'force-dynamic'
const usd = (n: number) => `$${Math.round(n / 1000)}k`

export default async function TodayPage() {
  const [opps, needsContact] = await Promise.all([loadOpps(), loadNeedsContact()])
  // Action Queue = 🟢 develop only (actionable). 🟡 go to the fill-contact lane.
  const money = opps.map(moneyRow).filter((m) => m.o.klass === 'develop').sort((a, b) => b.score - a.score)
  const leaks = opps.flatMap(detectLeaks).sort((a, b) => b.lostOpportunityCost - a.lostOpportunityCost)
  const hero = money[0]
  const queue = money.slice(1, 10)
  const dist = { develop: 0, fill_contact: 0, drop: 0 } as Record<string, number>
  for (const m of money) dist[m.o.klass ?? 'drop']++
  const urgencyDot = (u: string) => (u === 'hot' ? '🔴' : u === 'soon' ? '🟠' : '🟡')
  const klassChip = (k?: string) => k ? `${DEV_CLASS[k as keyof typeof DEV_CLASS].dot}${DEV_CLASS[k as keyof typeof DEV_CLASS].label}` : ''

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">今日行动</h1>
      <p className="text-xs text-muted-foreground mb-4">从上往下做完，就是今天数学上最优的 PO 产出路径。</p>

      {/* ① 现在就做这一件 */}
      {hero ? (
        <div className="rounded-lg border-2 border-amber-300 mb-5">
          <div className="px-4 py-2 bg-amber-50 text-xs font-semibold flex items-center justify-between">
            <span>① 现在就做这一件 · 全系统最高价值</span>
            <span>{urgencyDot(hero.urgency)} {usd(hero.value)} · {klassChip(hero.o.klass)}</span>
          </div>
          <div className="p-4 space-y-1.5 text-sm">
            <div><span className="text-muted-foreground w-16 inline-block">联系谁</span><b>{hero.o.dmName || '（待补联系人）'}</b> · {hero.o.brand}</div>
            <div><span className="text-muted-foreground w-16 inline-block">为什么</span>{hero.reason} · 预期PO {usd(hero.value)} · 赢率 {Math.round(hero.prob * 100)}%</div>
            <div><span className="text-muted-foreground w-16 inline-block">动作</span><b>{hero.action}</b></div>
            <div className="pt-1">
              <Link href={`/companies/${hero.o.companyId}`} className="inline-block px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90">去执行 →</Link>
            </div>
          </div>
        </div>
      ) : <p className="text-sm text-muted-foreground mb-5">今日队列为空。</p>}

      {/* ② Action Queue */}
      <h2 className="text-sm font-semibold mb-2">② 今日队列（按 PO 价值排序）</h2>
      <div className="rounded-lg border mb-5 divide-y">
        {queue.map((m) => (
          <Link key={m.o.companyId} href={`/companies/${m.o.companyId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
            <span className="w-12 shrink-0">{urgencyDot(m.urgency)}{klassChip(m.o.klass).slice(0, 2)}</span>
            <span className="font-medium w-40 truncate">{m.o.brand}</span>
            <span className="text-muted-foreground w-16 shrink-0">{usd(m.value)}</span>
            <span className="text-muted-foreground w-20 shrink-0">{FUNNEL_LABEL[m.o.stage]}</span>
            <span className="flex-1 truncate">{m.action}</span>
          </Link>
        ))}
        {queue.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">—</p>}
      </div>

      {/* ③ 漏损 */}
      <h2 className="text-sm font-semibold mb-2 text-red-700">③ 哪里在漏钱（先堵漏）· 敞口 {usd(leaks.reduce((s, l) => s + l.lostOpportunityCost, 0))}</h2>
      <div className="rounded-lg border border-red-200 mb-5 divide-y">
        {leaks.slice(0, 6).map((l, i) => (
          <Link key={i} href={`/companies/${l.o.companyId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
            <span className="font-mono text-red-600 w-16 shrink-0">{usd(l.lostOpportunityCost)}</span>
            <span className="w-32 shrink-0 text-muted-foreground">{LEAK_LABEL[l.type]}</span>
            <span className="font-medium w-40 truncate">{l.o.brand}</span>
            <span className="flex-1 truncate text-muted-foreground">{l.recovery}</span>
          </Link>
        ))}
        {leaks.length === 0 && <p className="px-3 py-2 text-xs text-muted-foreground">无漏点 ✅</p>}
      </div>

      {/* ④ 🟡 补联系人车道（真正的假A级：高价值，无可达联系人） */}
      {needsContact.length > 0 && (
        <>
          <h2 className="text-sm font-semibold mb-2 text-amber-700">④ 🟡 补联系人（高价值但联系不上 · 别开发，先找人）· {needsContact.length}</h2>
          <div className="rounded-lg border border-amber-200 mb-5 divide-y">
            {needsContact.slice(0, 8).map((n) => (
              <Link key={n.companyId} href={`/companies/${n.companyId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
                <span className="w-10 shrink-0">{n.potential === 'P1' ? '🟡P1' : '🟡P2'}</span>
                <span className="font-medium w-40 truncate">{n.brand}</span>
                <span className="flex-1 truncate text-muted-foreground">{n.reason}</span>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* ⑤ 分级分布（假 A 级已被杀死的证据） */}
      <div className="text-xs text-muted-foreground">
        🟢开发 {dist.develop} · 🟡补联系人 {needsContact.length} · ⚫放弃 {dist.drop}
        <span className="ml-2">（业务员只做 🟢；🟡 先找人；⚫ 不碰——高价值但联系不上的不再冒充 A 级占用时间）</span>
      </div>
    </div>
  )
}
