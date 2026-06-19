/**
 * Conversion OS P0 validation — pure stage-gate unit tests (no DB needed).
 *   npx tsx scripts/validate-conversion.ts
 * Integration (create→advance→won/lost, timeline) is covered by the UI smoke.
 */
import {
  checkStageGate, defaultWinProb, isKeyStage, nextStage, STAGE_DEFAULT_WIN_PROB, type DealStage,
} from '@/lib/deals/stage'

let pass = 0, fail = 0
const ok = (n: string, c: boolean) => { if (c) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${n}`) } else { fail++; console.error(`  \x1b[31m✗\x1b[0m ${n}`) } }

const full = { owner: 'alex@x.com', next_action: '发报价单', next_action_due_at: '2026-07-05T09:00:00Z' }

console.log('阶段默认赢率')
ok('lead=5 / quotation=40 / negotiation=60 / trial_order=85 / won=100 / lost=0',
  STAGE_DEFAULT_WIN_PROB.lead === 5 && STAGE_DEFAULT_WIN_PROB.quotation === 40 &&
  STAGE_DEFAULT_WIN_PROB.negotiation === 60 && STAGE_DEFAULT_WIN_PROB.trial_order === 85 &&
  STAGE_DEFAULT_WIN_PROB.won === 100 && STAGE_DEFAULT_WIN_PROB.lost === 0)
ok('defaultWinProb(sample)=30', defaultWinProb('sample') === 30)

console.log('\n关键阶段（Replied 起）')
ok('lead / contacted 非关键阶段', !isKeyStage('lead') && !isKeyStage('contacted'))
ok('replied/sample/quotation/negotiation/trial_order 为关键阶段',
  (['replied', 'sample', 'quotation', 'negotiation', 'trial_order'] as DealStage[]).every(isKeyStage))

console.log('\nNext Action 门控')
ok('→ contacted 无 Next Action 也放行（非关键阶段）', checkStageGate('contacted', {}).ok)
ok('→ replied 缺 Owner/Action/Due 被拒', !checkStageGate('replied', {}).ok)
ok('→ replied 仅缺 Due 被拒', !checkStageGate('replied', { owner: 'a@x', next_action: 'x' }).ok)
ok('→ replied 三者齐全放行', checkStageGate('replied', full).ok)
ok('→ negotiation 齐全放行', checkStageGate('negotiation', full).ok)

console.log('\nWon / Lost 门控')
ok('→ won 缺年采购额被拒', !checkStageGate('won', full).ok)
ok('→ won 有年采购额放行', checkStageGate('won', { ...full, annual_potential_usd: 120000 }).ok)
ok('→ lost 缺原因被拒', !checkStageGate('lost', {}).ok)
ok('→ lost 有原因放行', checkStageGate('lost', { lost_reason: 'competitor' }).ok)

console.log('\n阶段推进顺序')
ok('nextStage(quotation)=negotiation', nextStage('quotation') === 'negotiation')
ok('nextStage(trial_order)=won', nextStage('trial_order') === 'won')
ok('nextStage(won)=null（终点）', nextStage('won') === null)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
