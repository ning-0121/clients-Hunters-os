/**
 * Revenue OS — live data run. `npm run revenue`.
 * Outputs the 3 Command-Center surfaces from real data:
 *   🚨 Revenue Leak Center · 🔥 Today's Money List · 📈 90-day Forecast
 */
import { forecast, moneyRow, detectLeaks, LEAK_LABEL } from '@/lib/sales/revenue-os'
import { loadOpps } from '@/lib/sales/load-opps'

const usd = (n: number) => `$${Math.round(n / 1000)}k`

async function main() {
  const opps = await loadOpps()

  // ── 🚨 Revenue Leak Center ──
  const leaks = opps.flatMap(detectLeaks).sort((a, b) => b.lostOpportunityCost - a.lostOpportunityCost)
  const leakTotal = leaks.reduce((s, l) => s + l.lostOpportunityCost, 0)
  console.log(`\n🚨 REVENUE LEAK CENTER — ${leaks.length} leaks · 流失风险敞口 ${usd(leakTotal)}`)
  console.log('损失成本  类型              停滞  品牌                 修复动作')
  for (const l of leaks.slice(0, 14)) console.log(`${usd(l.lostOpportunityCost).padStart(7)}  ${LEAK_LABEL[l.type].padEnd(16)} ${(l.daysStalled != null ? l.daysStalled + 'd' : '—').padStart(4)}  ${l.o.brand.padEnd(20)} ${l.recovery}`)

  // ── 🔥 Today's Money List ──
  const money = opps.map(moneyRow).sort((a, b) => b.score - a.score)
  console.log(`\n🔥 TODAY'S MONEY LIST (P×V×T)`)
  console.log('优先分  阶段          PO概率 估值   紧急  品牌                 动作')
  for (const m of money.slice(0, 14)) console.log(`${String(m.score).padStart(7)}  ${m.o.stage.padEnd(13)} ${(Math.round(m.prob * 100) + '%').padStart(5)} ${usd(m.value).padStart(5)} ${(m.urgency === 'hot' ? '🔴' : m.urgency === 'soon' ? '🟠' : '🟡')}  ${m.o.brand.padEnd(20)} ${m.action}`)

  // ── 📈 Forecast ──
  const f = forecast(opps)
  console.log(`\n📈 FUTURE REVENUE FORECAST (90天)`)
  console.log(`  保守 ${usd(f.conservative)} · 预期 ${usd(f.expected)} · 激进 ${usd(f.aggressive)}  (已签约 committed ${usd(f.committed)})`)
  console.log('  按阶段贡献:')
  for (const s of f.byStage.sort((a, b) => b.expected - a.expected)) console.log(`    ${s.stage.padEnd(14)} ${s.count}个 · 估值 ${usd(s.value)} · 期望PO ${usd(s.expected)}`)
}
main().catch((e) => { console.error(e); process.exit(1) })
