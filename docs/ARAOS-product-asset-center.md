# ARAOS — Product Asset Center (PAC) · 平台架构设计

> PAC 之于产品,如 Customer Intelligence 之于客户。
> Customer Intelligence 回答"**卖给谁**";PAC 回答"**到底卖什么**",并最终回答"**哪个产品、在什么时机、用什么策略、寄给哪个客户**"。
> 目标:把产品知识从 **tribal knowledge** 变成 **institutional intelligence**。按 3–5 年平台视角设计,但按"有真实数据才点亮"的节奏落地。
> **本文取代并吸收**:`ARAOS-sample-library.md`(= PAC Layer 2)与 `ARAOS-product-attack-engine.md`(= PAC Layer 8)。

---

## 0. 先挑战假设(最重要)

平台架构师的第一职责是说"不要现在建什么"。

1. **不要现在建全部 8 层。** Layer 5–8(开发/制胜/客户偏好/攻击智能)是**派生层**,依赖 quotes/orders/samples 历史——而这些表**现在 0 行**。在空数据上建 8 层 = 你两轮前自己警告过的"虚假精确"的更大版本。**正确做法:先建 spine(编码 + Product/Sample/Fabric 实体 + Attack Package 契约),派生层随真实数据自动点亮。** 按数据排期,不按组织架构图凑齐。

2. **Product 是中枢,不是 Sample。** 之前的"Sample Library"把样品当单位——错。单位是 **Product(产品资产)**;一个 product 有 0..n 个 sample(不同面料/配色)、用 1..n 种 fabric、被多张 quote/order 行引用。**`product_code` 是贯穿全公司的通用 join key**——sample→product、quote 行→product、order 行→product、客户互动→product。**把编码系统做对,是把 tribal knowledge 变 institutional 的那一步。** 其余一切引用它。

3. **Hard Data vs Derived Intelligence 是头号架构铁律(你已点出,我把它升为宪法)。** 只持久化硬事实(products/samples/fabrics/quotes/orders/margins)。**绝不把派生分(win rate / fit / attack score)当权威列存储**——一律按"计算 + 带 provenance 的缓存 + 可重算"产出,和 brief / 评分稳定化修复同一原则。否则平台会烂成一堆没人敢信的过期数字。

4. **能录才建。** Fabric/BOM/Development 只在被录入后才有价值。P0 让录入便宜、schema 正确,但不在空表上堆智能。

5. **"为未来设计 schema,但按今天的数据落地。"** 这调和了你"按 3–5 年设计"与两轮前"宁要准确不要花哨"两个要求:**schema 面向 5 年,build 是最小 spine,派生层随数据累积自动增强。**

> 一句话:**建中枢与编码,接真实数据,派生智能自来。** 不要现在造空中楼阁。

---

## 1. 架构评审(现状 → 目标)

**现状**:无产品目录、无面料库、无编码系统、无开发台账;`samples`(寄样台账,空)、`quotes/quote_strategies/orders`(空);`factory_profiles(2)/capabilities(8)/certifications(10)` 真实但小;brief(lib/intel)已能给客户类型/采购模型/目标 FOB。**产品知识 = tribal。**

**目标 PAC** = 以 Product 为中枢的**硬数据实体图** + 其上的**派生智能层** + 主输出 **Attack Package** + 面向 7 大系统的**集成接口**。

```
                   ┌─────────────── PAC ───────────────┐
 Hard Data(事实)  │  Product(中枢)                    │
   products ───────┼─┬─ samples(物理实例)              │
   fabrics ────────┼─┼─ product_fabrics(多对多)        │
   developments ───┼─┼─ product_versions / derivatives  │
   quotes/orders ──┼─┴─ *_lines → product_code(join)    │
   factory_*(已有)┼──── product↔factory 能力           │
                   │            │                        │
 Derived(计算)    │  winning score · fit · 偏好 · attack│  ← 缓存+provenance+可重算,绝不当事实存
                   │            │                        │
 Output            │  Product Attack Package(精确 IDs)  │
                   └────────────┬───────────────────────┘
 Integrations:  Customer · Contact · Quote · Order · Production · Factory · SOE
```

---

## 2. 八层(重构为:中枢实体 + 派生智能 + 输出)

| 层 | 性质 | P? | 说明 |
|---|---|---|---|
| **L1 编码系统** | 基础 | **P0** | `product_code` 通用主键(见 §5)。一切的脊柱 |
| **L4 Product Library** | 硬数据·中枢 | **P0** | 主产品资产:类目/规格/工厂/基础毛利/版本/衍生/生命周期 |
| **L2 Sample Library** | 硬数据 | **P0** | 物理样品实例,**引用 product**;编码/图/视频/面料/就绪/位置/库存/FOB |
| **L3 Fabric Library** | 硬数据 | **P1** | 面料情报;与 product 多对多;替代组 |
| **L5 Development Intel** | 硬数据+派生 | **P1** | 开发项目/客户需求/打样/审批;可复用开发发现 |
| **L6 Winning Product Intel** | 派生 | **P1→P2** | 从 quote→sample→order→repeat→margin 算"制胜产品"(数据足才准) |
| **L7 Customer-Product Intel** | 派生 | **P2** | 客户×产品交互(看/报/样/单/拒)→ 偏好模型 |
| **L8 Attack Package** | 输出 | **P0(雏形)→P1/P2** | 给定客户 → 精确 product/sample/fabric IDs + FOB/margin/win/置信/理由 |

P0 只点亮 L1/L4/L2 + L8 雏形(用真实录入数据 + 工厂能力,空则降级);L3/L5–L7 随数据排期。

---

## 3. 数据模型(面向 5 年,P0 建中枢三表)

```
products                                  -- L4 中枢
  id uuid pk · product_code text UNIQUE    -- "LG-2027-018"(脊柱)
  category text · subcategory text         -- 与 factory_capabilities 同一归一词表
  name · description · spec jsonb          -- 结构化规格(GSM/构造/工艺)
  status text                              -- active | development | archived
  version int default 1 · parent_product_id uuid -> products(id)  -- 版本/衍生
  primary_factory_id uuid -> factory_profiles(id)
  base_margin numeric · default_moq int · est_fob numeric  -- 硬事实(人录)
  lifecycle_stage text · created_at/updated_at
  -- 派生分不入此表(见 §8)

product_versions  (product_id, version, spec jsonb, change_note, created_at)  -- 规格演进
product_relationships  (product_id, related_id, kind)  -- derivative|substitute|companion

samples                                   -- L2(扩展现有寄样台账?否——见下)
  id · sample_code text UNIQUE · product_id uuid -> products(id)
  fabric_id uuid -> fabrics(id) · colorway · photo_urls text[] · video_urls text[]
  factory_id -> factory_profiles · owner · location · status · ready_to_ship bool
  available_quantity int · est_fob numeric · development_cost · lead_time_days · notes
  -- 就绪派生:Ready / Development / Out-of-stock / Archived

fabrics                                   -- L3(P1)
  id · fabric_code text UNIQUE · supplier · composition · gsm int · width
  stretch · certifications text[] · price_per_unit · stock_status · substitute_group text
product_fabrics  (product_id, fabric_id, is_default)   -- 多对多

developments                              -- L5(P1)
  id · product_id? · company_id? · request text · prototype_sample_id? · status · reusable bool · approved_by · dates

customer_product_events                   -- L7(P2):客户×产品交互台账
  id · company_id · product_id · event_type(viewed|quoted|sampled|ordered|rejected) · ref_table/ref_id · occurred_at

-- 既有事务表接入脊柱(最小改动,P1):
quotes.line_items / orders.product_lines  → 每行加 product_code(join 键)
samples_sent(= 现 samples 台账)           → 加 sample_library_id(寄的是哪个库样)
```

**关键澄清 vs 现有 `samples`**:现 `samples` 是**寄样事务台账**(寄给谁/到哪/反馈),保留;PAC 的 `samples`(库样目录)是**物理样品资产**。命名上:库样目录 = `sample_library`,寄样台账 = 现 `samples`,经 `sample_library_id` 关联。(本文沿用 L2=sample_library。)

---

## 4. 实体关系(ER 摘要)

```
factory_profiles 1─* factory_capabilities          (能力强弱/类目)
factory_profiles 1─* products                       (主产工厂)
products 1─* product_versions                        (版本)
products *─* products (product_relationships)        (衍生/替代/搭配)
products 1─* sample_library                          (一产品多物理样)
products *─* fabrics (product_fabrics)               (面料)
fabrics  *─* fabrics (substitute_group)              (替代)
products 1─* developments                            (开发史)
companies *─* products (customer_product_events)     (交互→偏好)
quotes/orders lines ─→ products (by product_code)    (历史→制胜分)
```
**唯一通用 join key = `product_code`**:把样品、面料、报价、订单、客户偏好、工厂能力**全部挂到同一个产品资产上**——这是平台价值的来源。

---

## 5. L1 产品编码系统(脊柱,先做对)

**格式**:`{CAT}-{YEAR}-{SEQ}` 例 `LG-2027-018`。
- `CAT`:2 字母类目(LG 打底裤 · BR 文胸 · JG 卫裤 · TS 套装 · FL 抓绒 · HD 卫衣 · JK 夹克 · SK 裙裤 · YG 瑜伽 · ST 套装 …),**与 factory_capabilities 类目词表同源**。
- `YEAR`:设计/系列年(服装季节性强,年有意义);`SEQ`:该类目该年内零填充序号。

**规则(挑战点)**:
- **变体(颜色/尺码/配色)不另起 product_code** —— 是该产品的 variant(在 sample 的 colorway / variants 表),否则编码爆炸。
- **版本(规格小改)不换 code,记 `version`/`product_versions`**;**实质重设计 = 新产品资产 = 新 code**(并用 `parent_product_id` 连原型)。
- **衍生品**:新 code + `product_relationships(kind=derivative)`。
- **归档**:`status=archived`,**code 永不复用/回收**(资产可追溯)。
- **样品编码**:`sample_code` 独立或 `{product_code}-S{n}`,**必引用 product_id**(一产品多物理样)。
- 编码即资产身份;一经分配不可变(rename 只改 name,不改 code)。

---

## 6. 核心工作流

1. **建产品资产**:录 product(自动发 code)→ 关联工厂/面料 → 加物理样(sample)→ 状态就绪。
2. **客户→产品推荐(主流程)**:打开客户简报 → PAC 生成 **Attack Package**(精确 product/sample/fabric IDs + FOB/margin/win/理由)→ 「寄此样」复用现有寄样流程(回填 sample_library_id)→ 「转报价」带入 Quote 工作台。
3. **搜索**:类目/面料/构造/MOQ/FOB/就绪/工厂 过滤 + 文本 + 按推荐分排序。
4. **历史回灌(数据足后)**:order/quote 行带 product_code → 自动算 winning score、客户偏好 → 反哺推荐。
5. **开发复用(L5)**:新需求来 → 搜相似既有开发/产品 → 复用而非重做。

---

## 7. UI 架构(为销售效率与速度)

1. **PAC 首页**:产品资产总览(按类目/工厂/就绪 + 制胜榜)、搜索、最近 attack packages。
2. **产品详情** `/pac/products/[code]`:规格/版本/衍生 · 关联面料 · 物理样 · 报价/订单历史 · 派生分(带 provenance)。
3. **样品详情** `/pac/samples/[code]`:图/视频/就绪/库存/FOB · 寄样历史 · 转化。
4. **面料详情** `/pac/fabrics/[code]`(P1):规格/认证/价/替代 · 用此料的产品。
5. **Attack Package 页** `/pac/attack/[companyId]`:Top 产品卡(精确 IDs + FOB/margin/win/置信/证据层 + 理由)+ 一键寄样/转报价。
6. **客户→产品工作流**:嵌入客户简报的 Product Attack Plan(取代旧降级文案)→ 精确 IDs。
- 录入 UI(产品/样品/面料):快录,团队真实数据。**速度第一,Raw 数据次要。**

---

## 8. Hard vs Derived 交互(宪法落地)

- **Hard**(人录/事务):products/samples/fabrics/quotes/orders/margins → 唯一事实源,可编辑。
- **Derived**(计算):win rate / product fit / attack score / 偏好 / 推荐分 → **物化视图或带 `inputs_snapshot + computed_at` 的缓存,读时可重算,永不手改,永不当事实**。UI 上派生数字一律标**证据层 + 计算时间**(透明,反虚假精确)。
- 数据飞轮:每张真实 quote/sample/order 提升 derived 准确度;derived 永不污染 hard。

---

## 9. 推荐引擎架构(多信号,证据分层,确定性)

`recommendAttack(companyCtx, products[], samples[], history) → ScoredProduct[]`(纯函数,无 LLM 进决策)。

每个产品 `attackScore(0-100)` = 加权:
- **工厂能力契合**(factory_capabilities strong/medium/weak) ·
- **客户需求契合**(product_match/品类/采购模型) ·
- **盈利性**(base_margin / est_fob vs 客户目标 FOB) ·
- **样品就绪**(有 Ready 库样 ≫ 需开发) ·
- **历史制胜**(win rate,**数据足才计入**,否则降权) ·
- **客户偏好**(customer_product_events,**P2 才有**)。

**证据分层**:T1 拥有-硬(工厂能力/已录产品样面料)· T2 拥有-历史(quotes/orders/样反馈,现空→将来)· T3 推断(brief)。**置信 = f(证据层)**;空历史 → 能力主导 + 标"中置信(缺历史)"。

---

## 10. Product Attack Engine 重构(围绕 PAC)

旧:输出"推荐 leggings"(类目串)。**新:输出精确资产** ——
```
AttackPackage(companyId) = {
  products: [{ product_code:"LG-2027-018", sample_code:"LG-2027-018-S2", fabric_code:"FB-NYLSPX-014",
               est_fob, est_margin, win_rate?, confidence, evidence_tier, rationale:[...证据...] }, ...Top N],
  avoid: [{ product_code, reason }],
  basis: { customerType, purchasingModel, targetFob, factoryStrengths }, generatedAt
}
```
回答:推什么(精确 ID)· 为什么(证据)· 寄什么样(sample_code + 就绪)· 预期 FOB/margin/win。**这是 PAC 的主输出,接 Customer Intelligence(谁)+ Quote(策略)+ SOE(时机/配置)。**

---

## 11. 集成接口(为未来预留)

| 系统 | PAC 提供 / 消费 |
|---|---|
| Customer Intelligence | 简报嵌入 Attack Package(产品维度);消费客户类型/采购模型/目标 FOB |
| Contact Intelligence | 给"先寄给谁"的人选 |
| **Quote Intelligence** | Attack Package → 报价行(product_code + est_fob)闭环 |
| **Order Intelligence** | order 行带 product_code → 回灌 winning score / 偏好 |
| Production / Factory Intelligence | 能力/产能/MOQ 约束推荐;新产品归属工厂 |
| **SOE / Strategic Opportunity** | 产品级配置:**哪个产品、什么时机、什么策略、寄哪个客户**(PAC 提供产品维度,SOE 排时机与资源) |

所有接口以 `product_code` 为通用键。

---

## 12. 路线图

**P0 — Spine(中枢 + 编码 + 攻击雏形)** ~1.5–2 周
- L1 编码系统(纯函数发码 + 规则)· L4 `products` 中枢表 · L2 `sample_library`(引用 product)· factory 复用。
- L8 Attack Package 雏形:精确 product/sample IDs,能力 grounded,空数据优雅降级 + 证据层。
- UI:PAC 首页 + 产品/样品详情 + 录入表单 + 客户简报嵌入 Attack Package(取代旧降级)。
- Hard/Derived 分离落地;单测(发码/推荐打分/就绪派生/空降级)+ 真实冒烟(录数样 → Oner/Vitality 出 Attack Package)。

**P1 — 数据接入与扩展** ~2–3 周(随数据)
- L3 Fabric Library + product_fabrics + 替代推荐 · L5 Development Intel · quotes/orders 行接 product_code · Attack→Quote 闭环 · 样品照片 storage 上传 · winning score 初版。

**P2 — 派生智能与偏好** ~3–5 周
- L6 Winning Product Intelligence(数据足)· L7 Customer-Product 偏好模型 · product_relationships 图(衍生/替代)· SOE 产品级配置(产品×客户×时机)。

**长期愿景**
- **全球服装集团的产品智能操作系统**:每个产品/样品/面料/开发/报价/订单都是**编码、可搜、可评分的资产**;系统把**对的产品、在对的时机、用对的策略、路由给对的客户**;产品知识跨组织复利。
- 多租户后,跨工厂的产品×成交数据聚合成**全行业制胜产品/面料情报**——单厂造不出的护城河,与 SOE 的 "Aladdin" 愿景同构:PAC 是其**产品维度**。
- 终态:Customer Intelligence(谁)× PAC(什么)× SOE(何时/多少资源)× Quote(什么价)= go-to-market 的产品-客户-时机-价格四维配置智能。

---

## 关键判断

- **Product 是中枢,`product_code` 是全公司通用 join key** —— 把它做对,tribal knowledge 才能变 institutional。
- **不要现在建 8 层**:建 spine(编码+Product+Sample),派生层(制胜/偏好/攻击智能)随真实 quote/order/sample 数据自动点亮——否则就是更大的虚假精确。
- **Hard vs Derived 是宪法**:事实可存可编辑,智能只计算不当事实存(带 provenance + 可重算 + 证据层)。
- **PAC 取代 Sample Library(L2)与 Product Attack Engine(L8)两份旧设计**,把它们纳入统一平台。
- 这是平台能力,不是功能;但落地按数据排期,P0 只交付能产生真实价值的最小中枢。

*本文为平台架构设计评审,不含代码、不建迁移。确认 P0 spine 范围后再实现。*
