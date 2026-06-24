import Link from 'next/link'
import { createDirectClient } from '@/lib/supabase/server'
import { loadOpps, loadNeedsContact } from '@/lib/sales/load-opps'
import { moneyRow, detectLeaks, DEV_CLASS, LEAK_LABEL, redFlags } from '@/lib/sales/revenue-os'
import { FUNNEL_LABEL } from '@/lib/sales/order-engine'

export const dynamic = 'force-dynamic'
const usd = (n: number) => `$${Math.round(n / 1000)}k`

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ stage?: string }> }) {
  const { stage } = await searchParams
  const [opps, needsContact, pendingApprove] = await Promise.all([
    loadOpps(),
    loadNeedsContact(),
    createDirectClient().from('outreach_logs').select('id', { count: 'exact', head: true }).eq('status', 'pending_approval').not('contact_id', 'is', null).then((r) => r.count ?? 0, () => 0),
  ])
  const allMoney = opps.map(moneyRow).sort((a, b) => b.score - a.score)
  // Action Queue = 🟢 develop only (actionable). 🟡 go to the fill-contact lane.
  const develop = allMoney.filter((m) => m.o.klass === 'develop')
  const leaks = opps.flatMap(detectLeaks).sort((a, b) => b.lostOpportunityCost - a.lostOpportunityCost)
  const hero = develop[0]
  // Stage filter (block 2): browse my accounts by funnel stage in ONE place.
  const STAGE_FILTER: Record<string, string[]> = { outreach_sent: ['outreach_sent'], replied: ['replied'], sample: ['sample_requested', 'sample_sent'], quotation: ['quotation'], po: ['trial_order', 'scale_order'] }
  const STAGE_CHIPS: { key: string; label: string }[] = [
    { key: '', label: '行动队列' }, { key: 'outreach_sent', label: '已触达' }, { key: 'replied', label: '已回复' },
    { key: 'sample', label: '样品' }, { key: 'quotation', label: '报价' }, { key: 'po', label: 'PO' },
  ]
  const stageRows = stage && STAGE_FILTER[stage] ? allMoney.filter((m) => STAGE_FILTER[stage]!.includes(m.o.stage)) : null
  const queue = stageRows ?? develop.slice(1, 10)
  const dist = { develop: 0, fill_contact: 0, drop: 0 } as Record<string, number>
  for (const m of allMoney) dist[m.o.klass ?? 'drop']++
  // V2 discipline + learning
  const flaggedCount = opps.filter((o) => redFlags(o).length > 0).length
  const WHY_ZH: Record<string, string> = { wrong_contact: '联系人不对', wrong_wedge: '切入不对', weak_cta: 'CTA弱', timing: '时机', existing_supplier: '已有供应商', no_need: '无需求', unknown: '未知' }
  const whyDist: Record<string, number> = {}
  for (const o of opps) if (o.whyNoReply) whyDist[o.whyNoReply] = (whyDist[o.whyNoReply] || 0) + 1
  const whyEntries = Object.entries(whyDist).sort((a, b) => b[1] - a[1])
  const urgencyDot = (u: string) => (u === 'hot' ? '🔴' : u === 'soon' ? '🟠' : '🟡')
  const klassChip = (k?: string) => k ? `${DEV_CLASS[k as keyof typeof DEV_CLASS].dot}${DEV_CLASS[k as keyof typeof DEV_CLASS].label}` : ''

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-2xl font-bold mb-1">今日行动</h1>
      <p className="text-xs text-muted-foreground mb-3">从上往下做完，就是今天数学上最优的 PO 产出路径。</p>
      {pendingApprove > 0 && (
        <Link href="/approve" className="flex items-center justify-between rounded-lg border-2 border-primary/40 bg-primary/5 px-4 py-2.5 mb-3 hover:bg-primary/10">
          <span className="text-sm font-semibold">📤 {pendingApprove} 封开发信已写好，待你批准发送</span>
          <span className="text-sm text-primary">批准并发送 →</span>
        </Link>
      )}
      {/* 阶段过滤（block 2）：一个地方按漏斗阶段看我的客户，不用跳到回复箱/样品/审批 */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STAGE_CHIPS.map((c) => (
          <Link key={c.key} href={c.key ? `/today?stage=${c.key}` : '/today'}
            className={`text-xs px-2.5 py-1 rounded-full border ${(stage ?? '') === c.key ? 'bg-primary text-primary-foreground border-primary' : 'hover:bg-accent'}`}>
            {c.label}
          </Link>
        ))}
      </div>

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

      {/* ② Action Queue / 阶段视图 */}
      <h2 className="text-sm font-semibold mb-2">
        {stageRows ? `② ${STAGE_CHIPS.find((c) => c.key === stage)?.label ?? ''}客户（${stageRows.length}）` : '② 今日队列（按 PO 价值排序）'}
      </h2>
      <div className="rounded-lg border mb-5 divide-y">
        {queue.map((m) => (
          <Link key={m.o.companyId} href={`/companies/${m.o.companyId}`} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-accent/40">
            <span className="w-12 shrink-0">{urgencyDot(m.urgency)}{redFlags(m.o).length > 0 ? '🔴' : klassChip(m.o.klass).slice(0, 2)}</span>
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

      {/* ⑤ 纪律 + 学习（V2） */}
      <div className="rounded-lg border px-3 py-2 mb-3 text-xs space-y-1">
        <div>
          <span className={flaggedCount > 0 ? 'text-red-600 font-medium' : 'text-green-700'}>
            🔴 纪律：{flaggedCount} 个客户缺「负责人/下一步/截止」</span>
          <span className="text-muted-foreground ml-1">（点进去补齐，单子才不会静默烂掉）</span>
        </div>
        {whyEntries.length > 0 && (
          <div className="text-muted-foreground">🧠 没回复原因累积：{whyEntries.map(([k, v]) => `${WHY_ZH[k] ?? k} ${v}`).join(' · ')}（拿来改 wedge/CTA）</div>
        )}
      </div>

      {/* ⑥ 分级分布（假 A 级已被杀死的证据） */}
      <div className="text-xs text-muted-foreground">
        🟢开发 {dist.develop} · 🟡补联系人 {needsContact.length} · ⚫放弃 {dist.drop}
        <span className="ml-2">（业务员只做 🟢；🟡 先找人；⚫ 不碰——高价值但联系不上的不再冒充 A 级占用时间）</span>
      </div>
    </div>
  )
}
