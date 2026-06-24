import Link from 'next/link'
import { getBdIdentity } from '@/lib/bd/shared'
import { assignLeadToMe } from '@/actions/bd'
import { loadOpps } from '@/lib/sales/load-opps'
import { moneyRow, detectLeaks, forecast, LEAK_LABEL } from '@/lib/sales/revenue-os'
import { FUNNEL_LABEL as FUNNEL_LABELS, type FunnelStage } from '@/lib/sales/order-engine'

export const dynamic = 'force-dynamic'

const usd = (n: number) => `$${Math.round(n / 1000)}k`
const ROLE_NOTE: Record<string, string> = {
  sales_manager: '经理视图：先清漏，再批新开发信。', salesperson: '业务视图：从 Money List 自上而下做。', admin: 'CEO 视图：看 90 天预测，无需打开任何客户。',
}

export default async function CommandCenterPage() {
  const { who, role } = await getBdIdentity()
  const opps = await loadOpps()
  const leaks = opps.flatMap(detectLeaks).sort((a, b) => b.lostOpportunityCost - a.lostOpportunityCost)
  const money = opps.map(moneyRow).sort((a, b) => b.score - a.score)
  const f = forecast(opps)
  const leakExposure = leaks.reduce((s, l) => s + l.lostOpportunityCost, 0)
  const inStage = (s: FunnelStage) => money.filter((m) => m.o.stage === s)

  const Section = ({ title, sub, accent, children }: { title: string; sub?: string; accent?: string; children: React.ReactNode }) => (
    <section className={`rounded-lg border ${accent ?? ''} mb-4`}>
      <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>{sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
      <div className="p-3 text-xs">{children}</div>
    </section>
  )
  const Queue = ({ title, rows }: { title: string; rows: typeof money }) => (
    <Section title={title} sub={`${rows.length}`}>
      {rows.length === 0 ? <p className="text-muted-foreground">—</p> : rows.slice(0, 8).map((m) => (
        <div key={m.o.companyId} className="flex items-center gap-2 py-1 border-b last:border-0">
          <Link href={`/companies/${m.o.companyId}`} className="font-medium w-44 truncate hover:underline">{m.o.brand}</Link>
          <span className="text-muted-foreground w-16">{usd(m.value)}</span>
          <span className="flex-1 text-muted-foreground truncate">{m.action}</span>
        </div>
      ))}
    </Section>
  )

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-bold">营收指挥中心</h1>
        <span className="text-xs text-muted-foreground">{who} · {role} · {ROLE_NOTE[role] ?? ''}</span>
      </div>
      {/* Scoreboard */}
      <div className="flex flex-wrap gap-4 text-xs mb-4 text-muted-foreground">
        <span>管道 {opps.length} 机会</span>
        <span>预期90天 <b className="text-foreground">{usd(f.expected)}</b></span>
        <span>漏损敞口 <b className="text-red-600">{usd(leakExposure)}</b></span>
        <span>已签约 {usd(f.committed)}</span>
      </div>

      {/* 1. 🚨 Revenue Leak Center */}
      <Section title="🚨 Revenue Leak Center" sub={`${leaks.length} 漏点 · 敞口 ${usd(leakExposure)} · 先清漏再开发`} accent="border-red-300">
        {leaks.length === 0 ? <p className="text-muted-foreground">无漏点 ✅</p> : (
          <table className="w-full">
            <thead><tr className="text-muted-foreground text-left"><th className="font-normal py-1">损失成本</th><th className="font-normal">类型</th><th className="font-normal">停滞</th><th className="font-normal">品牌</th><th className="font-normal">修复</th></tr></thead>
            <tbody>{leaks.slice(0, 12).map((l, i) => (
              <tr key={i} className="border-t">
                <td className="py-1 font-mono text-red-600">{usd(l.lostOpportunityCost)}</td>
                <td>{LEAK_LABEL[l.type]}</td>
                <td className="text-muted-foreground">{l.daysStalled != null ? `${l.daysStalled}d` : '—'}</td>
                <td><Link href={`/companies/${l.o.companyId}`} className="font-medium hover:underline">{l.o.brand}</Link></td>
                <td className="text-muted-foreground">
                  {l.type === 'missing_owner'
                    ? <form action={assignLeadToMe} className="inline"><input type="hidden" name="companyId" value={l.o.companyId} /><button className="px-2 py-0.5 border rounded text-primary">指派给我</button></form>
                    : l.recovery}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>

      {/* 2. 🔥 Today's Money List */}
      <Section title="🔥 Today's Money List" sub="PO概率 × 估值 × 紧急度 · 自上而下做" accent="border-amber-300">
        <table className="w-full">
          <thead><tr className="text-muted-foreground text-left"><th className="font-normal py-1">优先</th><th className="font-normal">阶段</th><th className="font-normal">PO概率</th><th className="font-normal">估值</th><th className="font-normal">紧急</th><th className="font-normal">品牌</th><th className="font-normal">动作</th></tr></thead>
          <tbody>{money.slice(0, 12).map((m) => (
            <tr key={m.o.companyId} className="border-t">
              <td className="py-1 font-mono">{m.score}</td>
              <td className="text-muted-foreground">{FUNNEL_LABELS[m.o.stage]}</td>
              <td>{Math.round(m.prob * 100)}%</td>
              <td className="font-mono">{usd(m.value)}</td>
              <td>{m.urgency === 'hot' ? '🔴' : m.urgency === 'soon' ? '🟠' : '🟡'}</td>
              <td><Link href={`/companies/${m.o.companyId}`} className="font-medium hover:underline">{m.o.brand}</Link></td>
              <td className="text-muted-foreground">{m.action}</td>
            </tr>
          ))}</tbody>
        </table>
      </Section>

      {/* 3. 📈 Future Revenue Forecast */}
      <Section title="📈 Future Revenue Forecast (90天)" sub="无需打开任何客户记录" accent="border-blue-300">
        <div className="flex gap-6 mb-2">
          <div><div className="text-muted-foreground">保守</div><div className="text-lg font-bold">{usd(f.conservative)}</div></div>
          <div><div className="text-muted-foreground">预期</div><div className="text-lg font-bold text-blue-700">{usd(f.expected)}</div></div>
          <div><div className="text-muted-foreground">激进</div><div className="text-lg font-bold">{usd(f.aggressive)}</div></div>
          <div><div className="text-muted-foreground">已签约</div><div className="text-lg font-bold text-green-700">{usd(f.committed)}</div></div>
        </div>
        <div className="text-muted-foreground">按阶段期望PO贡献：{f.byStage.sort((a, b) => b.expected - a.expected).map((s) => `${FUNNEL_LABELS[s.stage]} ${usd(s.expected)}`).join(' · ')}</div>
        <p className="text-[10px] text-muted-foreground/70 mt-1">估值为基于规模/营收/价位的估算，非确认订单额；随样品/报价推进而收敛。</p>
      </Section>

      {/* 4-8. Stage queues (drill-downs) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Queue title="📨 Reply Queue" rows={inStage('replied')} />
        <Queue title="📦 Sample Queue" rows={[...inStage('sample_requested'), ...inStage('sample_sent')]} />
        <Queue title="💲 Quote Queue" rows={inStage('quotation')} />
        <Queue title="🏆 PO Queue" rows={[...inStage('trial_order'), ...inStage('scale_order')]} />
        <Queue title="🚀 Outreach Queue" rows={[...inStage('outreach_sent'), ...inStage('contact_captured')]} />
      </div>
    </div>
  )
}
