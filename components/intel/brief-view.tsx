/**
 * BriefView — renders the Customer Intelligence Brief (decision-first).
 * Server component. Stacked sections; Raw Evidence is rendered by the page, last.
 */
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type {
  IntelligenceBrief, AllocationAction, GoDecision, Rating, Sensitivity, Complexity,
  MarginBand, ResourceLevel, CompeteAxis, ChainStatus, ChainRole, NextActionKind,
} from '@/lib/intel/types'

const RATING_STYLES: Record<Rating, string> = {
  A: 'bg-purple-100 text-purple-800 border-purple-200',
  B: 'bg-blue-100 text-blue-800 border-blue-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-gray-100 text-gray-500 border-gray-200',
}
const ACTION_LABEL: Record<AllocationAction, string> = {
  strike: '🎯 Strike 出手转化', hunt: '🔍 Hunt 紧急找人', nurture: '🌱 Nurture 培育', hold: '⏸ Hold 持有', abandon: '🗑 Abandon 放弃',
}
const ACTION_STYLE: Record<AllocationAction, string> = {
  strike: 'bg-green-100 text-green-800', hunt: 'bg-amber-100 text-amber-800', nurture: 'bg-blue-100 text-blue-700', hold: 'bg-gray-100 text-gray-600', abandon: 'bg-red-100 text-red-700',
}
const DECISION_LABEL: Record<GoDecision, string> = { go: '✅ 开发 (Go)', hold: '⏸ 观望 (Hold)', no_go: '🚫 放弃 (No-Go)' }
const SENS: Record<Sensitivity, string> = { high: '高', medium: '中', low: '低' }
const CMPLX: Record<Complexity, string> = { high: '高', medium: '中', low: '低' }
const MARGIN: Record<MarginBand, string> = { high: '高', medium: '中', low: '低', thin: '薄' }
const RESLVL: Record<ResourceLevel, string> = { heavy: '重投入', standard: '标准', light: '轻', minimal: '极少' }
const AXIS: Record<CompeteAxis, string> = { price: '价格', speed: '速度', development: '开发', quality: '质量', reliability: '可靠' }
const CHAIN: Record<ChainStatus, { label: string; cls: string }> = {
  found: { label: '✓ 已找到', cls: 'text-green-700' }, inferred: { label: '◇ 推断', cls: 'text-amber-700' }, missing: { label: '✗ 缺失', cls: 'text-red-600' },
}
const KIND_ICON: Record<NextActionKind, string> = {
  find_contact: '👤', email: '✉️', sample: '🧵', quote: '💲', search: '🔎', cs_probe: '☎️', followup: '⏰', deal: '📦',
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="flex gap-2 text-sm"><span className="text-muted-foreground shrink-0 w-28">{k}</span><span className="flex-1">{v}</span></div>
)
function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <Card id={id}>
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-2">{children}</CardContent>
    </Card>
  )
}
function ChainLine({ role, c }: { role: string; c: ChainRole }) {
  return (
    <div className="flex gap-2 text-sm items-baseline">
      <span className="text-muted-foreground shrink-0 w-20">{role}</span>
      <span className={`shrink-0 w-14 ${CHAIN[c.status].cls}`}>{CHAIN[c.status].label}</span>
      <span className="flex-1">{c.name ? <b>{c.name}</b> : null} <span className="text-muted-foreground">{c.title}</span> — {c.note}</span>
    </div>
  )
}

export function BriefView({ brief }: { brief: IntelligenceBrief }) {
  const e = brief.executive
  const pot = e.annualPotentialUsd ? `$${Math.round(e.annualPotentialUsd.low / 1000)}k–${Math.round(e.annualPotentialUsd.high / 1000)}k/年` : '—'

  return (
    <div className="space-y-4">
      {/* 1. Executive decision — 30-second card */}
      <Card className="border-primary/40">
        <CardContent className="py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-bold px-2 py-0.5 rounded-full border ${RATING_STYLES[e.rating]}`}>{e.rating} 级</span>
            <Badge variant="secondary">{brief.customerType.label}</Badge>
            <Badge variant="secondary">{brief.purchasingModel.label}</Badge>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_STYLE[brief.resource.action]}`}>{ACTION_LABEL[brief.resource.action]}</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-muted">{DECISION_LABEL[e.decision]}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-sm">
            <Row k="赢率" v={<b>{e.winProbability}%</b>} />
            <Row k="年采购潜力" v={pot} />
            <Row k="预期毛利" v={MARGIN[e.marginBand]} />
            <Row k="优先级" v={e.priority === 'high' ? '高' : e.priority === 'medium' ? '中' : '低'} />
            <Row k="资源档" v={RESLVL[e.resourceLevel]} />
            <Row k="可达状态" v={brief.decisionChain.accessCoverage} />
          </div>
          <p className="text-xs text-muted-foreground border-t pt-2">{e.headline}</p>
        </CardContent>
      </Card>

      <Section id="type" title="2. 客户类型">
        <Row k="类型" v={<><b>{brief.customerType.label}</b> <span className="text-muted-foreground">(置信 {Math.round(brief.customerType.confidence * 100)}%)</span></>} />
        <Row k="采购行为" v={brief.customerType.buyingBehavior} />
        <Row k="价格敏感" v={SENS[brief.customerType.priceSensitivity]} />
        <Row k="质量敏感" v={SENS[brief.customerType.qualitySensitivity]} />
        <Row k="开发需求" v={brief.customerType.developmentNeeds} />
        <Row k="likely DM" v={brief.customerType.likelyDecisionMaker} />
        <Row k="最佳打法" v={brief.customerType.bestApproach} />
        <p className="text-xs text-muted-foreground">依据:{brief.customerType.rationale.join(' · ')}</p>
      </Section>

      <Section id="chain" title="3. 决策链(找不到也推断)">
        <ChainLine role="决策人" c={brief.decisionChain.decisionMaker} />
        <ChainLine role="买手" c={brief.decisionChain.buyer} />
        <ChainLine role="影响者" c={brief.decisionChain.influencer} />
        <ChainLine role="守门人" c={brief.decisionChain.gatekeeper} />
        <div className="border-t pt-2 space-y-1">
          <Row k="Access" v={`${brief.decisionChain.accessScore}/100 · ${brief.decisionChain.accessCoverage}`} />
          <Row k="缺失角色" v={brief.decisionChain.missingRoles.join('、') || '无'} />
          <Row k="下一个找谁" v={<b>{brief.decisionChain.recommendedNextContact}</b>} />
          <Row k="优先级阶梯" v={<span className="text-xs text-muted-foreground">{brief.decisionChain.contactPriorityLadder.join(' → ')}</span>} />
        </div>
      </Section>

      <Section id="win" title="4. 制胜策略 ★">
        <p className="font-medium">{brief.winningStrategy.summary}</p>
        <Row k="怎么赢" v={brief.winningStrategy.howToWin} />
        <Row k="攻痛点" v={brief.winningStrategy.painPoint} />
        <Row k="主打产品" v={<b>{brief.winningStrategy.leadProduct}</b>} />
        <Row k="展示样品" v={brief.winningStrategy.sampleToShow} />
        <Row k="报价策略" v={brief.winningStrategy.quoteStrategy} />
        <Row k="竞争轴" v={brief.winningStrategy.competeOn.map((a) => AXIS[a]).join(' · ')} />
        <Row k="定位" v={brief.winningStrategy.positioning === 'primary_supplier' ? '争取主供应商' : '先做可靠备供'} />
        <Row k="直厂优势" v={brief.winningStrategy.pushDirectFactory ? '主推' : '不强调'} />
        <Row k="提供打样" v={brief.winningStrategy.offerSampleDevelopment ? '是' : '否(用现成款)'} />
      </Section>

      <Section id="fit" title="5. 产品与供应链契合">
        <Row k="核心品类" v={brief.productFit.coreCategories.join('、')} />
        <Row k="面料推断" v={brief.productFit.fabricTypes.join('、')} />
        <Row k="工艺复杂度" v={CMPLX[brief.productFit.constructionComplexity]} />
        <Row k="QIMO 契合分" v={<b>{brief.productFit.qimoFitScore}/100</b>} />
        <Row k="切入产品" v={brief.productFit.cutInProducts.join('、')} />
        <Row k="避免产品" v={brief.productFit.productsToAvoid.join('、') || '无'} />
        <Row k="目标 FOB" v={brief.productFit.targetFobRange} />
        <Row k="工厂要求" v={brief.productFit.factoryRequirement} />
        <Row k="货源国" v={brief.productFit.likelySourcingCountry} />
        <Row k="切换难度" v={CMPLX[brief.productFit.switchingDifficulty]} />
      </Section>

      <Section id="purchase" title="6. 采购模型">
        <Row k="模型" v={<b>{brief.purchasingModel.label}</b>} />
        <Row k="置信" v={`${Math.round(brief.purchasingModel.confidence * 100)}%`} />
        <Row k="证据" v={brief.purchasingModel.evidence.join(' · ')} />
      </Section>

      <Section id="contact" title="7. 接触策略">
        <Row k="首选接触" v={<b>{brief.contactStrategy.bestFirstContact}</b>} />
        <Row k="备用路径" v={brief.contactStrategy.backupPath} />
        <Row k="LinkedIn" v={brief.contactStrategy.linkedinStrategy} />
        <Row k="邮件" v={brief.contactStrategy.emailStrategy} />
        <Row k="官网" v={brief.contactStrategy.websiteStrategy} />
        <Row k="客服脚本" v={brief.contactStrategy.customerServiceScript} />
        <Row k="不要说" v={brief.contactStrategy.whatNotToSay.join('；')} />
      </Section>

      <Section id="risk" title="8. 风险">
        <div className="flex flex-wrap gap-1.5">
          {brief.risk.strategicAccount && <Badge className="bg-purple-100 text-purple-700">战略账户</Badge>}
          {brief.risk.quickWin && <Badge className="bg-green-100 text-green-700">速赢</Badge>}
          {brief.risk.lowMarginVolume && <Badge className="bg-amber-100 text-amber-700">走量低毛利</Badge>}
        </div>
        {brief.risk.items.map((r, i) => (
          <div key={i} className="flex gap-2 text-sm">
            <span className={`shrink-0 w-10 ${r.severity === 'high' ? 'text-red-600' : r.severity === 'medium' ? 'text-amber-600' : 'text-muted-foreground'}`}>{r.severity === 'high' ? '高' : r.severity === 'medium' ? '中' : '低'}</span>
            <span className="shrink-0 w-24">{r.risk}</span>
            <span className="flex-1 text-muted-foreground">{r.note}</span>
          </div>
        ))}
      </Section>

      <Section id="resource" title="9. 资源配置(SOE Action)">
        <Row k="动作" v={<span className={`text-xs font-medium px-2 py-0.5 rounded-full ${ACTION_STYLE[brief.resource.action]}`}>{ACTION_LABEL[brief.resource.action]}</span>} />
        <Row k="理由" v={brief.resource.rationale} />
        <Row k="销售工时" v={brief.resource.salesEffortHours} />
        <Row k="样品预算" v={`$${brief.resource.sampleBudgetUsd}`} />
        <Row k="找人投入" v={brief.resource.discoveryEffort} />
        <Row k="老板出面" v={brief.resource.ownerInvolved ? '是' : '否'} />
        <Row k="值得线下" v={brief.resource.worthOfflineVisit ? '是' : '否'} />
        <Row k="长期培育" v={brief.resource.worthLongTermNurture ? '是' : '否'} />
        <Row k="回报/投入" v={brief.resource.returnVsEffort} />
      </Section>

      <Section id="actions" title="10. 下一步动作">
        <ol className="space-y-1.5">
          {brief.nextActions.map((a, i) => (
            <li key={i} className="flex gap-2 text-sm">
              <span className="shrink-0">{KIND_ICON[a.kind]}</span>
              <span className="flex-1"><b>{a.task}</b>{a.detail && <span className="text-muted-foreground"> — {a.detail}</span>}</span>
            </li>
          ))}
        </ol>
      </Section>
    </div>
  )
}
