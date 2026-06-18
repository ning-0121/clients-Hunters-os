# ARAOS P1.5 — Quote Intelligence Engine（报价策略引擎）产品设计

> 目标：让系统在"找到客户→联系→成交"之后，回答**"该怎么报价才能既拿单又保利润"**。
> 阶段一：QIMO 服装外贸；设计预留制造/包装/家具/SaaS 的抽象口，但当前不实现。
> 不讨论：多租户 / Playbook 编辑器 / SaaS 商业化 / 计费。聚焦成交率 + 利润率。

系统要回答：推荐报价多少 / 推荐利润率 / 最低可接受利润率 / 是否让价 / 是否补贴样品 / 是否值得争取 / 成交概率 / 风险在哪。

---

## 1. 产品架构图

```
输入（大部分已存在 ARAOS，无需重建）
┌─────────────────────────────────────────────────────────────┐
│ 客户侧：customer_tier · intent_score · contact 可信度 ·        │
│         estimated_annual_revenue · ltv_potential · 国家 · 类型 │
│ 风险侧：lib/credit/assess.ts（付款/国家风险，已实现）          │
│ 历史侧：orders / samples（成交与样品记录）                     │
│ 产品侧：报价品类 + 数量 + 面料复杂度（业务员选/填）            │
│ 竞争侧：是否比价 · 竞争强度（业务员标 + 海关线索推断）         │
│ 成本侧：品类基准成本/利润配置（pricing_config，新增·轻量）     │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│                  Quote Intelligence Engine                    │
│  ① 四个评分：Pricing / Deal Value / Win Prob / Risk (0-100)   │
│  ② 三档利润率：Floor → Recommended → Target                   │
│  ③ 谈判策略：允许/禁止的让步（规则引擎）                       │
└─────────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────────┐
│              报价策略卡（嵌入一页作战卡 / 客户页）             │
│   成交概率 · 推荐/目标/底线利润率 · 风险提示 · 建议策略        │
└─────────────────────────────────────────────────────────────┘
```

**确定性 + 可解释**：和分级/信用一样，引擎是**规则化打分**（非 LLM 拍脑袋），每个数字都能点开看"为什么"。LLM 仅用于把策略润色成一句话建议。

---

## 2. 数据模型设计

**复用（已存在，不重建）**
- `companies`：`customer_tier` · `intent_score` · `payment_risk_score` · `estimated_annual_revenue` · `ltv_potential_score` · `customer_scale_score` · `country` · `target_customer_segment` · `product_match` · `compliance_level` · `recommended_factory_type`
- `customer_scores`：`reply_probability_score` · `ltv_potential_score`
- `lib/credit/assess.ts`：付款/国家风险 band+score（**直接喂给 Risk Score**）
- `orders` / `samples`：历史成交、样品补贴记录
- 联系人可信度（`computeCredibility`）：Contact Quality 输入

**新增（轻量）**
- `pricing_config`（每品类基准）：`category` · `base_cost_index` · `base_margin` · `floor_margin` · `complexity_factor` · `dev_cost` · `moq`。阶段一手填 5 个服装品类（leggings/bra/jacket/hoodie/shorts），存 `app_config` 或独立表。
- `quote_strategies`（每次报价生成的快照）：见 §7。
- `companies` 增报价相关可选列：`is_price_comparing`(bool) · `competition_level`(text)——业务员标注（也可由海关供应商数推断）。

---

## 3. 评分模型设计（四个 0-100，规则化）

### ① Pricing Score（定价权：我能报多高）
高 = 我有定价权（可报高价）。
```
+ 产品匹配独特性（product_match High/特殊面料）   ↑
+ Intent 高（客户急需）                          ↑
+ 弱竞争 / 客户不比价                            ↑
+ 客户等级 A+/A（看重质量而非最低价）             ↑
− 强竞争 / 客户在比价 / 大路货品类                ↓
```

### ② Deal Value Score（这单/这客户值多少）
```
estimated_annual_revenue(权重高) × ltv_potential × 增长潜力(intent/规模)
+ 复购品类（leggings/bra 易返单）加分
→ 归一化 0-100
```

### ③ Win Probability（成交概率）
```
intent_score(×权重) + contact_quality(已验证关键人=高) +
reply_probability_score + 竞争位置(弱竞争↑/比价↓) + tier 匹配
→ 0-100
```

### ④ Risk Score（风险，越高越危险）
```
lib/credit/assess.ts 的 risk band/score（付款+国家）   主因
+ 生产风险（特殊面料/低 MOQ/高开发成本/需合作工厂）
+ 新客户风险（无历史订单 / 合作年限=0）
→ 0-100
```

> 各维度权重先用合理默认（文档附表），跑一段时间后按真实成交校准。

---

## 4. 报价策略模型设计（三档利润率 + 谈判规则）

### 三档利润率（都从品类基准 `pricing_config` 出发再调整）
```
Target Margin     = base_margin(品类)
                    + Pricing Score 调高（定价权强→+3~6%）
                    − 竞争激烈调低
Recommended Margin= Target
                    − 为提升成交适度让利（Win Prob 低 & Deal Value 高 → 下调）
                    但永远 ≥ Floor
Floor Margin      = floor_margin(品类)
                    + Risk 溢价（高风险客户底线抬高，覆盖坏账）
                    ← 绝对红线，系统禁止低于
```
示例输出：`底线 15% → 推荐 18% → 目标 22%`。
同时反推**推荐报价金额** = 成本(成本指数×数量) ÷ (1 − Recommended Margin)。

### 谈判策略（规则引擎 → 允许/禁止清单）
```
允许 ✓ 样品补贴      ← Deal Value 高 且 Risk 低 且历史无白嫖
允许 ✓ 小幅价格让步  ← 让步后仍 ≥ Floor 且 Win Prob 能提升
允许 ✓ 延长账期      ← 付款风险低 / 有良好历史付款
禁止 ✗ 低于底线利润  ← 永远
禁止 ✗ 特殊面料赊账  ← 生产风险高 + 付款风险中以上
禁止 ✗ 给比价客户首报最低价 ← 留谈判空间
```
每条规则带"为什么"，业务员一眼懂。

---

## 5. 页面设计方案 —— 报价策略卡

嵌入**一页作战卡**的"成交机会/下一步"区，也可在客户页独立卡：

```
┌── 报价策略 · [客户名]  [等级 A]  [🔥意图 8] ─────────────┐
│  成交概率   ███████░░  72%                               │
│  风险        ████░░░░░  38%（付款风险低·新客户）          │
│                                                          │
│  利润率   底线 15%  →  推荐 18%  →  目标 22%              │
│  推荐报价  $4.20/件（基于 leggings 成本 × 1500 件）       │
│                                                          │
│  ✅ 可以：样品补贴 / 小幅让步(≥15%) / 账期 30 天          │
│  ⛔ 不要：低于 15% / 特殊面料赊账 / 首报就给最低          │
│                                                          │
│  ⚠ 风险：新客户无历史订单，建议首单预付 30%               │
│  [选品类▾] [填数量] [重新计算]   [复制给客户的报价话术]    │
└──────────────────────────────────────────────────────────┘
```
- 业务员选**品类 + 数量 + 面料复杂度** → 实时算。
- "复制报价话术"：LLM 用上述数字生成一段专业、给客户看的报价说明（带价值锚点，不只报数字）。

---

## 6. API 设计（Server Actions，与现有一致）

- `computeQuoteStrategy(companyId, { category, qty, fabricComplexity, isPriceComparing?, competitionLevel? })`
  → 纯函数（`lib/quote/engine.ts`），返回 `{ pricingScore, dealValueScore, winProbability, riskScore, margins:{floor,recommended,target}, recommendedPrice, strategy:{allow[],forbid[],warnings[]}, factors[] }`。零成本、可解释。
- `triggerQuoteStrategy(formData)`（action）：算 + 存 `quote_strategies` 快照 + revalidate 客户页。
- `generateQuoteMessage(companyId, strategyId)`（action）：LLM 把策略转成客户可读报价话术（复用 compose 风格）。
- `saveQuoteOutcome(formData)`：记录最终成交价/利润（用于后续权重校准）——P2。

---

## 7. 数据库设计

```sql
-- 品类定价基准（阶段一手填 5 个服装品类）
CREATE TABLE pricing_config (
  category          TEXT PRIMARY KEY,   -- leggings|bra|jacket|hoodie|shorts
  base_cost_index   NUMERIC,            -- 单件基准成本（货币无关指数/或 USD）
  base_margin       NUMERIC,            -- 默认目标利润率 0-1
  floor_margin      NUMERIC,            -- 默认底线 0-1
  complexity_factor NUMERIC DEFAULT 1,  -- 面料/工艺复杂度系数
  dev_cost          NUMERIC DEFAULT 0,
  moq               INT
);

-- 每次报价策略快照（可重算、可追溯）
CREATE TABLE quote_strategies (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID REFERENCES companies(id) ON DELETE CASCADE,
  category         TEXT,
  qty              INT,
  fabric_complexity TEXT,             -- low|medium|high
  pricing_score    INT,
  deal_value_score INT,
  win_probability  INT,
  risk_score       INT,
  floor_margin     NUMERIC,
  recommended_margin NUMERIC,
  target_margin    NUMERIC,
  recommended_price NUMERIC,
  strategy         JSONB,             -- {allow,forbid,warnings,factors}
  inputs_snapshot  JSONB,             -- 算时的客户信号快照，便于复盘
  created_by       TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

-- companies 增两列（业务员标注，可空）
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_price_comparing BOOLEAN;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS competition_level  TEXT; -- extreme|strong|normal|weak
```
全部加表/加列，不动现有数据。

---

## 8. 开发排期 P0 / P1 / P2

**P0 — 能用的报价建议**
1. `pricing_config` + 5 个服装品类基准（手填）
2. `lib/quote/engine.ts`：四评分 + 三档利润率（复用 tier/intent/credit/orders）
3. 报价策略卡（客户页/作战卡），选品类+数量实时算
4. 谈判策略规则引擎（允许/禁止清单）

**P1 — 更准 + 更顺**
5. "复制报价话术"（LLM 生成客户可读报价）
6. 竞争维度输入（比价/竞争强度标注 + 海关供应商数推断）
7. `quote_strategies` 快照 + 历史报价回看

**P2 — 自我校准**
8. `saveQuoteOutcome` 记录真实成交价/利润
9. 用成交数据反向校准评分权重与品类基准
10. 付款表现（Payment Records）接入 Risk

---

## 9. 风险分析

| 风险 | 说明 | 缓解 |
|---|---|---|
| **垃圾进垃圾出** | 没有真实成本数据，利润率是空中楼阁 | P0 先让 QIMO 填 5 个品类真实成本基准；缺数据时显式标"仅供参考·待补成本" |
| **过度信任分数** | 业务员当成圣旨、丧失判断 | 全部可解释 + 标"建议"；Floor 是硬红线，其余是参考 |
| **底线被突破** | 让步累加跌破 Floor | 引擎硬约束：任何让步后校验 ≥ Floor，否则禁止 |
| **竞争/比价信息靠人填** | 不填则失真 | 给默认值 + 海关供应商数量做弱推断；P1 增强 |
| **新客户无历史** | Win/Risk 估不准 | 新客户风险显式加分 + 建议预付；积累订单后变准 |
| **汇率/成本波动** | 报价过期 | 快照带时间戳，成本基准可随时更新重算 |

---

## 10. 与现有 ARAOS 模块的集成

| 现有模块 | 如何接入报价引擎 | 不重建 |
|---|---|---|
| 客户分级 `tiering` | tier → 定价权 + 利润基准 | ✓ |
| `intent_score` | → Win Prob + 定价权（急需可报高） | ✓ |
| 联系人可信度 | → Win Prob 的 Contact Quality | ✓ |
| `lib/credit/assess.ts` | → **直接作为 Risk Score 主输入** | ✓ 关键复用 |
| `orders` / `samples` | 历史成交/样品补贴 → Risk + 谈判策略（防白嫖） | ✓ |
| 一页作战卡 | 报价策略卡嵌入"成交机会"区 | ✓ |
| `estimated_annual_revenue`/`ltv` | → Deal Value Score | ✓ |
| 开发信 compose | 复用其风格生成报价话术 | ✓ |

**抽象预留**：评分维度与 `pricing_config` 都参数化，未来换行业=换一套品类基准 + 调权重即可，引擎逻辑不变（与通用化蓝图一致，但当前只填服装）。

---

**一句话**：报价引擎把 ARAOS 已经算好的"客户价值/意图/可信度/信用风险"汇成一张**报价策略卡**——告诉业务员报多少、能让多少、底线在哪、能不能补样品——直接服务"成交率 + 利润率"。

---

# 补充设计（V1.1）：Strategic Value + Strategic Margin + Sample Engine + CAC 预留

> 核心理念升级：报价引擎不优化"单笔利润率"，而优化 **长期利润最大化**。很多客户的价值不在当前利润，而在渠道/品牌/增长/引流/长期价值。

## A. 第五评分 — Strategic Value Score（0-100）

衡量"这个客户对未来的价值"，独立于当前这单的利润。

| 子维度 | 含义 | 数据来源（多为已有） |
|---|---|---|
| **渠道价值** | 能否带来更多客户/打开一个渠道（连锁/进口商/平台卖家） | `target_customer_segment`（retailer_chain/importer 高） |
| **品牌价值** | 知名品牌背书，可做案例/引流 | 粉丝量 `instagram_followers`/`tiktok_followers`、品牌类型 |
| **增长价值** | 客户自身在高速增长 | `intent_score`、`funding_detected`、`new_products_detected` |
| **引流价值** | 拿下后能带动同类客户/口碑 | segment + 品牌影响力 |
| **长期价值** | 复购/LTV/合作纵深 | `ltv_potential_score`、复购品类、`customer_tier` A+/A |

输出 0-100，**与利润评分并列**，可解释。Strategic Value 高的客户即使当前利润薄，也值得拿下。

## B. 第四档利润率 — Strategic Margin（战略利润率）

利润率档位从三档扩为**四档**，红线关系：
```
Strategic Margin  ≤  Floor Margin  ≤  Recommended  ≤  Target
   ↑ 仅战略客户 + 老板审批可触达      ↑ 普通成交硬红线
```
- **普通客户**：报价必须 ≥ **Floor**（硬红线，引擎禁止低于）。
- **高战略价值客户**（Strategic Value ≥ 阈值，如 75）：解锁"战略报价区间"——**允许低于 Recommended、甚至低于普通 Floor，但必须 ≥ Strategic Margin**。
- 任何低于 Floor 的战略方案**强制标记「⚠ 仅老板审批后允许执行」**，进入审批流（复用现有 approvals），业务员不能自行发出。
- **低于 Strategic Margin = 永远禁止**（哪怕老板，引擎不生成；要更低需手动改 Strategic Margin 配置）。

Strategic Margin 计算：战略价值越高 → 允许牺牲越多（可逼近盈亏平衡，甚至有限度亏本引流），但有下限保护：
```
Strategic Margin = clamp( base_margin − f(StrategicValue) ,  最低保护线 ,  Floor )
StrategicValue 越高 → 扣得越多 → Strategic Margin 越低
```
策略卡上对战略客户额外显示一行：`战略底线 8%（低于普通底线 15%，需老板审批）`。

## C. Sample Strategy Engine（样品策略：免费 / 半收费 / 全收费）

由 **客户等级 × 战略价值 × 成交概率**（再叠加风险、Deal Value、防白嫖）共同决定：

| 情形 | 样品策略 |
|---|---|
| A+/高战略价值 + 成交概率高 | **免费**（投资型，主动补贴拿下战略客户） |
| 中等等级/中成交概率/Deal Value 一般 | **半收费**（收成本，运费/打样费分摊，成交后可退） |
| 低等级/低成交概率/高风险/在比价/无历史 | **全收费**（先收齐样品+运费，过滤白嫖） |

附加规则（复用 `samples`/`orders` 防滥用）：
- 历史多次取样未成交 → 强制升一档收费。
- 特殊面料/高开发成本样品 → 至少半收费。
- 战略客户的免费样品同样可触发"老板审批"（成本高时）。

输出进策略卡："**样品：免费寄送（战略投资）**" / "**样品：收成本 $X + 运费，成交后抵扣**" / "**样品：全额收费，过滤比价**" + 一句理由。

## D. CAC（获客成本）模型 —— 预留接口，当前不实现

为"真实客户价值 = LTV − CAC"打基础，**先定义接口与数据结构，暂不接入计算**：

```
CAC = 邮件成本(≈0) + 电话(时长×时薪) + 样品(成本+运费) + 差旅 + 人工时间
```
- 预留表 `acquisition_costs`（company_id · type[email|call|sample|travel|labor] · amount · hours · occurred_at）——**仅预留 schema，P2 才接入**。
- 未来用途：①真实客户价值 = 预估 LTV − 累计 CAC，喂回 Deal Value / Strategic 决策；②对"投入大但迟迟不成交"的客户预警止损；③战略客户的补贴/免费样品计入 CAC，老板审批时可见"已为该客户投入 $X"。
- 当前阶段：引擎与策略卡**预留 `cac` 字段位**（显示"获客投入：待接入"），不做实际归集。

## E. 对前述设计的影响（增量）

- **评分**：四评分 → **五评分**（+Strategic Value）。报价策略卡顶部并列显示 利润评分 与 战略价值。
- **利润率**：三档 → **四档**（+Strategic Margin），战略报价走审批流。
- **数据库**：`quote_strategies` 增 `strategic_value_score` · `strategic_margin` · `requires_owner_approval`(bool) · `sample_policy`(free|half|full) · `cac`(jsonb，预留)；新增预留表 `acquisition_costs`。
- **审批集成**：低于 Floor 的战略报价 → 复用 `approvals`，类型 `quote_strategic`，审批人=owner 角色。
- **排期**：Strategic Value + Strategic Margin + Sample Engine 进 **P0**（与四评分同批，因是核心理念）；CAC 接口表进 **P1 预留**、计算进 **P2**。
