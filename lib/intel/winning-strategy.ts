/**
 * Winning strategy — the most important section. Templated by customer type and
 * parameterized with the actual cut-in product from the fit analysis.
 */
import type { CompeteAxis, CustomerType, ProductSupplyFit, WinningStrategy } from '@/lib/intel/types'

interface Template {
  howToWin: string
  painPoint: string
  sampleToShow: string
  quoteStrategy: string
  competeOn: CompeteAxis[]
  pushDirectFactory: boolean
  offerSampleDevelopment: boolean
  positioning: 'primary_supplier' | 'backup_supplier'
}

const TEMPLATES: Record<CustomerType, Template> = {
  premium_dtc: {
    howToWin: '用开发能力与质量一致性赢得信任,逐步从备选转主供',
    painPoint: '供应商配合度、质量一致性、面料/工艺创新',
    sampleToShow: '与其档次相近的高端无缝/技术样品',
    quoteStrategy: '价值定价(不报最低价),突出工艺与稳定性',
    competeOn: ['development', 'quality', 'reliability'],
    pushDirectFactory: true, offerSampleDevelopment: true, positioning: 'primary_supplier',
  },
  growth_activewear: {
    howToWin: '抓扩张期供应链缺口,用低 MOQ + 快打样 + 稳定补单卡位',
    painPoint: '扩张快但供应链不稳、补单慢、MOQ 高',
    sampleToShow: '其核心在售款(legging/bra/套装)的相近样品',
    quoteStrategy: '低 MOQ 起订 + 快打样 + 走量阶梯价',
    competeOn: ['speed', 'development', 'price'],
    pushDirectFactory: true, offerSampleDevelopment: true, positioning: 'primary_supplier',
  },
  off_price_discount: {
    howToWin: '主打成本控制 + 稳定质量 + 快速补货,做可靠的中国工厂替代',
    painPoint: '成本压力、稳定供货、快速补货',
    sampleToShow: '现成相近款(jogger/tracksuit/fleece set),不强调定制开发',
    quoteStrategy: '有竞争力的 FOB + 走量阶梯价,强调成本而非开发',
    competeOn: ['price', 'reliability', 'speed'],
    pushDirectFactory: true, offerSampleDevelopment: false, positioning: 'backup_supplier',
  },
  wholesale_trade: {
    howToWin: '以价格 + 产能 + 准时交付赢得走量订单',
    painPoint: '价格、产能、交期',
    sampleToShow: '标准走量款',
    quoteStrategy: '有竞争力价格 + 数量阶梯,注意账期条款',
    competeOn: ['price', 'reliability'],
    pushDirectFactory: true, offerSampleDevelopment: false, positioning: 'backup_supplier',
  },
  retail_private_label: {
    howToWin: '以合规 + 一致性 + program 承接能力赢得季节性大单,长期培育',
    painPoint: '合规审厂、质量一致性、program 按时按量',
    sampleToShow: '按其 spec 打的样 + 合规文件',
    quoteStrategy: 'program 报价(按款按季),突出合规与一致性',
    competeOn: ['quality', 'reliability', 'price'],
    pushDirectFactory: false, offerSampleDevelopment: true, positioning: 'primary_supplier',
  },
  ecom_micro: {
    howToWin: '低 MOQ + 现成款 + 快速试单,轻投入快速转化',
    painPoint: '预算有限、MOQ 高、要快',
    sampleToShow: '现成款图册',
    quoteStrategy: '低 MOQ + 简单报价,先小单建立信任',
    competeOn: ['price', 'speed'],
    pushDirectFactory: true, offerSampleDevelopment: false, positioning: 'backup_supplier',
  },
  distributor_importer: {
    howToWin: '以产能 + FOB + 出口经验赢得长期走量供货',
    painPoint: '价格、产能、出口单证与稳定性',
    sampleToShow: '标准走量款 + 出口案例',
    quoteStrategy: '柜量阶梯报价,突出出口经验',
    competeOn: ['price', 'reliability'],
    pushDirectFactory: true, offerSampleDevelopment: false, positioning: 'backup_supplier',
  },
  unqualified: {
    howToWin: '不投入资源',
    painPoint: '—',
    sampleToShow: '—',
    quoteStrategy: '—',
    competeOn: ['price'],
    pushDirectFactory: false, offerSampleDevelopment: false, positioning: 'backup_supplier',
  },
}

export function buildWinningStrategy(type: CustomerType, fit: ProductSupplyFit): WinningStrategy {
  const t = TEMPLATES[type]
  const leadProduct = fit.cutInProducts[0] ?? '其核心在售款'
  const competeLabels = t.competeOn.map((a) => ({ price: '价格', speed: '速度', development: '开发', quality: '质量', reliability: '可靠' }[a]))
  const summary = type === 'unqualified'
    ? '不值得投入,放弃或仅自动化保留。'
    : `主打${leadProduct},以「${competeLabels.join('/')}」竞争,${t.positioning === 'primary_supplier' ? '争取主供' : '先做可靠备供再上位'};${t.offerSampleDevelopment ? '提供打样开发' : '用现成相近款切入、不过度推开发'}。`

  return {
    howToWin: t.howToWin,
    painPoint: t.painPoint,
    leadProduct,
    sampleToShow: t.sampleToShow,
    quoteStrategy: `${t.quoteStrategy}(目标 ${fit.targetFobRange})`,
    competeOn: t.competeOn,
    pushDirectFactory: t.pushDirectFactory,
    offerSampleDevelopment: t.offerSampleDevelopment,
    positioning: t.positioning,
    summary,
  }
}
