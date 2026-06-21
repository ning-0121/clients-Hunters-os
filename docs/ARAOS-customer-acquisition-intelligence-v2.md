# ARAOS — Customer Acquisition Intelligence V2 (设计评审 · 不含代码)

> 从"理解客户"升级为"赢下客户"。V2 不是新报告系统,而是在已建的 **Customer Intelligence Brief**(lib/intel/*)
> 之上,补一个缺失的层(**竞争情报 / 对手供应商处境**),强化两个层(产品攻击、营收),并让 **SOE 配置动作**消费这些新信号。
> 每一节都回答"**怎么赢下这个账户**",而非"我们知道这个账户什么"。气质对标 Palantir / McKinsey / PE 投资备忘录。

---

## 1. 架构评审(现状)

**已建 Customer Intelligence Brief** = 纯确定性推理层 + 实时计算 + 可选缓存:
- `lib/intel/`:`brief.ts`(组合)· `customer-type` · `purchasing-model` · `product-fit` · `decision-chain` · `contact-strategy` · `winning-strategy` · `executive-decision` · `resource-allocation`(SOE Action)· `risks` · `next-actions` · `inputs.ts`(DB 映射)。
- 报告页实时计算 `buildBrief()`;`companies.intelligence_brief` JSONB 缓存(迁移 014)。
- 已输出:评级/Go-No-Go/赢率/年潜力/毛利/资源档、客户类型、采购模型、产品契合(切入品/避免品/FOB/竞争轴)、决策链、接触策略、制胜策略、风险、SOE Action、下一步。

**可复用资产(V2 全部在其上构建,禁止重复造)**:
| 资产 | 用途 |
|---|---|
| `companies` 信号列:`hiring_signal/hiring_roles/hiring_signal_score`、`trigger_type/trigger_score/trigger_detected_at`、`new_products_detected`、`funding_detected`、`recruitment_signals`(jsonb)、`management_pain_signals`(jsonb)、`current_supplier_hints`(text[])、`intent_score/intent_signals`(jsonb) | **竞争情报层的全部输入** |
| `trigger_events`(时序)· `lib/enrichment/trigger-detector`(new_product/scaling/funding/press)· `lib/intent/intent` · `source_raw.customs` | 切换/时机信号 |
| `customer_scores` / dims、`access`、`credibility` | 营收/赢率/可达 |
| `quote_strategies`、`deals`(won)、`samples/orders`、`product_match` | **产品攻击 + 历史相似案例** |
| `customer_events` | 关系/时机 |

**结论**:V2 想要的"执行决策/产品攻击/营收/SOE Action"**大部分已存在**;真正缺的是 **Phase 1 竞争情报层**(客户的"现供应商处境"),其输入信号也**已经在库**。这是一次推理增量,不是数据工程大改。

---

## 2. 差距分析(目标 vs 现状)

| V2 能力 | 现状 | 差距 | 落点 |
|---|---|---|---|
| **Supplier Vulnerability Score (0-100)** | ✗ 无 | **新** | `lib/intel/competitive.ts`(规则,复用 hiring/trigger/pain/customs/intent) |
| **Switching Probability (0-100%)** | ✗ 无 | **新** | 同上 |
| **Supplier Situation**(Stable/Under-pressure/Capacity/Quality/Price/Unknown + 置信) | ✗ 无 | **新** | 同上 |
| **Account Opportunity Window**(Closed/Limited/Open/Hot) | ✗ 无(仅有 size) | **新** | 同上(= f(switching, access, 时机新鲜度)) |
| **Product Attack — 入门 Top3 + 理由** | ◓ 部分(`cutInProducts`/`productsToAvoid`) | **强化**:结构化"为什么"(切换成本/契合/易验证/毛利/补单)+ Top3 排序 | `product-fit` 扩展 |
| **FOB Low/Target/High** | ◓ 单一区间 | **强化**:三点 | `product-fit` 扩展 |
| **竞争定位排序**(price/dev/quality/speed/reliability/capacity) | ◓ 无序数组 | **强化**:排序 + 加 capacity 轴 | `winning-strategy` 扩展 |
| **Sample Recommendation** | ◓ 一句 | **强化**:样品类型清单 | `product-attack` |
| **Historical Similarity**(最相似成功案例) | ✗ 无 | **新**:检索 won deals + quotes + 同类公司 | `lib/intel/similar-cases.ts`(查询现有表) |
| **Revenue — 年潜力 保守/预期/上行** | ◓ low/high 两点 | **强化**:三点 | `executive`/新 `revenue.ts` |
| **Margin / Win% / Resource** | ✓ 已有 | 复用 | — |
| **Time To First Order** | ✗ 无 | **新**(规则:采购模型×窗口×复杂度) | `revenue.ts` |
| **CLV Potential (L/M/H)** | ✗ 无 | **新**(类型×规模×复购性) | `revenue.ts` |
| **Strategic Value (L/M/H/Critical)** | ◓ 布尔 `strategicAccount` | **升级**为 4 档 | `revenue.ts` |
| **SOE Action(STRIKE/HUNT/NURTURE/HOLD/ABANDON)** | ✓ 已有 | **升级**:消费 opportunity window + supplier vulnerability | `resource-allocation` 扩展 |
| **Expected ROIC (L/M/H)** | ◓ `returnVsEffort` 文本 | **结构化**为 3 档 | `resource-allocation` 扩展 |
| **UI:执行决策优先 + 新分节顺序 + Raw Evidence 置底** | ◓ 已 Raw 置底,顺序不同 | **重排 + 加 3 节** | `components/intel/brief-view` |

图例:✓ 已有 · ◓ 部分 · ✗ 缺失 · **新/强化/升级**。

---

## 3. 数据模型变更(最小)

- **0 个新表、0 个必需新列**:竞争情报/营收/产品攻击全部是**对现有信号的新推理**,实时计算;沿用 `companies.intelligence_brief` JSONB 缓存(迁移 014 已设计,扩展其 JSON 形状即可,无 schema 变更)。
- **Historical Similarity**:查询时 join `deals(status=won)` + `quote_strategies` + `companies`(按 product_categories/type 匹配),**无需新表**。
- **可选(P2 性能)**:`won_case_index`(物化视图,缓存成功案例向量),仅当相似检索变慢再做。
- **信号新鲜度**:复用 `trigger_detected_at` / `intent_checked_at` / `trigger_events.created_at` 判断"时机新鲜度",驱动 Opportunity Window 的 Hot 档。

> 原则:V2 是推理增量。若某信号缺失(如 management_pain_signals 为空)→ 推理降级为"Unknown + 低置信",绝不编造。

---

## 4. UI 重排(执行优先)

新分节顺序(`brief-view` 重排 + 新增 ★):
```
1. Executive Decision   — Should We Pursue? · Why? · Recommended Action(SOE)· Expected ROIC
2. Revenue Opportunity ★ — 年潜力(保守/预期/上行)· Margin · Win% · TTFO · CLV · Strategic Value
3. Competitive Intelligence ★ — Supplier Vulnerability · Switching% · Supplier Situation · Opportunity Window
4. Product Attack Plan ★ — Top3 入门品 + 为什么 · 避免品 · FOB(低/目标/高)· 竞争定位排序 · 样品建议 · 相似成功案例
5. Decision Chain
6. Contact Strategy
7. Risks
8. Next Actions
9. Raw Evidence(仅最后)
```
- 顶部决策卡升级:加 **Opportunity Window 徽章**(Hot/Open/Limited/Closed)+ **Supplier Vulnerability 条** + **Expected ROIC**。
- 仍为服务端渲染、堆叠分节(沿用现有稳健做法,无客户端 tabs 依赖)。

---

## 5. 推理引擎设计(规则,确定性,可单测)

**新模块 `lib/intel/competitive.ts`** — 输入:companies 信号 + access + customer type。
- `supplierVulnerability(0-100)` 加权:sourcing/production/supply-chain 招聘(+30)· management_pain(质量/交期/成本投诉)(+20)· scaling/expansion trigger(+15)· funding(+10)· new_products(+10)· 海关换供应商/进口波动(+20)· current_supplier_hints 单一来源(+10)· intent_score 高(+15)→ clamp;档:<25 Low / 25-50 Medium / 50-75 High / 75+ Critical。
- `switchingProbability(0-100%)` = f(vulnerability 主导 + 活跃评估信号:招 sourcing、近期 RFQ/intent),偏向"正在找替代"的信号。
- `supplierSituation` 分类(取主导信号):质量投诉→Quality challenged;scaling+招生产→Capacity constrained;价格敏感型+成本信号→Price challenged;招 sourcing+funding→Under pressure;无信号且成熟→Stable;否则 Unknown(+置信)。
- `opportunityWindow` = Hot(高 switching + 近期触发 + 可达)/ Open(中高 switching)/ Limited(弱信号)/ Closed(无信号/稳定/unqualified)。**与客户规模解耦**。

**新模块 `lib/intel/revenue.ts`** — annualPotential{conservative,expected,upside}(在现 low/high 上加中点与上行)· timeToFirstOrder(采购模型×窗口×复杂度:ecom/off-price+Open→<30d;premium/private-label→3-6mo+)· clv(类型复购性×规模×margin)· strategicValue 4 档(旗舰 logo/A/高 CLV/组合外部性→Critical)。

**新模块 `lib/intel/similar-cases.ts`** — 检索现有 won deals + quotes + 同类 companies,按 product_categories/type/FOB 相似度排序,输出"最相似成功案例 + 当时打法"。

**扩展**:`product-fit`(Top3 排序 + 三点 FOB + 结构化"为什么")· `winning-strategy`(竞争轴排序 + capacity 轴 + 样品清单)· `resource-allocation`(Action 消费 window+vulnerability;Expected ROIC = 风险调整潜力 ÷ 投入,3 档)· `executive`(headline 纳入 window/ROIC)。

**组合**:`brief.ts` 增 `competitive` / `revenue` / `productAttack` / `similarCases` 字段;`types.ts` 扩展 `IntelligenceBrief`。全部纯函数、可单测,**沿用"无 LLM 进决策路径"原则**(吸取评分波动教训)。

---

## 6. 实施计划

1. 扩展 `types.ts`(新增 Competitive/Revenue/ProductAttack/SimilarCase 接口)。
2. 写 `competitive.ts` + 单测(vulnerability/switching/situation/window 边界)。
3. 写 `revenue.ts` + 单测(TTFO/CLV/strategicValue/三点潜力)。
4. 写 `similar-cases.ts`(查询层)+ 在 action 里注入(brief.ts 保持纯,相似案例作为 input 传入,像 access 一样)。
5. 扩展 `product-fit` / `winning-strategy` / `resource-allocation` / `executive`。
6. `brief.ts` 组合新字段;`actions/intel.ts` 加载 similar-cases 并传入。
7. `brief-view` 按 §4 重排 + 3 个新分节 + 决策卡升级。
8. `validate:intel` 增 V2 断言(竞争情报、营收、ROIC、窗口、相似案例)。
9. 真实公司冒烟(Oner/Marika/Vitality)+ typecheck + build。

节奏:纯函数先行 → UI → 验证;不自动 push;迁移无需改(复用 014 JSON)。

---

## 7. P0 / P1 / P2 路线图

**P0 — 赢单决策闭环(本体)**
- Competitive Intelligence 层(vulnerability/switching/situation/window)— **最缺、最高价值**。
- Revenue 层(三点潜力/TTFO/CLV/Strategic 4 档)。
- SOE Action 升级(消费 window+vulnerability)+ Expected ROIC。
- UI 重排 + 3 新分节 + 决策卡升级。
- 单测 + 真实冒烟。

**P1 — 攻击精度**
- Historical Similarity(相似成功案例检索)。
- Product Attack 强化(Top3 排序 + 三点 FOB + 结构化理由 + 样品清单 + capacity 轴)。
- 决策卡 Opportunity Window/ROIC 徽章细化;公司页紧凑简报卡。

**P2 — 复利与规模**
- 信号新鲜度衰减 + Opportunity Window 随 trigger_events 时序自动升降。
- won_case_index 物化视图(相似检索提速)。
- 把竞争情报回灌 SAI Vault 的找人频率(高 switching → 提频 Hunt)。
- (远期)跨账户成功案例 → ROIC 模型校准(对接 SOE 长期愿景)。

---

## 8. 预估开发量

| 阶段 | 范围 | 估时 |
|---|---|---|
| **P0** | competitive.ts + revenue.ts + Action/ROIC 升级 + executive/类型扩展 + UI 重排+3 节 + 单测 + 冒烟 | **3-4 天** |
| **P1** | similar-cases 检索 + product-attack 强化 + 决策卡细化 + 公司页卡 | **2-3 天** |
| **P2** | 新鲜度衰减 + 物化视图 + 回灌 Vault + ROIC 校准 | **3-5 天(可分批)** |

P0 之所以只要 3-4 天:**0 迁移、0 新表、复用全部信号与现有 brief 架构**,纯推理增量 + UI 重排。

---

## 关键判断

- **真正缺的只有"竞争情报层"** —— 让系统第一次看见"客户的现供应商处境与切换窗口"。这是从"理解客户"到"赢下客户"的那一步。
- 其余多为**对已有输出的结构化升级**(三点潜力、ROIC、Action 消费新信号、UI 重排),不是重写。
- 全程**确定性规则、复用现有数据、无 LLM 进决策、信号缺失即降级不编造**。

*本文为设计评审与实施提案,不含代码。确认 P0 范围后再进入实现。*
