/**
 * Contact strategy — how to actually reach the account. Customer-service email is
 * explicitly a FALLBACK access path, never treated as success.
 */
import type { CustomerType, ContactStrategy, DecisionChain } from '@/lib/intel/types'

const NOT_TO_SAY: Record<CustomerType, string[]> = {
  premium_dtc: ['不要一上来谈最低价', '不要说"我们什么都能做" — 要聚焦其品类', '不要贬低其现有供应商'],
  growth_activewear: ['不要硬推超大 MOQ', '不要过度承诺交期', '不要只谈价格、忽略打样速度'],
  off_price_discount: ['不要主打高端定制开发', '不要强调慢工细活', '不要报高价试探'],
  wholesale_trade: ['不要忽视账期/付款条款', '不要承诺做不到的产能', '不要只谈质量不谈价'],
  retail_private_label: ['不要回避合规/审厂问题', '不要承诺无法满足的 spec', '不要急于求成、跳过流程'],
  ecom_micro: ['不要推高 MOQ', '不要投入高成本资源', '不要过度定制'],
  distributor_importer: ['不要忽视出口单证能力', '不要报不可持续的低价', '不要忽视柜量/交期'],
  unqualified: ['不投入'],
}

export function buildContactStrategy(type: CustomerType, chain: DecisionChain): ContactStrategy {
  const target = chain.recommendedNextContact
  const dm = chain.decisionMaker
  const dmFound = dm.status === 'found'
  const dmReachable = dmFound && dm.note.includes('可达')
  const dmName = dm.name ?? dm.title

  return {
    bestFirstContact: dmReachable
      ? `直接联系已找到且可达的决策人:${dmName}`
      : dmFound
        ? `已知决策人 ${dmName} 但邮箱未验证 → 先用 Apollo/Hunter 验证其邮箱再联系(勿用推测邮箱群发)`
        : `优先寻找并联系:${target}`,
    backupPath: '若直采人难找:LinkedIn 反查 sourcing/production → 海关收货联系人 → 官网联系表单 → 客服探询(兜底)',
    linkedinStrategy: `LinkedIn/Sales Navigator 按公司 + 头衔搜「Sourcing / Production / Merchandising」,优先 Director/Manager 级`,
    emailStrategy: dmFound
      ? '向决策人发个性化首邮(引用其品类与时机钩子),价值导向不群发'
      : '先用 Apollo/Hunter 验证目标人邮箱再发;未验证前不群发,避免退信',
    websiteStrategy: '官网 careers/about/contact 页找人名与邮箱格式;contact-form 仅作补充触点',
    customerServiceScript: `客服探询脚本(兜底,非成功):「Hi, we're a vertical activewear manufacturer. Could you point me to who handles sourcing / supplier partnerships so I can send our capabilities and FOB?」目的是**问到买手**,不是把客服当客户。`,
    whatNotToSay: NOT_TO_SAY[type] ?? NOT_TO_SAY.growth_activewear,
  }
}
