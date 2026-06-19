# SAI P0 — 收敛规格(Prospect Vault + Strategic Score + Contact Hunting)

> 产品规格(不含代码、不含 migration、不进入实施)。把 Strategic Account Intelligence 压缩成 **2-3 周可交付、真正止血** 的最小版本。
> **一句话**:高价值客户**不因暂时没有联系人而丢失**。
> **设计支点(最大复用)**:现有 `awaiting_contact` park + `refind-contacts` cron 已是 Vault 与"持续找人"的雏形——P0 只给它装上"按价值决定耐心"的大脑(Strategic Score),不造新系统。

> **📐 定位(资本配置语言)** —— 这是 **System of Allocation**(理论本体见 [`ARAOS-system-of-allocation.md`](ARAOS-system-of-allocation.md))的**最小可用骨架**,即"轻量 **Vault(Portfolio)+ Strategic Value + Access + Timing** 的最小闭环",**不是**完整 Allocation Engine。本 P0 **刻意排除**:完整最优化求解、影子价格、多维预算优化、预测/ROIC 模型、跨租户学习——全部后置到长期愿景。本 P0 的职责仅是:**看得懂资产价值、按价值分配 origination 耐心、把"决策→结果"沉淀下来**,先跑通、先产生业务价值。**P0 范围以本文为准,不被理论放大。**

---

## 1. P0 目标
把当前"**无差别地把无联系人客户搁置在 `awaiting_contact`,定期盲目重找**"升级为:
```
高价值无联系人客户 → 进入情报池(Vault)→ 按价值分配找人频率(每天/每周/每月)
                  → 持续多角度找人 → 找到验证决策人 → 交回成交流程
                  → 价值不足/长期无果 → 放弃(dormant)
```
**只解决这一个问题。** Gymshark / Vuori / Alo 这类"公司✓网站✓品牌✓ 但联系人✗"的客户,从此**有人持续负责地找、且按价值排优先级**,不再静默丢失。

---

## 2. P0 边界

**只允许包含**:
1. **Prospect Vault**(复用 `awaiting_contact`,加价值门控)
2. **Strategic Score**(纯函数,复用现有评分,决定找人频率)
3. **Contact Hunting cadence**(升级 `refind-contacts` cron,复用 `enrich` + Apollo/Hunter)

**明确排除(全部不进 P0)**:
组织图谱 · AI 自动话术 · Revenue Forecast · Opportunity Alerts · 监控中心 · 老板战略驾驶舱 · Forecast 命中率 · 组织渗透分析 · 高级社媒分析 · 自动 Deal 创建 · 自动销售动作 · **任何新 Agent 体系** · **任何新 AI 能力** · `account_intelligence` 表 · `opportunity_alerts` 表 · `contact_hunt_runs` 表。

---

## 3. 状态机(复用现有 `companies.status`,**0 个新状态列**)

Vault 是对现有 `status` 的**解释 + 价值门控**,不引入第 4 条状态轴:

```
        score/tier 完成
discovered ──▶ candidate ──┬── 有有效联系人 ──▶ (正常成交流程, 离开 Vault)
 (status raw/             │
  enriched)   status=     │── 无有效联系人 + Strategic≥40 ──▶  VAULT   ──持续找人──┐
              'scored'     │                                  status=             │
                          │                                  'awaiting_contact'   │
                          └── 无有效联系人 + Strategic<40 ──▶  ABANDONED            │
                                                              status='dormant'    │
   ┌──────────── 找到验证决策人(verified email/可达电话)──────────────────────────┘
   ▼
EXITED(success): status 离开 awaiting_contact(现有 enrich→score→tier 流程自然完成)→ 交回 Conversion OS
```

| 状态(=现有字段) | 进入条件 | 退出条件 | 自动流转 | 人工干预 |
|---|---|---|---|---|
| **candidate**(`status='scored'`) | 评分完成 | 算出 Strategic Score | Score≥40 且无有效联系人→VAULT;<40→ABANDONED;有联系人→正常流程 | 老板可强制纳入 Vault(置 Strategic 下限) |
| **VAULT**(`status='awaiting_contact'`) | 高价值 + 无有效联系人 | 找到验证决策人 / 被放弃 | Hunting cron 按 Score 频率持续找;命中→离开;久无果→ABANDONED | 指派负责人 / 立即找一次 / 调 Score / 移出 |
| **EXITED success** | Hunting 命中验证联系人 | — | 现有 contact-gate 不再 park,status 进入 outreach/正常 | 手动确认联系人质量 |
| **ABANDONED**(`status='dormant'`) | Strategic<40 或 找人 N 次且 180 天无果无新信号 | 出现新信号/人工唤回 | 现有 trigger/enrich 检到新信号→回 candidate 重评 | 手动唤回(回 Vault) |

> 复用要点:`awaiting_contact`(已存在,现就是"无联系人 park")= Vault;`dormant`(枚举已存在但从未使用)= Abandoned。**不新增 vault_state 列。**

---

## 4. 数据结构(规格;**0 新表,最小新增列;本期不建 migration**)

**0 个新表。** `companies` 增 4 列(后续由你应用迁移,本期只设计):
```
strategic_score      int          -- 0-100,决定找人频率(纯函数算)
strategic_score_at   timestamptz  -- 评分/入池时间(兼作 Vault 进入时间→推算 Day0/30/90/180 阶段)
next_hunt_at         timestamptz  -- 下次找人时间(cron 据此调度)
hunt_attempts        int default 0 -- 已找人次数(配合阶段策略 + 放弃规则)
```
**复用(不新增)**:
- `status`(`awaiting_contact`=Vault / `dormant`=Abandoned / 其余=已退出)
- `customer_events`(每次找人写一条 `event_type='note'`:"持续找人 第N次 · 目标 Sourcing";找到写 `'note'`:"找到决策人 Jordan(Sourcing)")——**找人审计用它,不建 contact_hunt_runs 表**
- `contacts` + `lib/contacts/readiness`(判定"有效联系人"=退出条件,已存在)
- `customer_scores` / `total_score` / `product_match_score` / 招聘·融资·新品信号 / 海关 source_raw(Strategic Score 的输入,**全部已有**)

---

## 5. 页面结构(**1 个新页 + 客户页小改**)

**新增 `/strategic`(Vault 清单 — 唯一新页)**:
```
战略客户情报池(Vault) — 按 Strategic Score 排序                    [仅看我的负责]
品牌 | Strategic | 频率 | 已找N次 | 角色缺口 | 下次找人 | 最近尝试 | 负责人 | 操作
Gymshark  92  每天  4次  缺 Sourcing   今天   3d前查Apollo  alex  [立即找][放弃][调分]
Vuori     78  每周  2次  缺 Sourcing   2d后   …            sam   …
Alo       61  每月  6次  缺 DM         12d后  …            —     [指派给我]
```
**客户页(复用现有,小改)**:把现有的 `awaiting_contact` 黄条升级为「⏳ 情报池 · Strategic 92 · 每天找人 · 已找4次 · 缺 Sourcing · 下次今天 [立即找]」,并在 30 秒条显示 Strategic Score。

**0 其他新页**(无老板看板、无监控中心、无 Alert 收件箱)。

---

## 6. 自动化规则

1. **入池**:`score_company`/`tier` 完成后(复用现有 enqueue 点)→ 算 `strategic_score`(纯函数)→
   - 无有效联系人 且 Score≥40 → `status='awaiting_contact'` + `next_hunt_at`=now + 频率(见 §Score 频率表);
   - 无有效联系人 且 Score<40 → `status='dormant'`;
   - 有有效联系人 → 不变(正常流程)。
2. **持续找人**(升级现有 `/api/cron/refind-contacts`,**不是新 agent**):每跑一次,取 `status='awaiting_contact' AND next_hunt_at≤now` 按 `strategic_score DESC` 限批 →
   - `enqueue('enrich_company', {companyId, huntPhase, roleTarget})`(复用现有 enrich job;`roleTarget` 由阶段决定,enrich 用它优先 Apollo 该角色——**小增强,非新能力**);
   - `hunt_attempts+1`、`next_hunt_at = now + 频率间隔`、写 `customer_events`。
3. **退出成功**:enrich 找到验证联系人 → 现有 contact-gate 不再 park,`status` 进入正常 → 写事件"找到决策人"。
4. **放弃**:`hunt_attempts ≥ 上限` 且 `Strategic<40 或 距 strategic_score_at>180天且无新 trigger` → `status='dormant'`。
5. **刷新**:enrich/score 刷新底层信号时重算 strategic_score(复用现有刷新点)。
6. **人工**:加入/移出 Vault、设 Score 下限(老板强制纳入)、立即找一次、放弃、唤回。
> 全程**不自动发客户、不自动建 Deal**;找到联系人后是"建议接触",由现有流程/人决定。

---

## 7. 实施清单(规格;实现时再做,本期不写)

| # | 项 | 复用/新增 |
|---|---|---|
| 1 | `companies` 加 4 列 + 索引(`next_hunt_at` where awaiting_contact) | 迁移(后续) |
| 2 | `lib/strategic/score.ts` — 纯函数:Strategic Score + 频率档(daily/weekly/monthly/abandon)+ 解释 | 新(纯) |
| 3 | `lib/strategic/hunt.ts` — 纯函数:阶段(Day0/30/90/180)→ roleTarget/source、按 Score 的频率间隔、放弃判定 | 新(纯) |
| 4 | 入池 hook:`score-agent`/`tiering` 完成后算分 + 设 vault/dormant + next_hunt_at | 改现有(在已有 enqueue 处) |
| 5 | 升级 `/api/cron/refind-contacts`:Score 排序 + 频率调度 + roleTarget 提示 + attempts/event | 改现有 cron(非新 agent) |
| 6 | `enrich-agent`:接受可选 `roleTarget`,优先 Apollo 该角色搜索 | 小增强(非新能力) |
| 7 | 新页 `/strategic`(Vault 清单)+ 客户页黄条升级 + 30 秒条加 Strategic | 1 新页 + 改现有页 |
| 8 | `scripts/validate-strategic.ts` + `package.json` 加 `validate:strategic` | 新(纯单元) |

### Strategic Score 模型(最小,全部复用已有数据)
| 维度 | 权重 | 来源(已有) |
|---|---|---|
| ICP 价值(品牌/规模/营收) | 0.35 | `total_score`(0-100) |
| 品类契合(我方能做) | 0.25 | `product_match_score`×10 |
| 采购就绪信号 | 0.25 | 在招 sourcing/production +、新品 +、融资 +、`intent_score` |
| 进口/供应链规模 | 0.15 | 海关 `source_raw.customs` / `current_supplier_hints` 数 |
→ clamp 0-100。**频率表**:≥75 **每天** / 55-74 **每周** / 40-54 **每月** / <40 **放弃(dormant)**。
**刷新周期**:底层信号刷新时重算(复用现有 enrich/score 触发);每次 hunt cron tick 也廉价重算。
**解释机制**:存一句话理由(如"ICP 92 + 在招 Sourcing + 海关进口量大 → 每天找"),客户页/Vault 页可见。
> 与 ICP grade 区分:grade=找不找;**Strategic Score=值不值得每天持续找**。

### Hunting 阶段策略(对单个 Vault 账户,按距 `strategic_score_at` 的天数)
| 阶段 | roleTarget / source(复用 enrich 现有 Apollo/Hunter/官网/Serper) |
|---|---|
| **Day 0** | 官网 + Apollo(Sourcing)+ Hunter 域名 |
| **Day 30** | 换角色:Apollo(Merchandising/Operations)+ 重抓 careers 页 |
| **Day 90** | Apollo(Founder/CEO)+ 新闻检索(已有 Serper) |
| **Day 180** | 低频维持;仍 0 命中且无新信号 → 放弃 |
> P0 **只用 enrich 已接的源**(Apollo/Hunter/Serper/官网)。LinkedIn/RocketReach/展会名录 = P1。

---

## 8. 验收标准
- **迁移**(后续应用后):schema 校验通过;**typecheck / build 绿**。
- **单元**(`validate:strategic`,纯函数,无 DB):Strategic Score 计算 + 频率分档(75/55/40 边界)+ 阶段→roleTarget(Day0/30/90/180)+ 放弃判定。
- **3 场景**:① 高价值无联系人 → 入 Vault、按频率排了 next_hunt;② 低价值无联系人 → dormant;③ 找到验证联系人 → 离开 Vault、写"找到决策人"事件。
- **UI 冒烟**:`/strategic` 显示 Vault(按 Score 排序、角色缺口、下次找人);客户页显示 Strategic Score + 持续找人状态;「立即找一次」入队 enrich。
- **cron 行为**:跑一次 → 高分账户被取出、enqueue enrich、attempts+1、next_hunt 前移、写事件。

---

## 9. 风险
- **数据源额度/成本**:Apollo/Hunter 有限额 → **频率按 Score 分配**,只对高分账户每天找,低分降频/放弃,天然控成本。
- **找人误报**:沿用 `readiness`/credibility 门控,**只在"验证联系人"时退出 Vault**,宁缺毋滥。
- **状态轴复用 `status`**:vault=awaiting_contact、abandoned=dormant 是复用而非新增,**文档已明确映射**;UI 只暴露"情报池/已放弃"。
- **enrich 改动面**:只加一个**可选** `roleTarget`,不传则同现状 → 风险极小。
- **过度找人**:`hunt_attempts` 上限 + 放弃规则兜底。

---

## 10. ROI
- **开发量(2-3 周可完成)**:**0 新表**、4 个字段、2 个纯函数 lib、1 个 cron 升级、1 个新页 + 客户页小改、1 个验证脚本。绝大部分是**复用 enrich/Apollo/cron + 重新调度**。
- **风险**:低(复用为主,无新 Agent/无新 AI/无自动外发)。
- **解决的真实问题**:**头部品牌账户(Alo/Vuori/Gymshark,单个潜在年采购额 $1-3M)不再静默丢失**,且按价值持续踩点找人——这是当前最大的"出血点"。
- **为什么应优先于完整 SAI**:
  1. **单点止血**:直接堵住"高价值客户因无联系人被丢弃",立刻产生业务价值;
  2. **低成本验证闭环**:用最小代价验证"Vault + 价值分频 + 持续找人"这个核心飞轮是否真带来联系人/机会;
  3. **避免超级集合体风险**:把 monitoring/profile/dashboard/forecast 这些重而不紧急的能力**全部后置**,等 P0 数据证明 ROI 再决定要不要做;
  4. **可独立交付**:不依赖任何被排除的能力,2-3 周一个完整、可上线、可度量的版本。

---

*P0 不新增 Agent、不新增 AI、不自动外发、不自动建 Deal;Strategic Score 与 Hunting 调度均为规则/纯函数。本文件为产品规格,不含代码与 migration。*
