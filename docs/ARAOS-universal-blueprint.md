# ARAOS → Universal Customer Acquisition OS — 审计与重构蓝图

> 定位：ARAOS 是**通用 B2B 获客操作系统**。QIMO/Jojofashion 是第一个 pilot tenant + 第一个行业模板（Activewear OEM/ODM），不是系统本身。
> 本文档是产品审计 + 重构蓝图，不含代码实现。

---

## 1. 当前被 QIMO / 服装行业写死的问题清单

按"写死深度"从浅到深排列（越往下越伤筋动骨）：

### A. 文案 / Copy（最浅，改起来快）
- 侧边栏 `app/(dashboard)/layout.tsx`：`QIMO 客户开发系统`、`QIMO · 运动服 OEM/ODM`
- `onboarding-gate.tsx` 默认卖点：`低起订量(50件/款起)`、`自有设计打版`
- Discovery presets `leads/discovery/page.tsx`：7 个预设全是服装（美国运动服品牌 / 拉美 / 亚马逊 FBA / TikTok / DTC / 国内服装外贸 / 招聘信号）
- 各页 CTA：`起草开发信`、`样品`、`报价`、`查海关数据` 等假设了"工厂卖货"动作

### B. 业务对象 / 领域名词（中等）
- `samples`（样品）、`orders`（订单）、`MOQ`、报价——假设了"制造商卖实物、走样品→订单"路径。SaaS/Agency 没有"样品"
- `lib/enrichment/customs.ts`：ImportYeti 海关数据——只对**实物进出口**有意义
- `lib/metronome/*`：推销"订单管理软件"的逻辑——QIMO 特有副线

### C. 评分模型（深）
- `agents/score/score-agent.ts` + DB 列 `customer_scores`：维度写死为 `white_label_fit`、`tiktok_fit`、`latam_priority`、`category_match`(服装品类)——这些是服装专用维度，硬编码在**数据库列**里
- `lib/scoring/domestic.ts`：国内外贸+软件客户双重评分逻辑

### D. 分级 / 可行性模型（深）
- `lib/tiering/tiering.ts`：`TierDimensions` 含 `complianceLevel`（BSCI/WRAP/SMETA/OEKO）、`recommendedFactoryType`——纯服装/制造合规概念
- `lib/factory/matcher.ts` + `lib/factory/recommend.ts`：自有工厂 vs 合作工厂匹配——制造业特有

### E. 报告 / 联系人 / 发现（深）
- `lib/reports/report-schema.ts` + `domestic-report-schema.ts`：两套服装报告结构（产品匹配、合规阻塞、工厂路由、软件演示话术）
- `agents/enrich/enrich-agent.ts` + Apollo 职位：决策人职位偏向 sourcing/product/founder（服装采购）
- `agents/discovery/filters/icp-filter.ts` / `domestic-filter.ts`：ICP 筛选词写死服装
- `lib/outreach/compose.ts`：system prompt 写死"QIMO 运动服 OEM/ODM 工厂"身份

### F. 数据库 Schema（最深，需迁移）
- `companies` 表列：`instagram_followers`、`tiktok_followers`、`shopify_detected`、`compliance_level`、`recommended_factory_type`、`product_match`、`customer_tier`、`domestic_company_type`、`software_customer_potential_score`……都是服装/制造假设
- `customer_scores` 表列：`white_label_fit`、`tiktok_fit`、`latam_priority`

---

## 2. 哪些必须抽象成配置（而非写死）

| 写死的东西 | 抽象成 | 存储位置 |
|---|---|---|
| "我们是 QIMO 运动服工厂" | **Company Profile**（我方画像） | `tenant` 表 / `company_profile` |
| 服装卖点、认证、MOQ | Company Profile 字段 | 同上 |
| Discovery 7 预设 | **Industry Playbook.discovery_queries** | `playbooks` 表 |
| 决策人职位(sourcing/product) | **Playbook.target_roles** | 同上 |
| 评分维度+权重 | **通用评分模型 + Playbook.weights** | `playbooks` + 通用 schema |
| 合规/工厂路由 | **Playbook.feasibility_module**（可选启用） | 同上 |
| 报告结构 | **通用作战卡 + Playbook 字段** | 模板化 |
| 转化动作(样品/报价/演示) | **Playbook.conversion_actions** | 同上 |
| 海关/ImportYeti | **Playbook.intelligence_sources**（可选） | 同上 |
| 侧边栏/CTA 文案 | Profile.industry + Playbook.labels | 渲染时取 |

**原则**：底层只存"通用获客对象"，行业差异全部由 **Company Profile（我是谁）× Industry Playbook（这行怎么打）** 两份配置注入。Agent/prompt 接收配置作为参数，不再内嵌行业知识。

---

## 3. 通用系统架构（两层）

```
┌─────────────────────────────────────────────────────────┐
│  TENANT（租户=一家公司，如 QIMO）                          │
│   ├─ Company Profile   我方画像（卖什么/优势/不要谁/CTA）   │
│   ├─ selected Playbook  选用的行业模板                     │
│   └─ overrides          对模板的个性化覆盖                  │
└─────────────────────────────────────────────────────────┘
                          ↓ 注入配置
┌─────────────────────────────────────────────────────────┐
│  第一层：通用获客底座（行业无关）                            │
│  Discovery → Contact Discovery → Verification → Scoring   │
│  → Intent Signals → Outreach Strategy → Message Gen       │
│  → Reply Intelligence → Follow-up → Pipeline → Dashboard  │
│  （所有 agent 接收 Profile + Playbook 作为 context）        │
└─────────────────────────────────────────────────────────┘
                          ↑ 提供行业知识
┌─────────────────────────────────────────────────────────┐
│  第二层：Industry Playbooks（行业模板库）                   │
│  Activewear OEM/ODM · Generic B2B Manufacturer · B2B SaaS │
│  每个模板=一份 JSON 配置（见 §4）                           │
└─────────────────────────────────────────────────────────┘
```

**关键改造**：现在的 agent 把行业知识写在 system prompt 和代码分支里。重构后，agent 是"执行引擎"，行业知识是"传入的数据"。一个 `score-agent` 用所有行业，差异来自传入的 `playbook.scoring_weights` 和 `profile`。

**多租户**：新增 `tenants` 表 + 所有业务表加 `tenant_id`，RLS 按 tenant 隔离。QIMO = tenant #1。（这是商业化前提，但可 P1/P2，pilot 阶段单租户先跑通配置化。）

---

## 4. 行业模板架构（Industry Playbook）

每个 Playbook = 一份版本化 JSON，字段：

```jsonc
{
  "id": "activewear_oem",
  "name": "Activewear OEM/ODM",
  "icp": {                       // 目标客户画像
    "industries": ["activewear brand", "yoga brand"],
    "geos": ["US","EU","LATAM"],
    "size_range": "DTC ~ mid-market",
    "buyer_types": ["brand","importer","retailer"],
    "exclude": ["pure low-price wholesale"]
  },
  "discovery_queries": [          // 替代写死的 7 预设
    {"label":"美国DTC运动服","query":"...","mode":"quick"}, …
  ],
  "target_roles": [               // 决策人职位优先级（见 §7）
    "Founder","Head of Sourcing","Product","Buyer"
  ],
  "product_match_logic": "我方品类 × 客户在卖的品类 的重叠度",
  "intent_signals": [             // 采购意图信号
    "hiring sourcing/merchandiser","new product line","funding","retail expansion"
  ],
  "scoring_weights": {            // 注入通用评分模型（见 §6）
    "icp_fit":0.2,"need_fit":0.15,"intent":0.15,"deal_value":0.15, …
  },
  "outreach": {                   // 开发信风格
    "tone":"professional","language":"auto","cite":["MOQ","sampling speed"],
    "banned":["GOTS/OEKO unless real"]
  },
  "common_objections": ["MOQ太高","交期","质量风险","已有供应商"],
  "follow_up_cadence": [{"day":0},{"day":4},{"day":9}],
  "conversion_actions": ["sample","quote","video_call","factory_audit"],
  "intelligence_sources": ["importyeti_customs"],   // 可选模块
  "feasibility_module": "manufacturing_compliance"   // 可选：合规/工厂；SaaS 设 null
}
```

**优雅退化**：`feasibility_module=null`、`intelligence_sources=[]`、`conversion_actions` 不含 sample 时，UI 自动隐藏"样品/海关/合规"等卡片。一套 UI，按 Playbook 显隐。

---

## 5. Company Profile 设置页设计

替代当前写死的工厂资料。任何公司可填：

| 区块 | 字段 |
|---|---|
| **我们是谁** | 公司名、一句话简介、行业（选 Playbook）、网站 |
| **我们卖什么** | 产品/服务列表（自由）、品类标签 |
| **我们的优势** | 核心卖点（多条，开发信只引用这些）、真实资质/认证（防编造） |
| **我们服务谁** | 目标行业、地区、客户规模、客户类型、采购意图 |
| **我们不要谁** | 排除条件（地区/规模/类型/价格段）——直接喂给 Discovery 过滤 |
| **价格定位** | 高端/中端/性价比；是否对外报价 |
| **成交方式** | 转化动作（样品/报价/Demo/会议/试用）——决定 CTA 与 pipeline 阶段 |
| **开发信偏好** | 语气、默认语言、是否提价格/MOQ、署名、CTA 偏好（已有，扩展） |

> 现有 `seller_profile`（onboarding）是雏形，扩展为完整 Company Profile，并把"行业=选 Playbook"作为第一步。

---

## 6. Lead Scoring 通用模型

10 个**行业无关**维度（0–10），总分 = Σ(维度 × Playbook 权重)：

| 维度 | 含义 | 权重由谁定 |
|---|---|---|
| **ICP Fit** | 是否符合我方目标客户画像 | Playbook |
| **Need Fit** | 客户当前是否需要我方产品/服务 | Playbook |
| **Buying Intent** | 采购意图信号强度（招聘/扩张/融资/换供应商） | Playbook |
| **Company Size** | 规模/采购体量 | Profile+Playbook |
| **Contact Quality** | 是否已有已验证关键人联系方式 | 通用（系统算） |
| **Channel Fit** | 我们能否触达（邮箱/LinkedIn/电话可达） | 通用 |
| **Timing** | 时机（季节/预算周期/触发事件） | Playbook |
| **Competition Difficulty** | 已有供应商/竞争激烈度（越难分越低） | Playbook |
| **Est. Deal Value** | 预估单值/LTV | Profile+Playbook |
| **Response Probability** | 历史回复率/相似客户回复率 | 通用（系统学） |

- **通用维度**（Contact Quality / Channel Fit / Response Probability）由系统统一计算。
- **行业维度**（ICP/Need/Intent/Timing/Competition/Deal Value）由 Playbook 提供评判标准 + 权重。
- 现有 `white_label_fit/tiktok_fit/latam_priority` → 收进 Playbook 的"附加信号"，不再是核心列。
- **分级（A/B/C/D）= 总分 × 通用闸门**（A 必须有已验证关键人——已实现，保留为通用规则）。"合规/工厂可行性"降级为**可选模块**，仅制造类 Playbook 启用。

---

## 7. Contact Discovery 通用模型

核心从"找公司"转向"找对的人"。定义**通用角色模型**：

```
Owner/Founder/CEO · Procurement · Sourcing · Operations ·
Marketing · Product · Engineering · Sales · HR · Finance
```

每个 Playbook 声明 `target_roles`（按优先级），Contact Discovery 按角色去 Apollo/Hunter/Serper 找人：

| 业务 | 优先角色 |
|---|---|
| OEM 工厂 | Sourcing → Product → Founder |
| B2B SaaS | CEO → Operations → Sales Manager |
| Agency | Marketing Director → Founder |
| Machinery | Plant Manager → Operations → Procurement |

- 海外：Apollo（按 title 搜）+ Hunter（邮箱）。
- 国内：Serper + 正则（已实现）。
- **联系人验证**保持通用：邮箱(Hunter)、LinkedIn、官网、社媒。
- 角色→职位关键词映射表存在系统（通用），Playbook 只选用哪些角色。

---

## 8. 一页作战卡设计（替代长报告）

通用 7 块，任何行业适用：

```
┌── [客户名]  [级别 A/B/C]  [预估单值]  [回复概率] ──┐
│ 1. 为什么开发  — 1-2 句：匹配点 + 时机信号          │
│ 2. 找谁        — 关键人 + 职位 + 已验证联系方式      │
│ 3. 用什么话术  — 切入角度 + 要强调的 1 个卖点        │
│ 4. 第一封怎么说 — 生成的开发信草稿（可编辑）         │
│ 5. 下一步      — 推荐转化动作（样品/Demo/电话）      │
│ 6. 成交机会    — 在哪、有多大                        │
│ 7. 风险        — 竞争/合规/预算/已有供应商           │
└────────────────────────────────────────────────────┘
```

- 现有"客户情报报告"内容重组进这 7 块。长报告作为"展开详情"可选。
- 块 5/6 的具体动作由 Playbook.conversion_actions 决定（服装显"样品/报价"，SaaS 显"Demo/试用"）。

---

## 9. Dashboard 通用设计（三角色）

| 角色 | 关注 | 看到 |
|---|---|---|
| **Salesperson** | 我今天做什么 | 我的客户(配额)、今日新增线索、待回复、待跟进、我的作战卡 |
| **Manager** | 团队产出与瓶颈 | 分派看板、漏斗、人均业绩、风险预警、数据质量报错 |
| **Owner** | 生意结果 | 获客成本/ROI、成交额、各 Playbook 表现、pipeline 价值、转化率趋势 |

- 角色来自 auth metadata（已有 `salesperson/sales_manager/admin`，增加 `owner`）。
- 当前 `bd/today`=salesperson、`manager/bd-dashboard`=manager 已成形；**新增 owner 视角**（生意级指标）。

---

## 10. QIMO 作为第一个模板的配置

把今天写死的一切，平移成 `activewear_oem` Playbook + QIMO Company Profile：

- **Playbook `activewear_oem`**：discovery 7 预设、target_roles=[Founder,Sourcing,Product,Buyer]、intent=[招 merchandiser/新品线/融资]、scoring_weights（含 white_label/tiktok/latam 为附加信号）、outreach（禁编造认证、提 MOQ）、conversion=[sample,quote,video_call]、intelligence=[importyeti]、feasibility_module=`manufacturing_compliance`（BSCI/WRAP/SMETA + 工厂路由）。
- **QIMO Company Profile**：运动服 OEM/ODM、品类(leggings/sports bra/seamless/yoga/athleisure)、卖点(低 MOQ/快打样/自有打版)、真实认证、目标市场(US/EU/LATAM)、排除(纯低价批发)、成交=样品→订单。
- 行为与今天**完全一致**——证明配置化没丢功能。

---

## 11. 未来 90 天路线图

**第 1 个月 — 配置化地基（不破坏 QIMO）**
- 建 `company_profile` + `playbooks` 表；把 QIMO 抽成 Profile + `activewear_oem` Playbook
- Agent/prompt 改为接收 Profile+Playbook 参数（先 compose、score、discovery）
- 通用评分模型上线，旧维度收进 Playbook

**第 2 个月 — 通用化关键路径**
- Contact Discovery 角色模型；一页作战卡替代长报告
- Discovery 预设由 Playbook 驱动；可选模块（合规/海关/样品）按 Playbook 显隐
- 出第 2、3 个模板：Generic B2B Manufacturer、B2B SaaS

**第 3 个月 — 商业化雏形**
- 多租户（tenants + tenant_id + RLS）；新建租户向导（填 Profile→选 Playbook→开跑）
- Owner dashboard；Playbook 编辑器（无需改代码加模板）
- 计量/订阅雏形（为收费做准备）

---

## 12. P0 / P1 / P2 优先级

**P0（地基，必须先做）**
1. `company_profile` + `playbooks` 数据模型
2. QIMO 抽成 Profile + activewear_oem Playbook（功能不变）
3. compose / score / discovery 三个 agent 配置化
4. 通用评分模型 + 通用分级闸门

**P1（通用化价值）**
5. Contact Discovery 角色模型
6. 一页作战卡
7. 可选模块显隐（合规/海关/样品按 Playbook）
8. 第 2、3 个模板
9. Owner dashboard

**P2（商业化）**
10. 多租户 + RLS + 新租户向导
11. Playbook 可视化编辑器
12. 计量/订阅/计费

---

## 13. 哪些功能先不要做（避免过早复杂化）

- ❌ Playbook 可视化编辑器（先用 JSON/seed，验证模型对了再做 UI）
- ❌ 全自动跨行业 Discovery（先靠 Playbook 预设词，别做"AI 自己想行业"）
- ❌ 计费/订阅（pilot 阶段不收费，模型没稳定别锁死定价）
- ❌ 深度 CRM（自定义字段、工作流引擎、报表 BI）——别和 HubSpot 拼大而全
- ❌ 多语言 UI 国际化（先中文，海外租户再说）
- ❌ 移动 App / 原生端
- ❌ 复杂权限矩阵（三角色够用）
- ❌ 把现有 `metronome` 软件副线通用化（QIMO 特例，隔离即可）

---

## 与同类产品的差异化定位

不复制 Apollo/ZoomInfo（数据库）、HubSpot/Salesforce（CRM）、Outreach/Close（序列）。
**ARAOS 的位置 = 给中小 B2B/外贸/制造商的"开箱即用获客 OS"**：用 Industry Playbook 把"找谁→找人→评分→策略→开发信→跟进"的行业 know-how 预置好，老板填一次 Company Profile、选个模板就能跑——这是 Apollo/HubSpot 不提供的"行业策略层"。护城河在 **Playbook 库 + 配置化执行引擎**，不在数据本身。
