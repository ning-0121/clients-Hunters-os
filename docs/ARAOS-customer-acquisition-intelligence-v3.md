# Customer Acquisition Intelligence V3 — 订单生产机器

> Head of Revenue 设计。目标:90 天内 A 级可达覆盖率 20% → 80%+,并建可持续增长飞轮。
> 五原则:① 先找值得开发的客户 ② A 级不惜成本找决策人/链 ③ A 级不惜成本找可达方式
> ④ 找到≠成功,必须进收件箱被读 ⑤ 分析必须转行动——系统是"订单机器",不是"报告平台"。

> 真实起点(数据库):48 分析 · 30 海外/18 国内 · **可达 6(13%)** · Apollo 仅 1 家 · Mobile 0% · **已联系 1 · Deal 0 · 动作覆盖 4%**。
> **结论:绑定约束是"执行"(L4),不是分析。L3 可达性子系统已基本建好。火力该投 L1 发现 + L2 enrich + L4 执行。**

---

## 四层架构(每层标注:✅现有可做 / 💰需采购 / ⏳后置)

### L1 · Market Intelligence Engine(发现 + 优先级)
**便宜跑量、扩源扩法,每天灌进新 A 级;贵的 enrich 只留给过闸门的 A 级。**
- **海关反查(ImportYeti/Panjiva/ImportGenius)** 💰 — ODM 杀手锏:查"谁在进口 leggings/activewear"=**已验证买家 + 现供应商 + 量级**。最高意向源。
- **招聘信号(sourcing/开发/生产岗)** ✅列已有(`hiring_signal/hiring_roles`,现为空)→ 接招聘抓取填充。
- **新品/渠道扩张** ✅(`new_products_detected/trigger_type`,部分有)· **融资/增长** ✅(`funding_detected`,现空)→ 富集补。
- **Lookalike(赢单/理想客户找相似)** 💰(Apollo/Clay lookalike)· **Apollo 公司搜索**✅(已有 Apollo,只是没用来找公司)· **Shopify/渠道(Store Leads)**💰 · **加深 Serper**✅。
- **输出**:`Opportunity Score` = f(海关换供应商 + 招 sourcing + 扩张 + 新品 + 融资 + intent);派生 **换厂概率 / 扩张概率 / 新品开发概率**;**客户优先级模型** → 决定谁进 A 级、谁先 enrich。
- **诚实**:现库这些信号大多为空(招聘 0 / intent 0 / 供应商线索 0)→ Opportunity Score 先用**有数据的(海关+新品+触发)**,其余随抓取点亮,不空算。

### L2 · Decision Maker Intelligence Engine(不惜成本找人/通道,只压 A 级)
目标:每 A 级 ≥3 关键人(Sourcing/PD/Production)× ≥2 通道(Email+LinkedIn)+ ≥1 备用(Mobile/WhatsApp/WeChat)。
**最优瀑布**:`Apollo(找人,已有)→ RocketReach(2nd 源,已写缺key)→ LinkedIn Sales Nav/Wiza(委员会)` 找人;`FullEnrich/BetterContact(邮箱+手机瀑布)→ ContactOut/Kaspr(手机/个人邮箱)` 攻通道;`海关/官网/展会` 兜底。详见 `ARAOS` 工具矩阵(上一轮)。
**推荐顺序/ROI**:① FullEnrich(邮箱+手机瀑布,破 catch-all,最高 ROI)💰 ② RocketReach(开 key,近零成本)✅ ③ ContactOut(手机/个人邮箱,A 级专用)💰 ④ Sales Nav 坐席(最后一公里)💰 ⑤ Apollo 公司+人(已有)✅。Clay/PDL ⏳。
**成本**:~22-40 A × 4 人 ≈ 100-160 次,月几百美元;单 A 年采购 $100k-3M → **A 级不惜成本成立**。

### L3 · Deliverability Intelligence Engine(进收件箱)— **大部分已建,别重造**
- ✅ **已建**:SPF/DKIM/DMARC 检测(`lib/email/deliverability.ts` + `/system/email-health`)· **预热爬坡**(20→40→80→150/天,`throttle.ts`)· **退信护栏**(`bounce-rate.ts`)· **发送前 find→verify→decide 拒绝盲发**(`resolve.ts`)· 反垃圾打分(`spam-score.ts`)· 高质量人写感开发信(`compose.ts`)· 按业务员各自邮箱发。
- 🔧 **要做的小改**:catch-all 策略 = **多源互证 = Verified**(不靠 SMTP);**Reachability Score V2** = `Email Reachable(verified/trusted)` OR `LinkedIn Reachable(有 profile)` OR `Mobile Reachable(手机/WhatsApp)`——**任一通即可达**(把 LinkedIn/手机计入,现在没计)。

### L4 · Execution Intelligence Engine(把分析变行动)— **最高 ROI,绑定约束**
**业务员不分析,只执行。** bd/today 顶部「**今日必做客户**」卡,每户自动生成:**为什么联系 / 联系谁(可达决策人)/ 发什么(已起草开发信)/ 推荐样品 / 推荐报价策略**。业务员只 **[点击发送] [点击建 Deal] [点击寄样]**。
- ✅ **可做**:决策简报(`lib/intel`,10 节,**已建未上线**)出"为什么/联系谁/下一步";compose 自动起草开发信;bd/today 已聚合——**只需拼装成动作卡 + 上线**。零录入、零培训、3 秒看懂。

---

## 七项交付

### 1) 90 天实施路线图
| 阶段 | 动作 | 层 |
|---|---|---|
| **7 天** | 上线决策简报 + bd/today「今日必做」动作卡;Reachability V2(LinkedIn/手机计入);开 RocketReach key;Apollo 公司搜索接入发现;**本周联系完现有 6 家可达** | L4·L3·L2·L1 |
| **30 天** | 接 FullEnrich(邮箱+手机瀑布)+ ContactOut(A 级);海关反查接入发现端 + Opportunity Score(用现有信号);对全部 A 级重跑 L2 引擎;Sales Nav 坐席 | L2·L1 |
| **90 天** | A 级 ≥3 人×≥2 通道达标;招聘/融资信号抓取填充 Opportunity Score;国内 A 级走国内通道;持续 refind 维持 ≥80% | L1·L2 |

### 2) Impact / Cost / ROI 排序
| 排序 | 动作 | Impact | Cost | ROI |
|---|---|---|---|---|
| 1 | **上线简报 + 今日必做动作卡(L4)** | 极高(破 4% 动作) | 极低(拼现有) | ★★★★★ |
| 2 | **Reachability V2 计入 LinkedIn/手机(L3)** | 高(直接抬覆盖率) | 极低(逻辑) | ★★★★★ |
| 3 | **RocketReach 开 key(L2)** | 中高 | ~0 | ★★★★★ |
| 4 | **FullEnrich 邮箱+手机瀑布(L2)** | 极高(破 catch-all) | 低(/found) | ★★★★★ |
| 5 | **海关反查做发现源(L1)** | 高(高意向 A 级) | 中 | ★★★★☆ |
| 6 | **ContactOut 手机 + Sales Nav 坐席(L2)** | 高(catch-all 死硬户) | 中 | ★★★★☆ |
| 7 | 招聘/融资抓取 + Opportunity Score(L1) | 中(排优先级) | 中 | ★★★☆☆ |

### 3) 现有系统即可完成(✅,不花钱)
决策简报上线 · 今日必做动作卡(拼 bd/today+brief+compose)· Reachability V2 逻辑 · RocketReach(代码已就绪)· 全套 Deliverability(SPF/DKIM/DMARC/预热/退信/send-gate)· Apollo 公司搜索 · 加深 Serper · 国内/海外覆盖率分开统计 · catch-all 多源互证。

### 4) 需采购工具(💰,只为 A 级)
**FullEnrich 或 BetterContact**(邮箱+手机瀑布,**最优先**)· **ContactOut/Kaspr**(手机/个人邮箱)· **LinkedIn Sales Navigator**(1 坐席)· **ImportYeti/Panjiva**(海关付费)· (可选)Store Leads/Shopify、Apollo 高级位。

### 5) 后置(⏳,90 天后或数据足再做)
People Data Labs(规模化)· Clay(编排平台,自建瀑布够用前不上)· 跨账户成交学习 · 高级换厂概率建模 · 国内深度通道(企查查/1688)· Wiza(LinkedIn 重度时)。

### 6) 预计提升幅度(A 级;估值,基线近零因仅联系 1 家)
| 指标 | 现在 | Day 30 | Day 90 | 主驱动 |
|---|---|---|---|---|
| **可达覆盖率** | 20% | ~50% | **80%+** | L2 瀑布 + L3 Reachability V2 + L1 更准 A |
| **回复率**(对可达决策人) | ~2-3%(冷) | 6-8% | **10-15%** | 触达真决策人 + 进收件箱 + 多通道(邮+领英+WhatsApp) |
| **样品率**(寄样/已联系 A) | ~0 | 5-8% | **12-18%** | 产品导向开发信 + 样品就绪 |
| **报价率** | ~0 | 5-8% | **12-20%** | 对话→报价工作流 + 今日必做推进 |
| **成交率(首单)** | 0 | 管道开始 | **管道充盈,首单陆续(多在 4-9 月落)** | 滞后指标——90 天造管道,订单后置 |
> 诚实:成交是滞后指标,90 天主要把**可达/回复/样品/报价**这些先行指标拉起来;订单在其后 1-2 季度兑现。

### 7) 最终推荐方案
**三环一起转,顺序按 ROI:**
1. **先打通 L4 执行 + L3 Reachability V2(本周,近零成本)** —— 让已建好的简报上线、今日必做动作卡落地、LinkedIn/手机计入可达,并**本周联系完现有 6 家**。这是把 4% 动作率拉起来的总开关,**不做这步,后面全是浪费**。
2. **L2 火力(2-3 周,付费,只压 A 级)** —— FullEnrich + ContactOut + RocketReach key + Sales Nav,把 A 级打到 ≥3 人×≥2 通道、可达 → 50%+。
3. **L1 扩源(并行)** —— 海关反查 + Apollo 公司搜做发现端,设每日 A 级配额 + Opportunity Score 排序,持续灌新 A。
4. **L3 已建,只做小改(catch-all 多源互证 + Reachability V2)**,不重造。

**一句话**:绮陌不缺分析、不缺工具能力,缺的是"**把已建好的简报上线 + 强制业务员每天对可达 A 级行动 + 不惜成本把 A 级 enrich 到多通道 + 海关反查持续灌新 A**"。这四件并行,90 天 A 级可达 20%→80%、先行指标 3-5×,订单管道开始充盈。

---

*本文为 V3 战略与实施设计(未写代码、未采购)。执行与采购需拍板;建议从"本周近零成本三件事"开打。*
