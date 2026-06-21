/**
 * Resource allocation — ties the brief to the SOE / System-of-Allocation Action
 * vocabulary. Outputs Strike / Hunt / Nurture / Hold / Abandon plus concrete
 * effort, sample budget, and discovery recommendations. (Lightweight — not the
 * full optimizer; just the discrete action + effort band.)
 */
import type { AccessResult } from '@/lib/contacts/access'
import type { AllocationAction, ExecutiveDecision, ResourceAllocation } from '@/lib/intel/types'

export function buildResourceAllocation(exec: ExecutiveDecision, access: AccessResult): ResourceAllocation {
  const reachable = access.hasReachableChampionOrDM
  const rating = exec.rating
  const highPotential = (exec.annualPotentialUsd?.high ?? 0) >= 500_000

  let action: AllocationAction
  if (exec.decision === 'no_go') action = 'abandon'
  else if (!reachable && (exec.decision === 'go' || (exec.decision === 'hold' && rating !== 'D'))) action = 'hunt'
  else if (exec.decision === 'go' && reachable) action = 'strike'
  else if (exec.decision === 'hold') action = 'nurture'
  else action = 'hold'

  const ratingSampleBoost = rating === 'A' ? 1.5 : rating === 'B' ? 1 : 0.5

  switch (action) {
    case 'strike': return {
      action, rationale: '已可达决策人且值得开发 → 集中资源转化',
      salesEffortHours: rating === 'A' ? '6-10h/月' : '4-6h/月',
      sampleBudgetUsd: Math.round(200 * ratingSampleBoost),
      discoveryEffort: 'Apollo/Hunter 已够到人,维持验证即可',
      ownerInvolved: rating === 'A' && highPotential,
      worthOfflineVisit: rating === 'A' && highPotential,
      worthLongTermNurture: true,
      returnVsEffort: '高 — 优先投入',
    }
    case 'hunt': return {
      action, rationale: '高价值但够不到决策人 → 紧急找人(origination)',
      salesEffortHours: '3-5h/月(主要用于找人)',
      sampleBudgetUsd: Math.round(50 * ratingSampleBoost),
      discoveryEffort: 'Apollo + RocketReach + X-Ray 集中找 Sourcing/Production 决策人',
      ownerInvolved: false,
      worthOfflineVisit: false,
      worthLongTermNurture: true,
      returnVsEffort: '中 — 取决于能否够到人,够到后转 Strike',
    }
    case 'nurture': return {
      action, rationale: '有价值但时机/契合未到 → 低频培育',
      salesEffortHours: '1-2h/月',
      sampleBudgetUsd: 0,
      discoveryEffort: '低频 refind,等信号',
      ownerInvolved: false,
      worthOfflineVisit: false,
      worthLongTermNurture: true,
      returnVsEffort: '中长期',
    }
    case 'hold': return {
      action, rationale: '已建立/等待外部触发 → 持有,不主动投入',
      salesEffortHours: '0.5h/季',
      sampleBudgetUsd: 0,
      discoveryEffort: '不主动找',
      ownerInvolved: false, worthOfflineVisit: false, worthLongTermNurture: false,
      returnVsEffort: '低 — 仅持有',
    }
    default: return {
      action: 'abandon', rationale: '价值不足/不匹配 → 不投入',
      salesEffortHours: '0', sampleBudgetUsd: 0, discoveryEffort: '不投入',
      ownerInvolved: false, worthOfflineVisit: false, worthLongTermNurture: false,
      returnVsEffort: '不投入',
    }
  }
}
