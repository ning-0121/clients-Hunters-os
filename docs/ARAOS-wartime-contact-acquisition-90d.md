# ARAOS 战时模式 — 90 天客户开发作战计划

> 视角:6000 万运动服 ODM 工厂增长负责人。唯一问题:**这件事未来 90 天能不能直接带来更多客户/联系人/报价/订单?** 不能→立即降级。
> 不写代码、不谈五年架构、不谈平台愿景。只排序"影响力 × 实施成本"。

---

## 0. 增长负责人的诚实校准(先对齐指标)

6000 万 → 1.5 亿(2.5×)**90 天内"已成交收入"翻 2.5 倍不现实**——服装首单周期=接触→样品→报价→订单常 2-4 个月,复购更久。
**90 天能真正撬动的是先行指标(它们 3-9 个月后变成收入)**:

| 滞后指标(别用它考核 90 天) | **先行指标(90 天作战目标)** |
|---|---|
| 已成交收入 | **A 级客户可达决策人覆盖率 0-20% → 80%** |
| | **每周发出的报价数 / 样品数** |
| | **新建机会(Deal)数 / 进入谈判数** |
| | **双向回复率(reply rate)** |

**作战公式**:更多 A 级可达决策人 → 更多对话 → 更多报价/样品 → 更多订单。**90 天死磕漏斗最上游两环:够到人 + 推对产品开口。** 这正是 Task 1-3 的指向。

---

## 1. Task 1 — Contact Intelligence V2(把 A 级覆盖率干到 80%)

**现状诊断(本会话实测)**:Apollo 能找到对的人(Supply Chain Mgr/Buyer),但 **Google Workspace catch-all 域名让 SMTP 验不出邮箱**;RocketReach/GitHub 已写好代码但**没配 key**;LinkedIn 仅靠 Apollo/X-Ray 间接拿到 URL。
**真瓶颈不是"找不到人",是"找到人但没有可达通道"。** → 三条线同时打:多源找邮箱 + 抗 catch-all 验证 + **非邮箱通道(LinkedIn/手机)**。

### 1a. 发现工具 ROI 排序(接哪个、不接哪个)

| 排序 | 工具 | 它解决什么 | 成本/接入 | 判定 |
|---|---|---|---|---|
| **1** | **BetterContact / FullEnrich**(邮箱瀑布聚合) | **一个 API 串 15-20 家提供商 + 返回已验证邮箱** —— 直接破"单源 + catch-all";替换/增强现有 Hunter+SMTP 步 | 低(1 个 API,按量付费) | ✅ **最高 ROI,立即接** |
| **2** | **RocketReach**(已写代码) | 多一个人物库源 | **~0 构建,只需配 key** | ✅ **本周开,零成本** |
| **3** | **ContactOut / Kaspr**(手机 + 个人邮箱 + LinkedIn) | **非邮箱通道**:catch-all 账户用手机/LinkedIn 触达;手机回复率高 | 中 | ✅ 接 1 个(A 级专用) |
| 4 | People Data Labs | 海量人物/公司库,批量富集广度 | 中-高(原始数据需加工) | ◔ 规模化时再说(P1) |
| 5 | Clay | GTM 编排平台(自己跑瀑布) | 高(平台/学习曲线) | ◔ buy-vs-build;我们已有瀑布 → 暂不 |
| 6 | Prospeo / Datagma / LeadMagic | 单点邮箱/手机 | 低 | ✖ **与瀑布聚合重复,接了聚合就不必单接** |
| 7 | GitHub | 技术/数字团队 | 已写代码 | ✖ **服装采购买手不在 GitHub** → 不投入 |

**结论**:**接 ① 邮箱瀑布聚合 + ② RocketReach(配 key)+ ③ 一个手机/LinkedIn 源**,即可覆盖绝大多数 A 级。其余先不接(避免重复集成与浪费)。

### 1b. 验证四层重设计(主攻 catch-all)

四层保留 **Verified / Trusted / Probable / Guessed**,但破 catch-all:
- **Verified**:SMTP 确认 **或 瀑布聚合返回 valid 或 Hunter valid**(不再只靠 SMTP)。
- **Trusted**:人物库源(Apollo/RocketReach/ContactOut)——已实现,**对 catch-all 账户这就是可用层**。
- **关键决策(catch-all 专项)**:Google Workspace catch-all 下 SMTP 永远测不准 → **不再以 SMTP 为准**:① 用聚合器的多源一致性(2 个独立源给同一地址)判 Verified;② **A 级账户**对"Trusted + 公司主域 + 邮箱格式一致"**放行首封低风险开发信**(接受可控退信),或 ③ **直接走 LinkedIn/手机**。
- 即:**catch-all 不再是死路** —— 要么多源互证、要么换通道。

### 1c. Coverage / Reachability V2(别只看邮箱)

**Reachability = 任一通道可达**:已验证/可信邮箱 **OR** LinkedIn(有 profile + 可发起连接/InMail)**OR** 手机/WhatsApp。
→ **一个只有 LinkedIn URL、没邮箱的人,也算"LinkedIn 可达"** —— 这一条就能让 catch-all 账户的有效覆盖率暴涨(Apollo 本就给 LinkedIn URL)。

- **Access Score V2**:三通道加权(邮箱/LinkedIn/手机);**多线程**(≥2 可达联系人)加分。
- **Decision-Maker Coverage**:是否已有**可达的目标角色**(Founder/Owner/CEO/VP Sourcing/Head of Product/PD Mgr/Sourcing Mgr/Supply Chain Mgr/Buyer)。
- **Champion Coverage**:可达且有回应的支持者。
- **Multi-thread Coverage**:≥2 可达人,避免单点。
- **80% 目标定义**:A 级账户中,**拥有 ≥1 个 Verified/Trusted 邮箱 或 LinkedIn 可达 的目标角色** 的占比 ≥ 80%。

---

## 2. Task 2 — Relationship Intelligence(把人情/软信号变成公司资产)

**为什么 90 天有用**:够到人之后,**赢单靠关系**。Lisa 的例子(旧厂交期问题/与老板争执/对付款敏感/对中国团队信任下降/对新厂存疑)——这些是赢单的关键,却锁在业务员脑子里,**人一走就归零**。把它制度化 = 直接提升转化与复购,且抗人员流失。

**每个客户记录(业务员录入,不由 AI 编造——软信号必须是"观察到的事实")**:
- **决策图**:谁真决策 / 谁影响 / 谁执行 / 谁支持我们 / 谁反对我们(标在联系人上)。
- **关系画像**:偏好 · 性格 · 雷区 · 付款习惯 · 沟通风格 · 风险等级 · 关系强度。
- **历史事件**:复用已有 customer_events 时间线(交期投诉/争执/换厂犹豫…)。

**90 天落地方式(低成本高杠杆)**:客户页加一个**「关系画像」快录卡**(下拉 + 自由备注)+ 在 Brief 顶部**显示支持者/反对者/雷区/付款习惯**。不做复杂 NLP,先让业务员**5 秒能记、打开能看**。这是institutional memory 的起点。

---

## 3. Task 3 — Customer Intelligence Brief V2(30 秒可行动)

**好消息:Brief P0 已基本满足**——已有 30 秒决策卡、客户类型、切入策略、产品契合、下一步动作,且**决策链从不死板**:找不到采购人时已输出 **"下一步应寻找 Product Development Manager"**(recommendedNextContact),不会再出现"采购负责人未找到"。

**V2 战时增量(都在已建之上,低成本)**:
1. **接 Contact V2 的 Reachability**:决策卡顶部显示"可达状态 + 缺哪个角色 + 下一个该找谁 + 走哪个通道(邮箱/LinkedIn/手机)"。
2. **接 Relationship Intelligence**:决策卡显示支持者/反对者/雷区/付款。
3. **死保 30 秒五问**:① 值不值得做 ② 谁该联系(可达通道)③ 怎么切入 ④ 推什么产品 ⑤ 下一步干什么——全部已有,V2 只是把"谁该联系"升级为"可达的谁 + 怎么够到"。
4. **先发货**:Brief P0 已验收但**未上线**——上线本身就是 90 天最快的销售提效。

---

## 4. 90 天作战排序(影响力 × 实施成本)

| 优先 | 行动 | 影响力 | 成本 | 净 ROI |
|---|---|---|---|---|
| **🔥 本周** | **上线已验收的 Brief P0**(让业务员今天就用) | 高 | 极低 | ★★★★★ |
| **🔥 本周** | **配 RocketReach key**(代码已就绪) | 中高 | ~0 | ★★★★★ |
| **🔥 本周** | **Reachability V2 = 邮箱 OR LinkedIn OR 手机**(LinkedIn-only 也算可达) | **极高(直接抬覆盖率)** | 低 | ★★★★★ |
| **第 2-3 周** | **接邮箱瀑布聚合(BetterContact/FullEnrich)** 破 catch-all | **极高(find+verify 命中率)** | 低 | ★★★★★ |
| **第 2-3 周** | **catch-all 验证策略**(多源互证 + A 级放行首封 / 换通道) | 高 | 低 | ★★★★☆ |
| **第 3-4 周** | **关系画像快录 + Brief 显示**(支持者/反对者/雷区/付款) | 高(转化+复购+抗流失) | 中 | ★★★★☆ |
| **第 4-6 周** | **接一个手机/LinkedIn 源(ContactOut/Kaspr)** A 级专用 | 高(catch-all 账户) | 中 | ★★★☆☆ |
| 验证后 | Access/Coverage/Multi-thread V2 指标看板 | 中 | 低 | ★★★☆☆ |
| **不做** | Prospeo/Datagma/LeadMagic 单接 · GitHub · Clay 平台 · People Data Labs | — | — | 重复/错配/过早 |

**禁止提前**:Product DNA · Winning Intelligence · Product Graph · Strategy Engine(P2,与 90 天获客无关)。

---

## 5. 30 / 60 / 90 天里程碑

- **Day 30**:Brief P0 上线 + RocketReach 开 + Reachability V2(三通道)+ 邮箱瀑布聚合接入 → **A 级覆盖率 20% → 50%+**,报价/样品周产出可计量。
- **Day 60**:catch-all 策略 + 关系画像 + 手机/LinkedIn 源 → **A 级覆盖率 → 80%**,多线程覆盖 + 关系画像驱动转化。
- **Day 90**:覆盖率稳 80%,回复率/报价数/样品数/新建机会数较起点 **3-5×**;前期 A 级机会开始进入样品/报价/谈判——为后续季度的收入翻番蓄满管道。

---

## 关键判断(增长负责人版)

1. **90 天能翻番的是管道(先行指标),不是已成交收入**——死磕"A 级可达决策人覆盖率 + 报价/样品产出"。
2. **覆盖率的钥匙不是再找人,是"找到人后给通道"**:邮箱瀑布聚合破 catch-all + **LinkedIn/手机算可达** + A 级放行首封。
3. **最快的三件事零/低成本**:上线 Brief P0、开 RocketReach key、Reachability 改成三通道——**本周就能做,直接抬覆盖率**。
4. **关系画像**把赢单软信号变成公司资产,提升转化+复购+抗人员流失。
5. **Brief 已基本就绪,缺的是上线** —— 发货 > 再设计。

*本文为 90 天作战计划,不含代码、不谈架构。建议从"本周三件事"开打。*
