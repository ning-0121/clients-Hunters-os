# ARAOS — Customer Intelligence Brief (报告升级设计)

> 把"公司背景报告"升级为**决策简报(Decision Brief)**:不是堆事实,而是回答销售必须知道的 9 个问题
> (值不值得开发 / 什么类型 / 怎么采购 / 先联系谁 / 用什么产品切入 / 订单与利润 / 风险 / 制胜策略 / 下一步具体动作)。
> 原则:**复用现有数据与表,推理层纯函数化、可测、稳定(吸取评分波动教训,P0 不依赖 LLM)。**

---

## 1. 定位

当前 `customer_intelligence_reports`(LLM 生成)填满了背景字段(公司画像/合规/渠道),却答不出业务问题:
没有决策链、没有联系优先级、没有客户类型、没有采购模型、没有制胜策略、没有资源配置、没有 go/no-go。

**新本体 = Customer Intelligence Brief**:一份 30 秒可读、可立即执行的决策简报。**Raw Evidence 放最后**,行动放最前。

它与已建系统连成一体:**Contact Intelligence**(access/credibility/decision-chain)提供"能不能够到人";
**SOE / System of Allocation** 的 Action 词汇(Strike / Hunt / Nurture / Hold / Abandon)提供"投多少资源"。

---

## 2. 简报结构(10 节)

| # | 节 | 关键产出 | 主要来源(复用) |
|---|---|---|---|
| 1 | **Executive Decision** | 评级 A/B/C/D · Go/No/Hold · 优先级 · 预计年采购额 · 预期毛利档 · 赢率 · 资源档 | customer_tier + dims + access |
| 2 | **Customer Type** | 8 类之一 + 该类的采购行为/价格敏感/质量敏感/开发需求/决策人/打法 | product_categories + price_point + company_type + 渠道/规模 |
| 3 | **Purchasing Model** | OEM 直采 / 贸易商 / 进口商 / 私牌 / off-price / 清库存 / 小批量 DTC / 季节性 program | 渠道 + 价格 + SKU 复杂度 + 海关证据 |
| 4 | **Product & Supply-chain Fit** | 核心品类 · 面料/工艺推断 · QIMO 契合分 · 切入品 · 避免品 · 目标 FOB · 工厂要求 · 货源国 · 切换难度 | **product_match(已结构化)** + product_categories |
| 5 | **Decision Chain** | 推断的组织图(决策人/影响者/买手/守门人)· 缺失角色 · access 覆盖 · 下一个该找的人 | **contacts + access + 角色优先级阶梯** |
| 6 | **Contact Strategy** | 最佳首触 · 备用路径 · LinkedIn/邮件/官网/客服探询脚本 · 不该说什么 | decision-chain + 客户类型 |
| 7 | **Winning Strategy** ★ | 怎么赢 · 攻什么痛点 · 主打产品/样品 · 报价策略 · 竞争轴(价/速/开发/质/可靠)· 定位(主供/备供) | 客户类型 × fit |
| 8 | **Risk Assessment** | 付款/压价/低毛利/订单不稳/清库存/规模/可达性/工艺复杂度 + 战略账户?速赢?走量低毛利? | dims + 客户类型 + risk |
| 9 | **Resource Allocation** | **Action: Strike/Hunt/Nurture/Hold/Abandon** + 工时 · 样品预算 · 找人投入 · 是否老板出面 · 是否值得线下/长期培育 · 回报/投入 | access + tier + cooldown + SOE Action |
| 10 | **Next Actions** | 找这 3 个角色 · 发这封首邮 · 备这些样品图 · 备这个 FOB · 搜这些词 · 问客服这句 · X 天后跟进 · 建 Deal/留 Vault | 上述各节汇总 |

**关键规则**(吸取教训):
- 决策链**不止于"未找到"**——找不到直采人时,**按客户类型+规模推断组织图**并给出"下一个该找谁"。
- **客服邮箱 ≠ 成功**,只是 fallback 接入路径。
- 联系优先级阶梯:`VP/Dir Sourcing > Dir Production > Dir Merchandising > Supply Chain/Ops > (Senior) Buyer > Founder/Owner > 客服(兜底)`。

---

## 3. 8 类客户(静态画像表,驱动 2/6/7/8 节)

`Premium DTC · Growth activewear · Off-price/discount · Wholesale/trade · Retail private-label · E-com micro · Distributor/importer · Unqualified`。
每类预置:buying behavior / price-sensitivity / quality-sensitivity / dev-needs / likely DM / best approach / 默认竞争轴 / 默认 FOB 倾向 / 默认毛利档。
分类器:规则打分(品类、价位、company_type、渠道、规模、社媒)→ 最高分类型 + 置信度 + 命中理由。

---

## 4. 架构:纯推理层 + 缓存 JSON

```
companies / customer_scores / contacts / access / credibility / product_match / quote_strategies / deals  (已有数据)
        │  (纯函数,确定性,可单测,无 LLM)
        ▼
lib/intel/  ── buildBrief(inputs) → IntelligenceBrief(10 节)
        │  server action: rebuildBrief(companyId) → 缓存
        ▼
companies.intelligence_brief (JSONB, 缓存) + intelligence_brief_at
        │
        ▼
UI: 顶部决策卡 + Tabs(简报/决策链/制胜策略/产品契合/风险/下一步/原始证据)
```

**为什么纯规则(P0 不用 LLM)**:评分波动教训表明 LLM 不确定性会让结论漂移;决策简报必须**稳定、可解释、可单测、零成本、秒级**。LLM 仅作 P1 的"文案润色 + 邮件草稿"增强(复用现有 report-agent),**不参与分类/评级/资源决策**。

---

## 5. 数据模型(最小新增,其余复用)

- **新增**:`companies.intelligence_brief JSONB` + `companies.intelligence_brief_at TIMESTAMPTZ`(每公司 1 份当前简报,可重建)。
- **复用(不重存)**:`product_match`(→ §4 产品契合)、`customer_scores`/dims(→ §1 评级/赢率)、`contacts`+access+credibility(→ §5 决策链/§6 接触)、`quote_strategies`(→ FOB/报价)、`deals`(→ 是否已有机会)、`customer_events`(→ 关系)。
- 旧 `customer_intelligence_reports`:保留作为 **Raw Evidence / 长报告**(简报的"展开详情"),不再是主视图。

---

## 6. P0 范围(本次实现 · 确定性 · 重复用)

1. `lib/intel/types.ts` — `IntelligenceBrief` 接口(10 节)。
2. `lib/intel/customer-type.ts` — 8 类分类器 + 静态画像表。
3. `lib/intel/purchasing-model.ts` — 采购模型推断。
4. `lib/intel/product-fit.ts` — 复用 product_match + 品类 → 契合/切入/避免/FOB/货源/切换难度。
5. `lib/intel/decision-chain.ts` — 复用 access/角色阶梯 → 组织图推断 + 下一个该找谁。
6. `lib/intel/contact-strategy.ts` — 首触/备用/客服脚本/不该说什么。
7. `lib/intel/winning-strategy.ts` — 按类型×fit 模板化制胜策略。
8. `lib/intel/resource-allocation.ts` — Strike/Hunt/Nurture/Hold/Abandon + 投入档。
9. `lib/intel/risks.ts` · `lib/intel/executive-decision.ts` · `lib/intel/next-actions.ts`。
10. `lib/intel/brief.ts` — `buildBrief()` 组合(纯)。
11. 迁移:`companies` 加 2 列(你手动应用,本期出 SQL)。
12. server action:`actions/intel.ts` → `rebuildBrief(companyId)`(纯,秒级,无 LLM)。
13. UI:报告页改为"决策卡 + Tabs",Raw Evidence 置底;客户页加紧凑简报卡。
14. `scripts/validate-intel.ts`(纯单测:分类/采购模型/决策链/资源档/go-no-go 边界)。

**P1(后置)**:LLM 文案润色 + 邮件草稿(复用 report-agent)· 自动在 tier 后建简报 · 按类型精修 FOB 表 · 跨账户校准。

---

## 7. 验收(以真实海外品牌为测试,LEG3ND 不在本库 → 用 Oner Active 等)

简报必须不再只说"采购负责人未找到",而是给出:客户类型 · 是否值得开发 · 采购模型 · 决策链推断 · 最佳兜底接触路径 · 切入品 · 订单潜力 · 风险画像 · 制胜策略 · 接下来 5 个动作。
跑:`validate:intel` 单测 + typecheck + build + 一次 UI 冒烟。

---

*本设计:推理层纯函数、确定性、复用为主;P0 不引入新数据源、不依赖 LLM 做决策。先设计,P0 实现见上。*
