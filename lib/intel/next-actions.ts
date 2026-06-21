/**
 * Next actions — concrete, immediately-executable tasks assembled from the brief.
 */
import type {
  ContactStrategy, CustomerType, DecisionChain, ExecutiveDecision,
  NextAction, ProductSupplyFit, ResourceAllocation, WinningStrategy,
} from '@/lib/intel/types'

export function buildNextActions(
  companyName: string,
  exec: ExecutiveDecision,
  _type: CustomerType,
  fit: ProductSupplyFit,
  chain: DecisionChain,
  contact: ContactStrategy,
  winning: WinningStrategy,
  resource: ResourceAllocation,
): NextAction[] {
  if (resource.action === 'abandon') {
    return [{ kind: 'deal', task: '放弃或仅自动化保留', detail: '价值不足/不匹配 — 不投入资源' }]
  }

  const actions: NextAction[] = []

  if (chain.decisionMaker.status !== 'found' || chain.buyer.status !== 'found') {
    actions.push({ kind: 'find_contact', task: `找到这些角色:${chain.recommendedNextContact}(并补一个备份联系人)`, detail: chain.missingRoles.length ? `缺:${chain.missingRoles.join('、')}` : undefined })
  }
  actions.push({ kind: 'search', task: `搜索:Apollo / X-Ray「${companyName} Sourcing OR Production OR Merchandising Director」` })
  actions.push({ kind: 'email', task: `发首邮:${contact.bestFirstContact}`, detail: `角度:${winning.howToWin}` })
  actions.push({ kind: 'sample', task: `准备样品图:${winning.leadProduct}`, detail: fit.cutInProducts.slice(0, 3).join('、') })
  actions.push({ kind: 'quote', task: `准备 FOB 报价区间:${fit.targetFobRange}`, detail: winning.quoteStrategy })
  if (chain.decisionMaker.status !== 'found') {
    actions.push({ kind: 'cs_probe', task: '客服探询(兜底):问 sourcing/supplier 负责人是谁', detail: '目的是问到买手,不要把客服当成功' })
  }
  const days = resource.action === 'strike' ? 3 : resource.action === 'hunt' ? 7 : 30
  actions.push({ kind: 'followup', task: `${days} 天后跟进`, detail: `Action=${resource.action}` })
  if (resource.action === 'strike') actions.push({ kind: 'deal', task: '创建 Deal 并推进', detail: `赢率 ${exec.winProbability}%,已可达` })
  else if (resource.action === 'hunt') actions.push({ kind: 'deal', task: '留在 Vault 持续找人,够到决策人后再建 Deal' })
  else actions.push({ kind: 'deal', task: '留在 Vault 低频培育' })

  return actions.slice(0, 8)
}
