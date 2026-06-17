# 《ARAOS 成交能力增强方案 V1》

> 阶段：0 → 1。目标：让系统持续帮 QIMO 拿到**联系人、样品、订单**。
> 暂停：多租户、Playbook 编辑器、通用化数据库重构、模板市场、SaaS 商业化。
> 每个功能必须回答：能否帮业务员"今天联系谁 / 今天发什么 / 今天跟进谁 / 今天推进哪个客户"。

---

## 1. 联系人中心设计（从"公司中心"→"联系人中心"）

**问题**：系统找到的是公司（Tentree），业务要的是人（Founder / Sourcing Director + 邮箱 + LinkedIn）。

**核心转变**：把"联系人"作为系统的一等公民。业务员打开系统第一眼看到的是**"今天该联系的人"**，而不是公司列表。

**联系人 = 一个可执行单元**，每个联系人卡片含：
- 姓名 + **角色**（按职位归类，见下）+ 所属公司 + 公司级别
- **邮箱 + 可信度档**（§2）
- LinkedIn URL + 职位
- 电话 / 微信
- **最近活跃信号**（换工作/最近发帖/公司在招人——尽力而为）
- 回复概率 + 联系状态（未联系/已联系/已回复/已退信）

**通用角色模型**（按 QIMO 优先级排序）：
```
Founder/CEO/Owner  →  Sourcing/采购  →  Product/Merchandiser  →
Production/供应链  →  Operations  →  Marketing  →  其他
```
- 系统按 `title` 自动归类到角色（关键词映射表），写入 `contacts.role`。
- 每个公司自动标出**首选决策人**（角色优先级最高 + 可信度最高的那个）。

**落地**：
- `/contacts` 升级为**联系人中心主界面**：按 角色 / 可信度 / 意图 / 状态 筛选。
- `bd/today` 顶部从"我的客户(公司)"改为**"今天联系谁"**（按 意图×级别×可信度×新鲜度 排序的人）。
- 公司详情页的联系人区：突出首选决策人 + 可信度徽章。

---

## 2. 联系方式可信度体系（Verified / Likely / Guessed）

**问题**：现在只显示"有邮箱"，业务不知道哪个值得发。

**三档可信度**（写入 `contacts.email_credibility`）：

| 档 | 判定规则（基于已有 Hunter/Apollo 信号） | 业务含义 |
|---|---|---|
| **✓ Verified** | Hunter `deliverable`，或 Apollo 已验证邮箱，或官网抓取且可达 | 放心发 |
| **~ Likely** | catch-all/accept_all/risky 但来源可信（Apollo / Hunter finder 高分 / SMTP-valid / 官网域名） | 可发，留意 |
| **? Guessed** | 纯格式推测、无验证、低置信 | 别发，先验证或换人 |

**每个邮箱同时显示三要素**：
- **来源**：Apollo / Hunter / 官网抓取 / 格式推测 / 网络检索
- **验证状态**：已验证可达 / 接收全部(catch-all) / 风险 / 未验证 / 不可达
- **风险等级**：🟢 可发 / 🟡 谨慎 / 🔴 勿发

**与发送闸门对齐**（`lib/email/resolve.ts` 已实现底层）：Verified→直接发；Likely→发但记风险；Guessed→拦截，提示"先验证或换联系人"。

**落地**：`contacts` 增 `email_credibility` 列；由现有 `email_verified/email_deliverable/email_confidence/email_source` 计算（一个纯函数 `computeCredibility()`，零额外成本）。联系人中心、作战卡、今日工作台统一用徽章展示。

---

## 3. Buying Intent Engine（采购意图引擎）—— 未来最大价值

**目标**：自动识别**哪些客户最近更可能采购**，让业务优先打"热"的。

**信号清单**（每条带权重 + 新鲜度）：
| 信号 | 来源 |
|---|---|
| 招采购/供应链/跟单/merchandiser | Serper 招聘搜索（已有 `hiring-signals.ts`/招聘 preset）|
| 招产品经理 / 扩品类 | 招聘 + 官网新品 diff |
| 新增产品线 / 上新 | 官网/电商页变化 |
| 广告投放增加 | Meta Ad Library / Serper |
| 参展（展会名单） | Serper 展会搜索 |
| 更换供应商迹象 | 海关数据变化 / 新闻 |
| 发布采购需求(RFQ) | Serper / B2B 平台 |
| 融资 / 零售扩张 | 新闻 / 已有 `trigger-detector.ts` |

**输出**：
- `intent_score`（0–10）+ `intent_signals`（带时间）+ 一句**"为什么现在该打"**
- 联系人/公司卡显示 🔥 意图徽章；今日工作台和联系人中心**按意图排序**；新增"高意图"筛选

**落地**：`companies` 增 `intent_score` / `intent_signals(jsonb)` / `intent_checked_at`。复用现有 `hiring-signals.ts` + `trigger-detector.ts`，新增一个 `IntentAgent` 聚合打分；高级别客户定期重扫（cron）。

---

## 4. 一页作战卡（One Page Battle Card，30 秒看完）

**问题**：报告太长，业务无法快速转成行动。

**7 块固定结构**：
```
[客户名]  [级别]  [🔥意图分]  [预估机会]
1. 为什么开发  — 1-2 句：匹配点 + 此刻的意图信号
2. 找谁        — 首选决策人 + 角色 + 可信度徽章
3. 联系方式    — 邮箱(档)/LinkedIn/电话/微信
4. 第一封开发信 — 已生成草稿，可直接编辑/发送
5. 下一步动作  — 样品/报价/电话（QIMO 转化动作）
6. 风险点      — 已有供应商/合规/预算
7. 成交机会    — 在哪、有多大
```
- **取代长报告作为默认视图**；长报告降为"展开详情"。
- 数据全部来自已有字段（评分/分级/联系人/意图/compose），生成一次缓存。

**落地**：`/companies/[id]` 默认渲染作战卡（或 `/companies/[id]/card`）；现有报告内容重组进 7 块。

---

## 5. LinkedIn 开发模块

**现实约束**：LinkedIn 无合规自动化 API，自动化有封号风险。→ 设计为**"AI 生成 + 人工执行 + 系统记录"**的辅助流程，而非自动发送。

**完整序列**（每步 AI 生成话术）：
1. **邀请语**（connect note，<300 字符，含个性化钩子）
2. **首次私信**（通过好友后）
3. **跟进私信 ×2**（按节奏）

**系统记录历史**：每个联系人一条 LinkedIn 时间线——步骤 + 状态（已邀请/已通过/已私信/已回复）+ 时间 + 文案。业务点"复制话术"→ 去 LinkedIn 手动发 → 回来点"已发送"标记推进。

**落地**：复用 `outreach_logs`（已有 `channel` 字段，用 `channel='linkedin'` + `step`），联系人加 `linkedin_stage`。作战卡/联系人详情加"LinkedIn 序列"面板。

---

## 6. 回复识别修复方案

**问题**：`Delivery Status Notification (Failure)`（退信）被识别为"意图不明"，且任务里显示原始 MIME 乱码。

**三件事**：
1. **退信识别**（新邮件已实现 `isBounce`）→ **补一个重处理脚本**，把库里已存在的、被误判为"意图不明/客户回复"的退信邮件重新分类：标记联系人邮箱无效、邮件状态=bounced、**从"待处理回复"里移除**。
2. **扩展回复分类**：bounce / auto_reply(自动回复) / out_of_office / unsubscribe / positive(有意向) / question(询问) / objection(异议) / not_interested。退信和自动回复**不进**"客户回复待处理"。
3. **正文清洗**：reply_body 现在塞了原始 multipart MIME → 解析出纯文本正文再存/显示（任务卡和回复箱都受益）。

**落地**：强化 `workers/reply-scanner.ts` 分类器 + 一次性重处理脚本 + MIME 正文提取函数。

---

## 7. 数据结构调整方案

| 表 | 新增/调整 | 用途 |
|---|---|---|
| `contacts` | `role`(enum)、`email_credibility`(verified/likely/guessed)、`last_active_at`、`activity_signal`(text)、`linkedin_stage` | 联系人中心 + 可信度 + 活跃信号 + LinkedIn 序列 |
| `companies` | `intent_score`(int)、`intent_signals`(jsonb)、`intent_checked_at` | Buying Intent |
| `reply_events` | 确保 `reply_intent` 支持 `bounce/auto_reply/unsubscribe`；`reply_body` 存清洗后纯文本 | 回复识别 |
| `outreach_logs` | 用 `channel='linkedin'` + `step` 记录 LinkedIn 序列（无需新表） | LinkedIn 模块 |
| `companies` | `battle_card`(jsonb，缓存生成的作战卡) | 一页作战卡 |

> 全部是**加列**，不动现有结构、不影响 QIMO 现有数据。可信度/角色可由现有字段回填计算。

---

## 8. 页面改版方案

| 页面 | 改版 |
|---|---|
| `/contacts` | **升级为联系人中心**（主界面）：今天联系谁 + 角色/可信度/意图/状态筛选 + 可信度徽章 |
| `bd/today` | 顶部改为**"今天联系谁"**（人，按意图×级别×可信度排序）；保留今日新增线索/待回复/待跟进 |
| `/companies/[id]` | 默认**一页作战卡**；长报告降为展开 |
| 公司联系人区 | 突出首选决策人 + 三档可信度 + LinkedIn 序列面板 |
| `bd/replies` / `tasks` | 退信/自动回复不再混入"客户回复"；正文显示清洗后文本 |
| 全局徽章 | 🟢🟡🔴 可信度 + 🔥 意图，统一组件 |

---

## 9. 开发排期（P0 / P1 / P2）

**P0 —— 直接回答"今天联系谁 / 该不该发"（先做）**
1. **联系方式可信度体系**（Verified/Likely/Guessed + 来源/状态/风险徽章）— 改动小、价值即时
2. **回复识别修复**（退信重处理 + 分类扩展 + MIME 正文清洗）— 止血，停止浪费
3. **联系人中心 v1**（`/contacts` 主界面 + 角色归类 + "今天联系谁" + 首选决策人）

**P1 —— 提升优先级判断与行动速度**
4. **Buying Intent Engine**（信号采集 + 意图分 + 按意图排序）
5. **一页作战卡**（取代长报告，30 秒可行动）

**P2 —— 渠道扩展**
6. **LinkedIn 开发模块**（序列话术生成 + 历史记录 + 手动执行标记）
7. **最近活跃信号**（换工作/发帖，尽力而为）

**排序逻辑**：先让业务"知道该联系谁、邮箱能不能发"（P0 联系人中心+可信度），同时"别再被退信浪费"（P0 回复修复）；再"优先打热客户、30 秒就能行动"（P1 意图+作战卡）；最后"多一个 LinkedIn 渠道"（P2）。

---

## 不做清单（本阶段）
多租户 · Playbook 编辑器 · 通用化数据库重构 · 模板市场 · SaaS 计费 · 移动端 · 复杂权限 · LinkedIn 全自动发送（封号风险）。
