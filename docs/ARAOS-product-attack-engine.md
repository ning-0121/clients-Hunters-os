# ARAOS — Product Attack Engine P0 (设计评审 · 不含代码)

> 下一个瓶颈不是"找到公司/联系人",而是"**先卖什么**"。把系统从 customer-centric 升级为 **product-centric**:
> 打开一个客户,销售立刻知道——主打哪 3 个产品 / 寄什么样 / 报什么 FOB / 为什么 / 有哪些相似成功案例。
> 它是 **Customer Intelligence ↔ Quote Intelligence 之间的桥**。
> **范围限制(本期不做)**:Supplier Vulnerability / Switching / 现供应商处境 / 竞争情报 —— 数据不足,会造成虚假精确,延后。

---

## 0. 最关键的审计结论(决定整个设计)

| 数据源 | 现状 | 可用性 |
|---|---|---|
| **factory_profiles** | **2 行**(QIMO 自有 + 审核合作厂):main_categories / price_level / moq_range | ✅ 真实 · 可用 |
| **factory_capabilities** | **8 行**:seamless/leggings/sports_bra/yoga = **strong**,fleece = medium,sports_bra(合作厂)= medium … | ✅ **真实 · 这是我们唯一拥有的"产品/能力库"** |
| **factory_certifications** | **10 行** | ✅ 真实(用于 Sales Package) |
| **quotes** | **0 行** | ⚠️ 空 |
| **quote_strategies** | **0 行** | ⚠️ 空 |
| **orders** | **0 行** | ⚠️ 空 |
| **samples** | **0 行** | ⚠️ 空(且本就是"寄样记录",**不是带编码/库存的样品库**) |
| companies.product_match / product_categories | 已填(AI 推断) | ◓ 推断 |

**重大事实**:用户设想的"从历史报价取 FOB / 我们卖过哪些产品 / 样品库编码/可寄 / 相似成功订单"——**这些表目前全空**。只有 **工厂能力库是真实的**。

**因此 P0 的诚实做法(契合"宁要准确,不要花哨;只用我们真正拥有的数据"):**
1. **以工厂能力为地基**:推荐产品 = 客户需求(product_match/品类)∩ **我们真正擅长做的品类(factory_capabilities strong/medium)**。这是唯一硬数据,也是攻击计划的核心。
2. **历史依赖的小节优雅降级、明确标注**:FOB、样品就绪、相似成功案例在数据为空时**给出能力/复杂度推导的估值并标注"暂无历史报价/订单 → 估算",绝不伪装成"历史数据"**。
3. **证据分层(Evidence Tier)写进每条建议**:T1 拥有-硬(factory_capabilities/profiles/certs)· T2 拥有-历史(quotes/orders/samples,**当前空,随业务累积自动增强**)· T3 推断(product_match/类型)。**置信度 = f(证据层)**。这让"准确 > 复杂"成为结构性约束。
4. **数据飞轮**:引擎随每一次真实报价/订单/寄样自动变准——表已存在,只是还没数据。P0 把"消费历史"的接口留好,有数据即自动升级。

---

## 1. 架构评审(现状)

- **Customer Intelligence Brief**(lib/intel/*)已产出 `productFit`(cutInProducts/productsToAvoid/targetFobRange/competeOn)与 `winningStrategy`(leadProduct/sample/competeOn)——但它们来自 **AI product_match + 类型启发式**,**没有接工厂真实能力,也没接报价/订单**。
- **Quote Intelligence**:`lib/quote/engine.ts` + `quote_strategies`(margins/recommended_price/win_probability)——逻辑在,数据空。
- **Factory**:`lib/factory/matcher.ts` + `lib/factory/recommend.ts` + factory_profiles/capabilities/certifications——**真实能力数据 + 现成匹配逻辑**(已被 tiering 用)。

**Product Attack Engine 的本质 = 把 productFit 从"AI 启发式"升级为"工厂能力 + 历史证据 grounded",并补齐 10 个攻击小节。** 复用 factory matcher、brief、quote engine,不重复造。

---

## 2. 可复用资产

| 资产 | 用于攻击引擎的哪一块 |
|---|---|
| `factory_capabilities`(category + strong/medium/weak) | 推荐产品 / 避免产品 / 能力匹配 / Attack Score 核心 |
| `factory_profiles`(price_level / moq_range / main_categories) | FOB 估算地基 / MOQ / 工厂路由 |
| `factory_certifications` | Sales Package 资质清单 |
| `lib/factory/matcher` + `recommend` | 复用品类→工厂匹配(避免重写) |
| brief:`customerType` / `purchasingModel` / `productFit` / `winningStrategy.competeOn` / access | 竞争定位排序 / 首谈策略 / 上下文 |
| `quotes` / `quote_strategies`(空→将来) | Target FOB(历史)/ Attack Score 的 quote confidence |
| `orders`(空→将来) | 利润/复购/已发货证据 / 相似成功案例 |
| `samples`(空→将来) | 样品就绪(有先例?) |
| `companies.product_match` / `product_categories` | 客户需求侧品类 |

**禁止重复**:产品契合(已有 productFit,做"升级"非新建)、工厂匹配(已有 matcher)、报价 margin(已有 quote engine)。

---

## 3. Product Attack Engine 设计(纯函数,确定性,证据分层)

新模块 `lib/intel/product-attack.ts`,输入 = brief 上下文 + **factory capabilities/profiles/certs** + 历史(quotes/orders/samples,可空)。输出 10 节:

**① Recommended Entry Products(Top3)** — 候选 = 客户 product_match/品类 ∩ 工厂能力。
`attackScore(0-100)` = 能力匹配(strong=40/medium=20/weak/无=0)+ 切换成本低(基础款/我方强项 +)+ 毛利潜力(有 quote_strategy→真实 margin;否则 price_level 推导)+ 复购潜力(有 order 历史→真实;否则品类典型)+ 样品就绪(有先例→+)。每个产品带 confidence(= 证据层)+ 一句**有据可依**的 reason。

**② Why These Products** — 结构化、引用证据:最强品类契合(引 factory_capabilities="seamless: strong")· 最低切换成本 · 最高毛利(引 margin 或 price_level)· 最高复购潜力 · 最强工厂能力匹配。**禁止泛泛 AI 措辞**,每条挂数据来源。

**③ Products To Avoid** — 能力 weak/无、契合低、历史利润差(有数据时)。**不写"对手供应商成熟"**(那是被延后的竞争情报)——只用能力弱 + 契合低 + (可得时)利润差。

**④ Sample Attack Plan** — **诚实**:无样品库 → 按"该品类是否有寄样/订单先例"判定:有→"有先例,大概率可快速备样";无→"**需开发(无现成样品数据)**"。**不编造 sample code/库存**。(真正的样品库 = P1 新表,见 §6。)

**⑤ Target FOB Strategy(low/target/premium)** — 有历史报价(quotes/quote_strategies 该品类)→ 取真实区间并**注明来源**;无→由 **factory price_level + fabric 复杂度**推导,**标注"估算,暂无历史报价"**。绝不伪装历史。

**⑥ Competitive Positioning(排序)** — 6 轴(Price/Quality/Development/Speed/Reliability/Capacity)按**客户类型**排序(复用 winningStrategy.competeOn + 加 capacity 轴)。例:LEG3ND(off-price)→ Price > Reliability > Speed;Oner(premium)→ Development > Quality > Reliability。

**⑦ Similar Success Cases** — 有 orders/quotes(将来)→ 真实"已成交相似账户 + 产品 + 单量 + 为什么像";**当前空 → 降级为"相似潜客(同类型/同品类的库内公司)"并明确标注"尚无成交案例,仅相似画像"**,不冒充 wins。

**⑧ First Conversation Strategy** — 先展示什么(主打产品 + 相近产能证据)/ 不谈什么(如"我们是大厂")/ 价值主张(如"我们已稳定做相似 jogger,成本与交期可控")。来自攻击计划 + 类型。

**⑨ Sales Package(清单)** — 出击前要备:样品(④)、FOB 区间(⑤)、面料选项(能力)、参考案例(⑦)、产品图、证书(factory_certifications 真实)。

**⑩ Product Attack Score(0-100)** — 综合:能力契合 + 利润 + 复购 + 样品就绪 + quote 置信。**当前历史为空 → 由能力契合主导 + 整体 confidence 标"中(缺历史)"**。诚实反映数据成熟度。

> 纯函数、可单测、无 LLM 进决策;`product-attack.ts` 保持纯(历史/能力作为 input 传入,像 access),检索放 action 层。

---

## 4. UI 设计

`brief-view` 新增一等小节并按用户顺序重排:
```
1. Executive Decision        2. Product Attack Plan ★   3. Revenue Opportunity
4. Customer Intelligence(类型/采购模型/契合)  5. Decision Chain  6. Contact Strategy
7. Risks   8. Next Actions   9. Raw Evidence(仅最后)
```
Product Attack Plan 卡:Top3 产品(名 + Attack Score 条 + 证据层徽章)→ 为什么 → 避免 → 样品计划(Ready/开发)→ FOB(low/target/premium + 来源标注)→ 竞争定位排序 → 相似案例 → 首谈策略 → Sales Package 勾选清单。**每个 FOB/案例标注数据来源与证据层**(透明,反虚假精确)。

---

## 5. 实施计划

1. `types.ts` 增 `ProductAttackPlan` 接口(10 节 + evidenceTier/confidence)。
2. `lib/intel/product-attack.ts`(纯):能力∩需求 → attackScore/Top3、why、avoid、定位排序、FOB(能力推导 + 历史可选)、attack score。
3. `lib/factory/capabilities.ts` 或复用 `recommend`:加载 factory_capabilities/profiles/certs(若无现成 loader)。
4. `lib/intel/similar-cases.ts`:查 orders/quotes(空则降级相似潜客)。
5. action 层(`actions/intel.ts`):加载 capabilities + 历史 + similar,注入 buildBrief。
6. `brief.ts` 组合 `productAttack` 字段;`brief-view` 加卡 + 重排。
7. `validate:intel` 增断言(能力∩需求、avoid=能力弱、FOB 来源标注、空历史降级、Top3 非空)。
8. 真实冒烟:Oner / Vitality / Marika(+ LEG3ND 档案缺失则用同类替身),核对"卖什么/寄什么样/FOB/为什么/相似案例"。

节奏:纯函数 → UI → 验证;0 迁移(P0);不自动 push。

---

## 6. P0 / P1 路线图

**P0 — 能力 grounded 攻击计划(本期)**
- factory_capabilities ∩ 客户需求 → Top3 + Attack Score + 为什么 + 避免(全部 T1 真实证据)。
- 竞争定位排序 · 首谈策略 · Sales Package(certs 真实)。
- FOB(能力/复杂度推导 + 标注)· 样品计划(先例判定 + 诚实"需开发")· 相似案例(降级相似潜客 + 标注)。
- UI 新卡 + 重排 + 证据层标注。单测 + 真实冒烟。
- **0 新表、0 迁移**(复用 factory_* + brief + 空的 quote/order/sample 接口)。

**P1 — 历史证据接入(随数据成熟自动增强)**
- **真实样品库新表** `sample_library`(code / category / fabric / status / ready_to_send / photo)—— 这是"样品攻击计划"唯一缺的真实数据集。
- 接 quotes/quote_strategies → 真实 FOB 区间(取代估算)。
- 接 orders → 真实利润/复购/已发货 → 升级 Attack Score 与"相似成功案例"为真实 wins。
- 把 Attack Plan 一键带入 Quote 工作台(Customer Intelligence ↔ Quote Intelligence 真正打通)。

**(延后,数据足够再做)** Supplier Vulnerability / Switching / 竞争情报 —— 见本期范围限制。

---

## 7. 预估开发量

| 阶段 | 范围 | 估时 |
|---|---|---|
| **P0** | product-attack.ts + capability loader + similar(降级)+ types + brief 组合 + UI 卡&重排 + 单测 + 冒烟 | **2-3 天** |
| **P1** | sample_library 表 + quotes/orders 接入 + Attack→Quote 打通 | **3-4 天(随数据)** |

P0 短:0 迁移、复用工厂能力与现有 brief/quote/factory 逻辑,纯推理 + UI。

---

## 关键判断

- **唯一真实的"产品库"是 factory_capabilities(8 行能力 + 2 厂 + 10 证书)** —— P0 必须以它为地基,这是诚实且足够的攻击依据。
- **报价/订单/样品历史目前全空** → 依赖它们的小节优雅降级、标注证据层、绝不伪造;**引擎随真实业务数据自动变准(数据飞轮)**。
- 竞争情报按用户要求**延后**,避免虚假精确。
- 这一步把系统从"理解客户"变成"知道先卖什么、怎么开口、拿什么证明"——Customer Intelligence 与 Quote Intelligence 的桥。

*本文为设计评审与实施提案,不含代码。确认 P0 范围后再实现。*
