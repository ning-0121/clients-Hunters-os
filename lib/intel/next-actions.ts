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
  _contact: ContactStrategy,
  winning: WinningStrategy,
  resource: ResourceAllocation,
): NextAction[] {
  if (resource.action === 'abandon') {
    return [{ kind: 'deal', task: '放弃或仅自动化保留', detail: '价值不足/不匹配 — 不投入资源' }]
  }

  const actions: NextAction[] = []
  const dm = chain.decisionMaker
  const dmLabel = dm.status === 'found' && dm.name ? `${dm.name}（${dm.title}）` : chain.recommendedNextContact

  // Fill the contact gap with named roles + a backup.
  if (dm.status !== 'found' || chain.buyer.status !== 'found') {
    actions.push({ kind: 'find_contact', task: `补齐关键人:${chain.recommendedNextContact}`, detail: `${chain.missingRoles.length ? `缺:${chain.missingRoles.join('、')};` : ''}另备 1 个备份联系人` })
  }

  // Close the customs / supplier data gap (ImportYeti).
  actions.push({ kind: 'search', task: `查 ImportYeti:「${companyName}」`, detail: '锁定现供应商 + 原产国 + 走货量(填补海关空白)' })

  // The incoterm/price probe — the explicit BD gap. Never quote a guessed number.
  actions.push({ kind: 'cs_probe', task: '首轮问到真实采购口径', detail: 'FOB 还是 DDP？目标价位 / 年采购量?——系统未证实,勿臆测报价' })

  // First email to the named, reachable decision-maker.
  if (dm.status === 'found' && dm.reachable) {
    actions.push({ kind: 'email', task: `给 ${dmLabel} 发首邮`, detail: `角度:${winning.howToWin};CTA:免费寄样「${winning.leadProduct}」${dm.email ? `;邮箱 ${dm.email}` : ''}` })
  } else {
    actions.push({ kind: 'email', task: `找到并联系:${dmLabel}`, detail: `角度:${winning.howToWin}` })
  }

  // Sample + 验厂 confirmation (concrete, not generic).
  actions.push({ kind: 'sample', task: `备样:「${winning.leadProduct}」`, detail: fit.cutInProducts.slice(0, 3).join('、') })
  actions.push({ kind: 'quote', task: '确认验厂/合规要求', detail: `${fit.factoryRequirement} — 确认我方或合作厂可达标` })

  const days = resource.action === 'strike' ? 3 : resource.action === 'hunt' ? 7 : 30
  actions.push({ kind: 'followup', task: `${days} 天后跟进`, detail: `Action=${resource.action}` })
  if (resource.action === 'strike') actions.push({ kind: 'deal', task: '建 Deal 并推进', detail: `赢率 ${exec.winProbability}%,已可达` })
  else if (resource.action === 'hunt') actions.push({ kind: 'deal', task: 'Vault 持续找人,够到决策人后再建 Deal' })

  return actions.slice(0, 8)
}
