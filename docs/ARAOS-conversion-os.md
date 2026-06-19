# ARAOS — Customer Conversion OS（设计 v2 · deal-centric）

> 设计文档（不含实现）。从"找到客户"升级为"持续推进客户直到成交"。
> 原则：复用 Companies / Contacts / Tasks / Outreach / Quote Intelligence / Buying Intent / Approvals，**禁止推倒重来**。
> v2 变更：引入 **Deal（机会）层**；关系改为**定性状态**；老板看板加 **Revenue Forecast**；Next Action **强制**；customer_events 作**统一事件总线**。

> **📐 定位(资本配置语言)** —— Conversion OS 是 **System of Allocation**(理论本体见 [`ARAOS-system-of-allocation.md`](ARAOS-system-of-allocation.md))里**资产从行权到收益**的那一段:**Deal = 行权 + 交割(origination)**——把概率化索取权转成合约现金流,不确定性在此坍缩、条款在此确定;**Revenue = 已实现现金流**(首单 = origination 完成,复购 = 红利);**customer_events 时间线 = Feedback Loop 的原始记录**("决策→结果"飞轮的底层);**Relationship Band = 收益期资产的关系状态**;**Revenue Forecast = 组合的前瞻 AUM(加权)**,是规模量纲、非北极星(北极星是 GTM 资本的 ROIC)。
> **优先级**:Conversion OS **P0(本地 commit `40a1f0c`,已验收)应先上线**,P1(Relationship Band / Risk Pool / Deal Board / Revenue Forecast)紧随——这是当前最高优先级,先于完整配置引擎。

---

## 0. 结论先行

升级为标准 CRM 三层：**Account（Company）→ Opportunity（Deal）→ Activity（customer_events）**。

- **销售阶段挂在 Deal 上,不在 Company 上**。一个客户可同时有多个机会（一个在 Sample、一个在 Quotation、一个已 Lost），互不干扰。
- **Company 层** = 关系/账户：定性关系状态（Cold/Warm/Hot/Champion/Dormant/Risk）+ 账户身份（潜在/活跃/关键客户）。
- **customer_events** = 统一事件总线：邮件/电话/WhatsApp/会议/展会/拜访/样品/报价/订单/付款/投诉/阶段变更全部沉淀,同时挂 `company_id` + `deal_id?`。
- 老板看板新增 **30/60/90 天预测订单额**（按 Deal 金额 × 阶段赢率 × 预计成交日）。
- **关键阶段不允许空 Next Action**：Deal 进入 Sample/Quotation/Negotiation/Trial Order 时,Next Action + Owner + Due 必填,否则拒绝推进。

老板打开客户页 30 秒看懂:关系状态 + 有几个在跑的机会 + 各自阶段/下一步/金额 + 时间线最近发生什么。

---

## 1. 缺口分析（关键，对照 6 点 + Deal 层）

| 方向 | 已具备 | 缺口 |
|---|---|---|
| **机会/Deal** | 无 | **完全没有 Deal/Opportunity 概念**;销售进展只能挂在 Company.status,一个客户多个并行项目无法表达 |
| 时间线 | 公司页合并邮件+回复 | 无统一事件表;离线渠道(电话/WhatsApp/会议/展会/拜访/投诉/付款)无录入;样品/订单/报价孤立成卡 |
| 销售阶段 | status 10 态 + 自动流转 + /pipeline | 阶段挂在 Company(应挂 Deal);closed_won/dormant 从不写;无 stage_entered_at(算不出停留天数);无人工改阶段 |
| 跟进 | tasks + BD 动作齐全 | next_action **只读无 setter**;非强制;无到期日(公司/Deal 层);无风险池 |
| 关系 | ICP 分(契合)、Intent 分(购买信号) | 无关系状态;且不该是算法分数,应是**销售判断的定性状态** |
| 老板视图 | 经理看板偏推进 | 无成交导向看板;**无 Revenue Forecast** |
| 复用 | 全部可复用 | — |

---

## 2. 数据结构 v2

### 2.1 `deals`（机会）— 新表 ★ 核心
销售阶段的主体。一个 Company 1→N 个 Deal。
```
deals
  id            uuid pk
  company_id    uuid -> companies(id)   (index)
  title         text     -- "Spring leggings 5000pcs" / "Sports bra 询样"
  stage         text     -- lead|contacted|replied|sample|quotation|negotiation|trial_order|won|lost
  stage_entered_at timestamptz          -- 进入当前阶段时间 → 停留天数 = now - 此值
  status        text     -- open | won | lost
  owner         text     -- 负责人(邮箱,与 companies.assigned_to 同源)
  next_action       text         -- 关键阶段强制非空
  next_action_due_at timestamptz  -- 关键阶段强制非空
  est_value_usd     numeric      -- 预估金额(可来自 quote 推荐价 × qty,或人工)
  expected_close_date date        -- 预计成交日 → Revenue Forecast 分窗
  win_prob          int           -- 赢率%,默认按 stage 推断,可人工覆盖
  product_category  text?         -- 复用 quote 品类
  qty               int?
  champion_contact_id       uuid? -> contacts(id)   -- D: 内部支持者/Champion
  decision_maker_contact_id uuid? -> contacts(id)   -- D: 决策人
  lost_reason   text?  -- B: 标 lost 时必填 → price|payment_terms|lead_time|competitor|no_response|moq|compliance|other
  annual_potential_usd numeric?   -- C: 标 won 时必填,预计年采购额(喂账户价值/key 晋级/LTV)
  created_at, updated_at, closed_at
```
阶段默认赢率(初始值,**销售可人工改**):lead 5 / contacted 10 / replied 20 / sample 30 / quotation 40 / negotiation 60 / trial_order 85 / won 100 / lost 0。
报价/样品/订单经各自 `deal_id` 回链本 Deal(见 §2.8）。

### 2.2 `customer_events`（统一事件总线）— 新表 ★
```
customer_events
  id, company_id -> companies(id) (index), deal_id uuid? -> deals(id) (index, 可空=公司级事件)
  contact_id uuid?
  event_type  text  -- email_out|email_in|whatsapp|call|meeting|exhibition|office_visit|
                    --  sample|quote|negotiation|po|payment|complaint|stage_change|note
  direction   text  -- out|in|internal
  channel     text  -- email|whatsapp|phone|in_person|system
  occurred_at timestamptz (index)
  title       text  -- 时间线主行一句话
  body        text?
  owner       text
  source      text  -- system(动作自动) | manual(人工录入)
  ref_table, ref_id  -- 回链 outreach_logs/samples/orders/quote_strategies…
  metadata    jsonb -- stage_change 存 {from,to};金额存 {amount}
```
填充:**自动埋点**(发信/收回复/样品/报价/订单/阶段变更) + **人工「记录互动」**(离线渠道) + **历史一次性回填**。

### 2.3 `companies` 增列(账户/关系层,**不再放销售阶段**)
```
relationship_band     text  -- cold|warm|hot|champion|dormant|risk  (规则判定,可人工覆盖)
relationship_band_at  timestamptz
account_status        text  -- prospect | active_customer | key_account | strategic_account
relationship_override text? -- 人工锁定的状态(优先于规则)
```
- `status`(AI 发现生命周期 raw…)**保留不动**;销售进展看 deals。
- `assigned_to`(账户负责人,邮箱)保留。
- **账户等级与 Deal 阶段完全独立**:Active / Key / Strategic 是账户身份(由 won deal + 年采购额 + 战略价值派生/人工设),**绝不进入 Deal 流程**。Deal 阶段最高到 won/lost。

### 2.4 关系状态(定性,规则判定,销售可改)
| 状态 | 判定(规则,按优先级) |
|---|---|
| **Risk** | 有 open deal 停滞超 SLA / Next Action 逾期 / 近期负向信号(原本 warm+) |
| **Dormant** | 距上次互动 > 45 天 且无推进中的 open deal |
| **Champion** | ≥1 won deal 且近期仍有往来 / 多次会议·拜访等深度触点 |
| **Hot** | open deal 在 negotiation/trial_order,或近 14 天高频双向往来 |
| **Warm** | 有双向回复,deal 处早中段,有一定近期活跃 |
| **Cold** | 仅单向触达 / 无回复 / 新客户 |
> Risk/Dormant 优先抢占展示(需要关注);其余按温度。判定来自 customer_events 计数+时效 + deals 状态。
>
> **权重(销售判断导向)**:真实业务行为 + 线下互动 **远大于** 邮件/社媒。
> 高权重:`po`(订单)、`payment`(收款)、`office_visit`(拜访)、`meeting`(会议)、`exhibition`(展会)、`sample`;
> 低权重:`email_*`、`whatsapp` 文本、社媒。例:有收款/复购/多次拜访 → Champion;只有邮件往来 → 最多 Warm。

### 2.5 Revenue Forecast(派生,不需新表)
```
对所有 open deal: weighted = est_value_usd × win_prob%
按 expected_close_date 落窗:
  forecast_30 = Σ weighted (close ≤ 30 天)
  forecast_60 = Σ weighted (close ≤ 60 天)
  forecast_90 = Σ weighted (close ≤ 90 天)
另给"承诺口径"(negotiation+ 且 win_prob≥60 的未加权合计)供保守判断。
```

### 2.6 强制门控(规则)
- **Next Action 强制**:关键阶段 = **{replied, sample, quotation, negotiation, trial_order}**(从 Replied 起)。Deal 推进进入/停留在关键阶段时,`next_action` + `owner`(对应 deal.owner) + `next_action_due_at` 三者必须非空,缺任一 → **拒绝推进**,UI 内联要求先补齐。
- **Lost 门控**(B):标 `status=lost` 时 `lost_reason` 必填(price/payment_terms/lead_time/competitor/no_response/moq/compliance/other)。
- **Won 门控**(C):标 `status=won` 时 `annual_potential_usd` 必填(预计年采购额)。

### 2.8 Deal 关联(A)
- `samples` / `orders` / `quote_strategies` 各增 `deal_id uuid? -> deals(id)`。在 Deal 上下文中创建样品/报价/订单时写入 deal_id;Deal 详情聚合展示其样品/报价/订单。
- 新建机会可由**报价/样品自动建议**(§ 自动创建:AI 建议 → 销售确认 → 创建,不全自动)。

### 2.7 复用映射(无重写)
companies/contacts/tasks/outreach/quote_strategies/intent/approvals 全保留。新增仅 `deals` + `customer_events` 两表 + companies 4 列。报价(quote_strategies)经 `deal.quote_strategy_id` 关联;样品/订单未来加 `deal_id` 可选回链。

---

## 3. UI 草图 v2(deal-centric)

### 3.1 客户页「30 秒条」
```
┌────────────────────────────────────────────────────────────────────────┐
│ Acme Activewear   关系: 🔥Hot   账户: 活跃客户   负责人 alex            │
│ 进行中机会 3 ── Leggings 5000pcs(Quotation·6天·$28k) ·                  │
│                  Sports bra 询样(Sample·2天) · Hoodie(Lost)             │
│ 最紧下一步: 7/5 发报价单(Leggings) ⏰2天    最近: 6/28 寄样 · 6/25 WA   │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 客户页：机会列表 + 统一时间线
```
【进行中机会】                                            [＋新建机会]
  Leggings 5000pcs   Quotation  停留6天  alex  $28k 40%  下一步:7/5报价 ⏰
  Sports bra 询样    Sample     停留2天  alex  —         下一步:7/3 催样品反馈
【时间线】 [全部][邮件][WhatsApp][电话][会议][样品][报价][订单][投诉][付款] [＋记录互动]
  07/05 📄报价 我们→ 发报价单 $5.86/件(Leggings机会)            alex
  06/25 💬WhatsApp 客户→ "Can you do 800pcs?"(人工录)          alex
  06/20 ✉️邮件 我们→ 首封开发信(已送达)                        system
```

### 3.3 Deal 详情页
```
Leggings 5000pcs   [Lead>Contacted>Replied>Sample>(Quotation)>Negotiation>TrialOrder>Won]
金额 $28k  赢率 40%  预计成交 7/20   负责人 alex
下一步: 7/5 发报价单 (alex)  ⏰还有2天        [推进到 Negotiation ▸]
─ 本机会时间线(events where deal_id=本机会) ─
  推进阶段时若 Next Action/Owner/Due 为空 → 弹窗要求先填,否则不允许推进
```

### 3.4 机会看板(重做 /pipeline,卡片=Deal)
```
 Lead  Contacted Replied Sample Quotation Negotiation TrialOrder  [Won] [Lost]
 [卡]   [卡]      [卡]    [卡]   [Acme- ]  [卡]        [卡]
                                 Leggings
                                 6天/$28k
 列头: 机会数 + 平均停留天数 + 加权金额;卡片可拖拽改阶段(关键阶段拖入需先填 Next Action)
 同一 Company 可在多列出现(每个 Deal 一张卡)
```

### 3.5 老板成交看板(新页 /manager/conversion)
```
 Revenue Forecast    30天 $86k   60天 $152k   90天 $240k   (承诺口径 $61k)
 本月新增机会 18  本月推进 11  停滞 7  即将成交 5  风险 6  Champion 9
┌ 即将成交(negotiation+/trial_order, 高赢率, 近期活跃) ── 预估合计 $93k ─┐
│ Acme·Leggings  Quotation→Neg  $28k 60%  alex  下一步7/5                │
├ 停滞机会(停留超SLA / 30天无互动) ──────────────────────────────────────┤
│ Beta·Set       Contacted 18天 sam  [催跟进]                            │
├ 风险(Next Action逾期/降温)  ·  Champion 客户(关系状态)  ────────────────┤
└────────────────────────────────────────────────────────────────────────┘
```

### 3.6 跟进/风险池(/bd/follow-ups 或并入 bd/today)
按 Owner 聚合:今天要做 / 本周 / 逾期 / 停滞;条目是 **Deal 的 Next Action**(+少量公司级)。

---

## 4. 实施路线图

```
P0 骨架   deals + customer_events 两表 + 自动埋点 + 回填 + 人工记录互动
          companies 关系/账户列;客户页(30秒条+机会列表+时间线);Deal 详情+阶段(自动推进+人工改);
          Next Action 强制门控;新建机会
P1 推进   关系状态(规则判定) + 风险/停滞池 + 机会看板重做 + 老板看板(含 Revenue Forecast)
P2 自动化 下一步智能建议(规则兜底) + 阶段SLA自动预警 + 订单→won/账户晋级 + 沉睡唤回 + 阶段转化/速度分析
```
节奏不变:写迁移 → 你手动应用 → validate/typecheck/build → 冒烟 → 提交(不自动 push)。

---

## 5. 优先级 P0 / P1 / P2（v2）

### P0 — 把"客户+机会"看得懂、推得动(骨架,无 AI)
1. **`deals` 表**(迁移):机会主体,阶段挂这里;一个 Company 多个 Deal。
2. **`customer_events` 表**(迁移)+ `logEvent()` 薄封装;发信/收回复/建样品/存报价/下单/阶段变更埋点;历史回填。
3. **`companies` 关系/账户列**(迁移):relationship_band / account_status / override。
4. **客户页 30 秒条 + 机会列表 + 统一时间线 + 「＋记录互动」**(离线渠道录入)。
5. **Deal 详情 + 阶段推进**(自动推进规则 + 人工改;写 stage_change 事件 + stage_entered_at)。
6. **Next Action 强制门控**:关键阶段缺 Next Action/Owner/Due → 拒绝推进(校验 + 内联补填)。
7. **新建机会**(从客户页/回复/样品快速建 Deal,可由报价/样品自动建议建 Deal)。

### P1 — 让老板管得住、抓重点
8. **关系状态**(规则判定 Cold/Warm/Hot/Champion/Dormant/Risk,可人工覆盖)。
9. **风险/停滞池**:Next Action 逾期 + 阶段超 SLA + 降温,按 Owner 聚合。
10. **机会看板重做**:阶段列 + 停留天数 + 加权金额 + 拖拽改阶段(带强制门控)。
11. **老板成交看板**:Revenue Forecast(30/60/90 加权 + 承诺口径) + 新增/推进/停滞/即将成交/风险/Champion。

### P2 — 自动化与闭环
12. 下一步**智能建议**(规则优先,复用 intent + 阶段 + 关系)。
13. 阶段 **SLA 自动预警** → 超时自动建跟进任务 / 入风险池。
14. **自动晋级**:订单交付/确认 → deal won + company account_status=active_customer;复购+金额 → key_account。
15. **沉睡唤回**:长期无互动 → dormant + 唤回剧本。
16. **速度/转化分析**:各阶段平均停留、阶段间转化率、Forecast 命中率(数据来自 stage_change 事件)。

---

## 6. 决策(v3 已锁定)
1. Deal 9 阶段;**Active / Key / Strategic 为账户身份,与 Deal 阶段完全独立**,不进入 Deal 流程。
2. est_value 默认取报价×数量,赢率按阶段默认 —— 均**可人工改**。
3. Next Action 强制**从 Replied 阶段起**(Owner + Next Action + Due,缺则不许推进)。
4. 关系权重:**线下/业务行为(订单/收款/拜访/会议/展会/样品)> 邮件/社媒**。
5. 老板成交看板**独立建 `/manager/conversion`**,不混入 dashboard。
6. Deal 创建:**AI 建议 → 销售确认 → 创建**(不全自动)。
7. (A) Deal 必关联 Samples/Quotes/Orders;(B) Lost 必填原因;(C) Won 必填年采购额;(D) Deal 含 Champion + Decision Maker。

---

## 7. P0 执行规格

### 7.1 P0 范围(纯规则 + 展示,无新 Agent / 无 AI 模型)
1. 迁移 `013_conversion_os_p0.sql`。
2. `lib/events/log.ts` — `logEvent()` 薄封装 + 事件类型常量。
3. `lib/deals/stage.ts` — 阶段顺序、默认赢率、关键阶段集合、纯函数门控 `canAdvance()/requireNextAction()`。
4. `actions/deals.ts` — createDeal / advanceDealStage(门控) / markDealWon(年采购额必填) / markDealLost(原因必填) / setDealNextAction / updateDeal(金额/成交日/赢率/champion/DM) / linkArtifact(样品·报价·订单)。
5. **埋点**:发信 / 收回复 / 建样品 / 存报价快照 / 下单 / 阶段变更 → `logEvent()`(不改业务逻辑,仅追加写)。
6. **历史回填**脚本:从 outreach_logs / reply_events / samples / orders / quote_strategies 倒灌事件(幂等)。
7. **Deal 自动建议**:正向回复 / 建样品 / 存报价 且无 open deal → 客户页提示"建议建机会",销售点确认才创建。
8. **客户页**:30 秒条 + 机会列表 + 统一时间线(替换原「沟通记录」)+ 「＋记录互动」(离线渠道)。
9. **Deal 详情页**:阶段条(自动推进 + 人工改,带门控)+ Next Action + 金额/成交日/赢率/Champion/DM + Won/Lost(带门控)+ 本机会时间线 + 关联样品/报价/订单。

### 7.2 迁移方案 — `supabase/migrations/013_conversion_os_p0.sql`(你手动在 Supabase SQL Editor 应用,幂等)
```sql
create table if not exists deals (...§2.1 全字段...);                 -- 机会
create table if not exists customer_events (...§2.2 全字段...);        -- 事件总线
alter table companies
  add column if not exists relationship_band text,
  add column if not exists relationship_band_at timestamptz,
  add column if not exists account_status text default 'prospect',
  add column if not exists relationship_override text;
alter table samples          add column if not exists deal_id uuid references deals(id);
alter table orders           add column if not exists deal_id uuid references deals(id);
alter table quote_strategies add column if not exists deal_id uuid references deals(id);
create index if not exists idx_deals_company   on deals(company_id);
create index if not exists idx_deals_open_stage on deals(stage) where status='open';
create index if not exists idx_events_company  on customer_events(company_id, occurred_at desc);
create index if not exists idx_events_deal     on customer_events(deal_id);
-- VERIFY: select count(*) of new tables/columns
```

### 7.3 页面 / 文件改动点
**新增**
| 文件 | 作用 |
|---|---|
| `supabase/migrations/013_conversion_os_p0.sql` | 迁移 |
| `lib/events/log.ts` | `logEvent()` + EVENT_TYPES |
| `lib/deals/stage.ts` | 阶段序/默认赢率/关键阶段/门控纯函数 |
| `actions/deals.ts` | Deal 全部 server actions |
| `components/conversion/timeline-feed.tsx` | 统一时间线 + 「记录互动」(客户端表单/复制) |
| `components/conversion/deal-list.tsx`、`deal-stage-bar.tsx` | 机会列表 / 阶段条 |
| `app/(dashboard)/deals/[id]/page.tsx` | Deal 详情页 |
| `scripts/backfill-events.ts` | 历史事件回填 |
| `scripts/validate-conversion.ts` | 验收脚本 |
| `types/index.ts`(改) | Deal/DealStage/CustomerEvent/EventType/LostReason/AccountStatus/RelationshipBand 类型 |
**编辑**
| 文件 | 改动 |
|---|---|
| `app/(dashboard)/companies/[id]/page.tsx` | 顶部 30 秒条 + 机会列表区 + 统一时间线区(替换原沟通记录) |
| `agents/email/send-email-agent.ts` | 发送成功 → logEvent(email_out) |
| `workers/reply-scanner.ts` | 入库回复 → logEvent(email_in);正向回复 → Deal 建议 |
| `actions/samples.ts` | 建样品 → logEvent(sample) + 关联 deal_id |
| `actions/quote.ts`(triggerQuoteStrategy) | 存快照 → logEvent(quote) + 关联 deal_id |
| `actions/orders.ts` | 下单 → logEvent(po) + 关联 deal_id |
| `package.json` | + `"validate:conversion"` |
> 不改 scoring / tiering / quote 引擎逻辑;只追加事件写入与关联。

### 7.4 验收标准
- **迁移**:013 schema 校验通过;**typecheck / build 绿**。
- **单元**(`validate-conversion.ts`):
  - 阶段门控:replied/sample/quotation/negotiation/trial_order 缺 Next Action/Owner/Due → `advanceDealStage` 拒绝;补齐后放行。
  - Lost 门控:`markDealLost` 无 `lost_reason` → 拒绝。 Won 门控:`markDealWon` 无 `annual_potential_usd` → 拒绝。
  - 赢率:默认按阶段、人工覆盖生效。
  - 事件:`logEvent` 写入;时间线按 `occurred_at` 排序;可按 `deal_id` 过滤。
  - 解耦:改 deal 阶段不影响 `companies.account_status`。
- **场景(3 个 fixture)**:
  - A 全程:建 Deal → contacted→replied(补 Next Action 才过)→sample→quotation→negotiation→trial_order→**won(填年采购额)**,事件流完整。
  - B 流失:建 Deal → 中途 **markDealLost(原因=competitor)** → 看板进 Lost。
  - C 并行:一个 Company **两个并行 Deal**(Sample + Quotation),客户页机会列表/时间线/30 秒条均正确。
- **UI 冒烟(本地登录)**:客户页 30 秒条 + 机会列表 + 时间线渲染;「记录互动」录一条 WhatsApp → 出现在时间线;Deal 详情推进被门控拦截(缺 Next Action);AI 建议→确认建 Deal;关联样品/报价显示在 Deal 下。

---

*本期 P0/P1 不新增 Agent、不新增 AI(纯规则 + 展示);AI 仅 P2 的"下一步建议"以规则兜底形式出现。Deal 自动建议是规则触发 + 人工确认,不算新 AI 能力。*
