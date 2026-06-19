# ARAOS — Strategic Account Intelligence (SAI) 设计

> 设计文档(不含实现)。目标不是"找邮箱",而是一套**长期运行的客户情报飞轮**:
> 发现 → 评估价值 → 建情报档案 → 持续找决策人 → 持续监控组织变化 → 创造接触机会 → 转 Deal。
> 原则:**复用现有 Company / Contact / Deal / customer_events / trigger_events / 海关·社媒数据 / discovery·enrich·score·tier agents,禁止推倒重来。**

> **📐 定位(资本配置语言)** —— SAI 是 **System of Allocation** 的机会层 / 组合层落地;理论本体见 [`ARAOS-system-of-allocation.md`](ARAOS-system-of-allocation.md)。本文用"飞轮/找人"的销售语言描述机制,但其本质是**为组合策展并持有资产**:
> **Prospect Vault = Portfolio(在建资产组合)· Strategic Score = 资产的风险/origination 调整价值(Value 维度代理)· Contact Hunting = Access 维度 + Emergency Hunt 动作 · Continuous Monitoring = Timing 维度(实物期权窗口)· Opportunity Alert = 时机窗口开启信号 · 找人频率档 = Action 的最小近似。**
> 本文是 SAI 的**完整长期形态**;**当前真正交付的收敛 P0 以 [`ARAOS-sai-p0.md`](ARAOS-sai-p0.md) 为准**,本文不放大 P0。

---

## 0. 结论先行(核心立意)

**问题**:系统能找到 Alo / Vuori / Fabletics / Gymshark(公司✓ 网站✓ 品牌✓),但**找不到联系人✗**,于是这些最高价值客户被丢弃。当前的 `awaiting_contact` park 只是"搁置 + 定期重找",没有**按价值决定耐心**、没有**情报积累**、没有**组织监控**。

**重构**:把"搜一次找不到就结束"改成一个**飞轮**——
```
发现客户 → AI 判断战略价值 → 进入情报池(Vault)→ 持续多源找人 + 持续监控组织变化
        → 每次新情报/新事件提高命中率 → 找到决策人 / 出现接触时机 → 转 Opportunity → Deal
```
**护城河(对外贸工厂)**:不是再造 Apollo 的人名库,而是融合 **海关进口数据(谁从谁进口、量多大、换没换供应商)+ 社媒品牌热度增速(IG/TikTok 粉丝爆发=扩张=找代工)+ 招聘信号(在招 sourcing/production=正在搭供应链)** → 算出一个**"采购就绪度 + 战略价值"**,再用**价值门控的持续耐心**长期渗透。Apollo/ZoomInfo 擅长 SaaS 销售/市场岗,**对服装品牌的 sourcing/merchandising/production 岗覆盖弱、且完全没有海关与社媒商业信号**——这就是 wedge。

SAI = 5 个引擎 + 1 个老板视图,挂在 Conversion OS 之上:
**① Prospect Vault(状态机)· ② Account Intelligence Profile(永久档案)· ③ Contact Hunting Engine(持续找人)· ④ Strategic Score(价值评分)· ⑤ Continuous Monitoring(组织监控→Alert)· ⑥ Strategic Accounts Dashboard(老板视图)**

---

## 1. 产品架构

```
                ┌──────────────── Strategic Account Intelligence ────────────────┐
 discovery ──▶  │  ④ Strategic Score ──▶ ① Prospect Vault(状态机, 价值门控)      │
 (已有)         │            ▲                    │                              │
                │            │             ┌──────┴───────┐                       │
 enrich/customs │  ② Account Intelligence  │ ③ Contact     │  ⑤ Continuous        │
 social/hiring ─┼─▶ Profile(8 域永久档案) │   Hunting     │   Monitoring         │
 (已有信号)     │     ▲  freshness/置信     │  (持续多源)   │  (每日, 组织变化)     │
                │     └───────── 情报回灌 ◀─┴──────┬───────┴──────┬───────         │
                └──────────────────────────────────┼──────────────┼───────────────┘
                                          contact_found      Opportunity Alert
                                                 │                 │
                                                 ▼                 ▼
                              ┌──────────── Conversion OS(已有)────────────┐
                              │ Deal · customer_events 时间线 · Relationship │
                              │ Band · Account Status · Outreach · Quote     │
                              └──────────────────────────────────────────────┘
```
- **新增 agents/jobs**:`hunt_contacts`(持续找人)、`monitor_account`(每日组织监控)、`score_strategic`(战略价值)。复用 worker/agent_queue/cron 基建。
- **复用**:discovery(发现)、enrich(已抓官网/Apollo/Hunter/海关)、trigger_events(已检测招聘/融资/新品)、customer_events(时间线)、refind-contacts cron(→升级为 Hunting Engine)。

---

## 2. ① Prospect Vault 状态机

账户的**战略主线**(与 Conversion OS 的 Deal stage 正交:Vault 管"从发现到产生机会",Deal 管"机会内推进")。落 `companies.vault_state`。

```
discovered → qualified → vault → contact_found → engaging → opportunity → deal → won
                  │         │          │            │            │                  ╲
                  └─────────┴──────────┴────────────┴────────────┴──────────────────▶ lost / dormant
```

| 状态 | 进入条件 | 退出条件 | 自动流转 | 人工覆盖 |
|---|---|---|---|---|
| **discovered** | discovery/手动建公司,刚入库 | 完成 enrich+score | enrich 完成→qualified 评估 | 可手动"加入战略池" |
| **qualified** | 已评分,**Strategic Score 算出** | 决定值不值得投入 | Score ≥ 阈值(按品类/产能)→ vault;< 阈值 → dormant | 老板可强制纳入(无视分数) |
| **vault** | 高价值**但无有效联系人**(= 现 awaiting_contact 升级版) | 找到有效决策人 | 触发 Hunting Engine 持续找人 + Monitoring | 手动指派负责人 / 标记暂缓 |
| **contact_found** | Hunting 命中**已验证决策人**(verified email 或可达电话) | 发起接触 | 自动建议建 Deal / 排首封触达 | 手动确认联系人质量 |
| **engaging** | 已触达且**有双向回应**(reply/会议/WhatsApp) | 形成具体机会 | 正向意图 → 建议 opportunity | 手动升级/降级 |
| **opportunity** | 已创建 **open Deal** | Deal 关闭 | 由 Deal 存在驱动(deals 表) | — |
| **deal / won / lost** | Deal 推进/成交/流失(沿用 Conversion OS) | 终态 | won→account_status 升级;lost→可回 vault 复盘 | 老板可"复活"回 vault |
| **dormant** | 价值不足 或 长期(180d)无进展无信号 | 出现新信号 | Monitoring 命中新事件 → 重新 qualified | 手动唤回 |

**关键规则**:
- **价值门控的耐心**:`vault` 里的搜索/监控强度 **= f(Strategic Score)**。Gymshark(95 分)→ 高频持续找人+全维监控,**永不丢弃**;小众无量品牌(30 分)→ 低频或直接 dormant。这就是"按价值决定投入"。
- **只前进 + 人工可任意改**:自动流转单向(discovered→…→won),`lost/dormant` 可被新信号或人工拉回。
- 现 `awaiting_contact` 即 `vault` 的特例;迁移时映射过去。

---

## 3. ② Account Intelligence Profile(永久档案)

每个战略账户一份**永久、累积、带可信度与时效**的档案。8 个情报域。

**数据模型**(复用 + 新增):
- 大量原始信号**已在** `companies`(social handles / employee_range / funding_detected / new_products_detected / hiring_signal / recruitment_signals / management_pain_signals / current_supplier_hints / source_raw.customs)与 `customer_scores`。SAI 不重存,而是**结构化materialize + 评分 + 时效 + 置信**。
- 新增 `account_intelligence`(每公司 1 行,8 个 jsonb 域 + 每域 score/confidence/updated_at/source):
```
account_intelligence
  company_id  pk/fk
  company_intel    jsonb  -- 规模/营收/成立年/总部/法人结构  | score, confidence, updated_at, sources[]
  brand_intel      jsonb  -- 品类/价位/渠道(Shopify/Amazon/TikTokShop)/品牌热度趋势
  hiring_intel     jsonb  -- 在招岗位(尤其 sourcing/production/merch)/扩张信号/招聘平台
  contact_intel    jsonb  -- 已知决策人/角色/可信度/覆盖度/缺口(缺哪个角色)
  supplier_intel   jsonb  -- 现有供应商线索/供应商数/集中度/是否多源比价
  import_intel     jsonb  -- 海关:进口量级/HS 类目/来源国/换供应商信号(ImportYeti/Panjiva)
  social_intel     jsonb  -- LinkedIn/IG/TikTok/Facebook 粉丝量+增速+商业化迹象
  news_intel       jsonb  -- 融资/获奖/开店/进入新市场/可引用的开发信钩子
  strategic_score  int    -- 缓存(见 §5)
  updated_at, refresh_due_at
-- 时序信号沿用 trigger_events / customer_events(避免新建时间序列表)
```

**每个域统一三件套**:
- **score(0-100)**:该域强度(如 import_intel.score 高=进口量大且在换供应商=机会大)。
- **confidence(0-1)**:数据可信度(来源权威性 + 多源交叉 + 新鲜度衰减)。`官网>ImportYeti>Apollo>格式推测>AI 推断`;多源一致→升;单源/过期→降。
- **updated_at + refresh_due_at**:**分域刷新节奏**——海关/招聘(高价值)30 天,社媒 14 天,公司基础信息 90 天。`monitor_account` 按 refresh_due_at 调度刷新。

**复用 ARAOS 已有**:enrich-agent 已抓官网/Apollo/Hunter/social;credit/customs 已解析海关;intent 已用招聘/融资/新品。SAI 把它们**写进 account_intelligence + 打分打置信 + 设刷新到期**,并新增"换供应商信号"等衍生。

---

## 4. ③ Contact Hunting Engine(持续找人)

**不是一次搜索,是按价值与时间升级的持续狩猎**。落 `contact_hunt_runs`(每次尝试)+ `hunt_contacts` job(cron 调度,升级自 refind-contacts)。

```
contact_hunt_runs
  id, company_id, source, ran_at, queries[], found_count, verified_count,
  result jsonb, next_run_at, strategy_version
```

**搜索来源(多源,按 ROI 排序)**:
1. **海关数据(ImportYeti/Panjiva)**★外贸独有——查到实际进口记录里的"采购联系人/收货方"。
2. **公司官网/careers 页**(已抓)、**展会名录**(Magic/ISPO/Canton)、**领英 Sales Navigator**、**Apollo / Hunter / RocketReach**、**Google/新闻**、**招聘 JD**(发岗位的 HR→反查 sourcing)、**IG/TikTok/Facebook**(品牌账号 DM/简介里的 contact、标注的买手)。

**时间升级策略(对 vault 中高分账户)**:
| 时点 | 找什么(策略随情报演进) |
|---|---|
| **Day 0 发现** | 官网 + Apollo/Hunter 按目标角色快搜;海关查现供应商与买方联系人 |
| **Day 30** | 换源 + 换角色:LinkedIn 反查 sourcing/merch;展会名录;新闻里的高管 |
| **Day 90** | 触发型:监控到"在招 sourcing"→ 反查发帖 HR→ 顺藤;社媒互动找运营 |
| **Day 180** | 深挖 + 降权:海关换季更新;若仍 0 命中且无新信号 → 降频或转 dormant(价值高则维持低频长跟) |

**角色优先级(动态)**:`采购/Sourcing > Merchandising > Production/Operations > Supply Chain > Founder/CEO`。
**动态调整**:小品牌(Founder 即买手)→ 优先 Founder/CEO;大牌(Alo/Vuori,有专门采购团队)→ 优先 Sourcing Director / VP Sourcing;命中某角色后**自动转向其上下游**(找到 buyer→找其 manager / 找 Champion+Decision Maker,喂给 Deal 的 champion/DM 字段)。

**停止/降级规则**:`找人强度 = f(Strategic Score, 已尝试次数, 是否有新监控信号)`;高分账户**不设硬停止**,只降频;低分账户 N 次无果 → dormant。

---

## 5. ④ Strategic Score(0-100,值不值得持续投入)

决定 Vault 的**纳入与耐心强度**。规则化(复用 customer_scores + account_intelligence,纯函数 + 缓存)。

| 维度 | 权重 | 来源(已有/新) |
|---|---|---|
| 品类契合(与我方产能匹配) | 18 | product_match / 工厂能力(已有) |
| 公司规模 / 营收 | 12 | employee_range / est_revenue(已有) |
| 增长速度 / 品牌热度 | 14 | 社媒粉丝增速 + 新品 + 开店(社媒/新品信号) |
| 招聘信号(尤其 sourcing/production) | 12 | recruitment_signals / hiring(已有) |
| 进口量级 / 供应链复杂度 | 16 ★ | 海关 import_intel(外贸独有, 量大=值得啃) |
| 采购团队规模 / 组织渗透潜力 | 8 | hiring + contact_intel(有专职采购=可长期渗透) |
| 换供应商信号 / 比价 | 8 ★ | 海关供应商数变化 + competition |
| 历史互动 / Deal 历史 / 关系 | 8 | customer_events 计数 + deals + relationship_band |
| 付款/合规风险(负向) | -4 | credit 评估(已有) |
| 触达可行性(有无角色缺口) | 4 | contact_intel 覆盖度 |
→ clamp 0-100。**分层**:90+ 旗舰战略客户(全力长期渗透)/ 70-89 高价值(持续)/ 50-69 机会型(常规)/ <50 dormant 候选。
**与 ICP grade 区分**:grade=画像契合(找不找);**Strategic Score = 值不值得长期投入资源持续渗透**(留不留在 Vault、给多少耐心)。

---

## 6. ⑤ Continuous Monitoring(每日,组织变化→Opportunity Alert)

`monitor_account` 每日(cron)对 vault/engaging 中**按 Strategic Score 分层抽样**的账户刷新信号,命中即生成 **Opportunity Alert**(落 `opportunity_alerts`,并写 customer_events + 可自动建任务/建议建 Deal)。

| 监控类别 | 信号 | 数据源 |
|---|---|---|
| **联系人变化** | 入职 / 离职 / 升职 / 调岗(尤其 sourcing) | LinkedIn / Apollo job-change / 招聘 |
| **公司变化** | 融资 / 裁员 / 招聘潮 / 扩张 / 新品 / 进新市场 | 新闻 / 官网 / 已有 trigger_events |
| **展会** | 即将参展 / 名录出现 | 展会名录 / 新闻 |
| **供应链/采购变化** | 新采购经理 / 新 sourcing director / 采购团队扩张 | LinkedIn + hiring |
| **进口变化** ★ | 进口量增 / **换供应商** / 新 HS 类目 | 海关 ImportYeti/Panjiva |

```
opportunity_alerts
  id, company_id, contact_id?, alert_type, severity(p1|p2|p3),
  signal jsonb, title, suggested_action, status(new|actioned|dismissed), created_at
```
**优先级规则**(severity):
- **P1(立即)**:换供应商信号 / 新 sourcing director 入职 / 大额融资 → 黄金接触窗口 → 自动建 Deal 建议 + 通知负责人。
- **P2**:在招 sourcing/production / 新品上市 / 参展 → 建跟进任务。
- **P3**:粉丝增速、普通招聘 → 仅入档案、提分。
**通知**:复用 `notify`(站内 + 老板看板红点);P1 走即时通知(邮件/IM)。**事件即接触机会**:Alert 自动附"建议话术钩子"(基于该信号),衔接 Outreach。

---

## 7. ⑥ Strategic Accounts Dashboard(老板视图,`/manager/strategic`)

CEO 关心"我们在多大程度上渗透了最值钱的客户",不是"找了多少邮箱"。
```
战略客户 Top50(按 Strategic Score)   联系人覆盖率 62%   组织渗透率 中位 1.4 人/账户
┌ 本周新增机会(Alert→Opportunity)  本周组织变化(职位变动/融资/换供应商)─────────┐
│ Vuori  换供应商信号 P1  →建议接触   |  Alo 新 VP Sourcing 入职 P1                  │
├ Top 战略客户表 ────────────────────────────────────────────────────────────────┤
│ 品牌 | Strategic | Vault 状态 | 已知决策人/缺口 | 进口量 | 潜在年额 | 负责人 | 最近变化│
│ Gymshark 95  vault(找人中) 0/需 Sourcing  大  $2M  alex  3d前在招 sourcing       │
│ Alo      92  contact_found  2人(缺DM)      大  $1.5M sam  新 VP 入职             │
├ 漏斗 & 金额 ─────────────────────────────────────────────────────────────────────┤
│ 渗透漏斗: discovered N→qualified→vault→contact_found→engaging→opportunity→deal     │
│ 潜在成交额 Σ(annual_potential)   预计转化额 Σ(deal est×win_prob)(衔接 Forecast)  │
└──────────────────────────────────────────────────────────────────────────────────┘
```
**核心指标**:战略客户 Top50、本周新增机会、**联系人覆盖率**(有≥1 验证决策人的战略账户占比)、**组织渗透率**(平均已知决策人数/账户)、最近组织变化、潜在成交额、预计转化额。

---

## 8. 与 Conversion OS 衔接

| 衔接点 | 规则 |
|---|---|
| **Vault → Deal** | `contact_found` 后,正向触达/意图 → **AI 建议建 Deal**(沿用"建议→销售确认"),Deal 创建即 vault_state=opportunity |
| **Timeline** | Hunting 命中、Monitoring Alert、档案重大更新 **全部写 customer_events**(新 event_type:`contact_found` / `org_change` / `alert`),与邮件/样品/报价同一条时间线 |
| **Relationship Band** | 沿用 P1 规则;SAI 的"会议/拜访/订单"线下事件喂入(权重已偏向线下);Vault 长期无触达=cold/dormant |
| **Account Status** | won Deal → active_customer;复购+年采购额(来自 Won 的 annual_potential)→ key/strategic_account;**与 Strategic Score 协同**(高分+成交=战略客户) |
| **Champion / Decision Maker** | Hunting 找到的关键人**直接回填 deals.champion_contact_id / decision_maker_contact_id** |

---

## 9. 数据模型小结(新增 3 表 + 1 列,其余复用)
- `companies.vault_state`(列):战略账户主线状态。
- `account_intelligence`(表):8 域永久档案 + 评分/置信/时效。
- `contact_hunt_runs`(表):持续找人审计 + 调度。
- `opportunity_alerts`(表):组织变化告警。
- **复用**:companies/contacts/customer_scores/deals/customer_events/trigger_events/agent_queue/notify;Hunting 升级自 refind-contacts cron;监控复用 trigger_events 检测器。

## 10. 页面结构
- 战略账户列表 `/strategic`(Vault 看板:按状态分组 + Strategic Score 排序 + 角色缺口标注)。
- 账户情报档案(并入客户页新 Tab「情报」):8 域卡片 + 置信/时效 + 找人进度 + Alert 流。
- 老板视图 `/manager/strategic`(§7)。
- Alert 收件箱(并入 /bd/today 或独立):组织变化 → 一键建 Deal/任务/起草。

## 11. 自动化规则(摘要)
- score_strategic 完成 → 按阈值入 vault 或 dormant。
- vault 账户:`hunt_contacts` 按 §4 时间策略 + 价值分频率持续跑。
- 每日 `monitor_account`:刷新到期的域 + 检测组织变化 → Alert(P1 通知+建 Deal 建议)。
- contact_found(验证决策人)→ 自动建议建 Deal + 回填 champion/DM。
- 全程写 customer_events;不自动发客户、不自动建 Deal(均"建议→人确认")。

## 12. 优先级
**P0 — 不再丢弃高价值无联系人客户(飞轮骨架)**
1. `companies.vault_state` + Vault 状态机(迁移 awaiting_contact→vault)。
2. **Strategic Score**(规则,复用 customer_scores+信号)→ 决定纳入与耐心。
3. **Contact Hunting Engine v1**:升级 refind-contacts 为价值分频 + 角色优先 + Day0/30/90/180 策略;`contact_hunt_runs` 审计;命中验证决策人→contact_found + 写 customer_events。
4. **Account Intelligence Profile v1**:materialize 现有信号到 `account_intelligence` + 评分/置信/刷新到期;客户页「情报」Tab。
5. 战略账户列表 `/strategic`(Vault 看板 + 角色缺口)。

**P1 — 老板管得住 + 主动监控**
6. **Continuous Monitoring + Opportunity Alerts**(组织/进口/招聘变化→Alert,P1 通知+建 Deal 建议)。
7. **Strategic Accounts Dashboard `/manager/strategic`**(覆盖率/渗透率/Top50/潜在额)。
8. Hunting 接更多源(LinkedIn/RocketReach/展会名录)、社媒/海关深度监控。

**P2 — 渗透与智能**
9. 组织图谱(多决策人渗透、关系网)、换供应商信号建模、Forecast 命中率回归、AI 话术钩子按信号生成、唤回剧本。

## 13. 风险
- **数据源成本/合规**:LinkedIn 抓取受限(用 Sales Navigator/Apollo 合规接口);海关数据(ImportYeti)有 API/抓取限额 → 按 Strategic Score 分配预算,别全量跑。
- **找人误报**:角色/邮箱错配 → 沿用 credibility 门控(只 contact_found 已验证),宁缺毋滥。
- **监控噪声**:Alert 泛滥 → 严格 severity + 只对高分账户全维监控。
- **状态轴过多**(status/account_status/deal stage/vault_state)→ 文档已明确各自职责 + 派生关系,UI 只暴露 vault_state + deal stage。
- **过度自动**:坚持"AI 建议→人确认",不自动发信/不自动建 Deal。

## 14. ROI
- **挽回被丢弃的头部客户**:Alo/Vuori/Gymshark 级账户单个潜在年采购额 $1-3M;P0 让这些不再 0 处理 → 即使转化率个位数,ROI 极高。
- **时机红利**:换供应商/新 sourcing director 是黄金窗口,Monitoring 把"碰运气"变"踩点接触" → 回复率与转化显著提升。
- **复用为主**:P0 多为编排+持久化+评分,新表仅 3 张,**开发成本低、风险低**。

## 15. 与 Apollo / ZoomInfo / Clay 的差异化
| 维度 | Apollo/ZoomInfo | Clay | **ARAOS SAI** |
|---|---|---|---|
| 定位 | 美国 B2B 人名/邮箱库,SaaS 销售为主 | 数据编排/enrichment 工作流 | **外贸工厂开发欧美品牌的战略账户情报** |
| 关键岗覆盖 | 销售/市场强,**采购/sourcing/production 弱** | 取决于接的源 | **专攻 sourcing/merch/production 决策链** |
| 海关/进口信号 | ✗ | 可接但非原生 | **✓ 原生融合(量级/换供应商=机会信号)** |
| 社媒商业信号 | 弱 | 可接 | **✓ IG/TikTok 增速=扩张=找代工** |
| 模式 | **搜一次** | 批处理编排 | **持续飞轮 + 价值门控的耐心(永不丢弃头部)** |
| 与成交打通 | 导出到 CRM | 写回 CRM | **原生衔接 Deal/Timeline/Forecast/Quote** |
| 产能匹配 | ✗ | ✗ | **✓ 按"我方工厂能做什么"算战略价值** |

**一句话**:Apollo 帮你"搜到一个人";ARAOS SAI 帮外贸工厂"长期渗透一个值钱的品牌账户,直到拿下订单"。

---

*本设计不新增对客户的自动外发、不自动建 Deal(均"AI 建议→销售确认");AI 仅用于评分、找人查询生成、信号解读、话术钩子(规则兜底)。先设计,不写代码。*
