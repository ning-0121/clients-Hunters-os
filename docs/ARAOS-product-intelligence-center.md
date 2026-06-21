# ARAOS — Product Intelligence Center (PIC) · 战略架构评审

> 第三支柱。Customer Intelligence 答"卖给谁",Contact 答"找谁谈",SOE 答"何时出手、资源怎么配",
> **PIC 答"到底卖什么"**,并最终答"为每个客户:**该开发/寄送/报价/定位/进攻哪个产品**"。
> 视角:全球服装集团 · 顶级 ODM · 收入操作系统 · 5 年平台。**激进挑战假设,包括 PAC 本身是否正确。**

---

## 1. 第一性原理:什么是 Product Intelligence

收入链:**Market Demand → Customer → Product → Factory → Quote → Order → Repeat**。
绝大多数系统只懂左半(Customer/Contact/CRM/Pipeline)。**几乎没有系统懂 Product Intelligence。**

- **Product Assets ≠ Product Intelligence。** 资产 = 名词(我们有这个样/这块料);智能 = 动词 + 学习(**这个产品对谁、在什么 FOB、以多少毛利、经哪个厂、会赢**)。资产是拥有的事实;智能是派生的、概率的、越用越准的。
- **为什么 PI 最终比 Customer Intelligence 更值钱**:Customer/Contact Intelligence 正在**商品化**(Apollo/ZoomInfo/AI 爬虫,人人可得)——它是**租来的**。而"哪个精确产品、哪种面料、什么 FOB 能赢这个买手"是**专有的、从你自己的报价/订单/样品里挣来的、可复利的**——它是**自己的**。对 **ODM 而言,产品就是价值主张**:客户为产品/能力换厂,不为漂亮 CRM 换厂。
- **ODM 的战略优势**:护城河 = "我们知道什么好卖 + 能做得好/便宜/稳"。PI 把"什么好卖"这一半——通常锁在几个资深开发/跟单脑子里的 tribal knowledge——**制度化**。这是 ODM 最难复制、最贴近毛利的资产。

> 结论:PI 是把"产品知识"从个人变成机构、从经验变成可复利资产的层。**5 年看,它可能是整个系统最深的护城河。**(前提:数据飞轮真的转——见 §5/§8 的诚实警告。)

---

## 2. 挑战 PAC(评审我上一版自己的设计)

**PAC 的命名与框架是静态的(Asset/库存味),这是它的根本不足。** 价值不在"目录",在"什么会赢"。所以——

| PAC 层 | 对 | 缺 | 过度 | 重设计 |
|---|---|---|---|---|
| Product Coding | ✓ product_code 作通用 join key,正确且关键 | — | — | 保留,纳入 PIC 脊柱 |
| Sample / Fabric / Product / Development Library | ✓ Product 为中枢、引用关系对 | **缺 Product DNA(结构化通用语言)** | versions/derivatives 图、dev 库在"零产品"时建 = 过早 | 合并为**资产基质(Substrate)**,由 **DNA** 串联;关系图后置 |
| Winning Product / Customer-Product Intel | ✓ 列为派生、P1/P2,正确 | **缺"飞轮"作为一等架构关切** | — | 升为一等**Performance Intelligence**,显式飞轮 |
| Attack Packages | ✓ 输出精确 IDs、证据分层 | 缺 DNA 匹配 → "相似/契合/替代"全靠手感 | — | 重建在 DNA + 飞轮之上 |

**PAC 三个核心正确点**(保留):Product 为中枢 + product_code 通用键;Hard vs Derived 宪法;建脊柱不建空 8 层。
**PAC 三个关键缺失**(PIC 补):① **Product DNA**(缺的原语,见 §4)② **需求/趋势输入侧**(PAC 纯被动从现有资产推荐;收入始于需求——PIC 要能"在客户开口前就知道该开发什么")③ **飞轮**作为显式学习架构。
**PAC 过度处**:在录入第一个产品前就建 version/derivative 图、development 库——典型 org-chart 凑层。

**判定:PAC 不是错的,而是不够——它是 PIC 的资产基质层(Substrate),不是顶层抽象。PIC 是正确的顶层。** PAC 被 PIC 吸收。

---

## 3. PIC 架构(评审用户建议的 10 层 → 重组为 4 个功能面)

用户给的 10 层混了 4 种性质(输入/资产/智能/输出)。**平铺 10 层 = org-chart 思维,会建空脚手架。** 按"硬→派生→输出 + DNA 脊柱"重组:

```
            ┌──────────────── 横切:Product DNA(通用语言,§4)────────────────┐
 SIGNAL     │  需求与趋势情报(Trend+Concept 合并)— 前瞻"市场要什么"          │  ← 最难、最易虚假精确 → P3,轻量、标注推断
 (输入)     └───────────────────────────────────────────────────────────────┘
 SUBSTRATE     资产基质:Product(带 DNA)· Sample · Fabric · Development        ← 硬数据,人录(= PAC)
 (硬资产)         │  与 factory_capabilities 同词表
 INTELLIGENCE  Performance Intelligence(Winning + Customer-Preference 合并)     ← 派生,飞轮产出(§5),数据足才点亮
 (派生)           │  全部在 DNA 层学习,可缓存+provenance+可重算
 ENGINES       ① Product Attack Engine(单客户 → 精确产品包,§6)                 ← 输出
 (输出)        ② Product Strategy Engine(组合级:开发什么/淘汰什么/投哪)        ← 输出(portfolio)
```

**改动**:Trend+Concept **合并**为"需求与趋势"且**后置(P3)**——我们零趋势数据、无法验证,现在建就是最大的虚假精确;Winning+Customer-Preference **合并**为 Performance Intelligence;**新增 Product Strategy Engine**(用户的 Layer 10,正确——这是 Attack 的组合级对偶:不止"给这个客户推什么",而是"作为一个 ODM 该开发/押注什么品类");Sample/Fabric/Development **降为 Substrate 的 facet**(都由 DNA 键合),不各列一层。

**4 个面,不是 10 层。** DNA 横切所有面——这是关键架构决定。

---

## 4. Product DNA(最重要的概念)

**Product DNA = 产品的结构化、通用、可机器比较的描述**,沿正交"链"展开。设计原则:**DNA 维度 = 驱动匹配的维度**(客户契合/工厂契合/面料契合/趋势契合/相似/替代)。一套词表,全平台都用它说话。

**挑战用户的示例**:用户把 *Factory Fit / Customer Fit* 放进了 DNA——**错**。Factory Fit、Customer Fit、Win Rate 是 **DNA 与其他实体匹配后派生的关系**,**不是产品固有属性**。**DNA = 内在、拥有、稳定的属性;Fit/Win = 派生匹配**(同一条 Hard vs Derived 宪法)。把它们混进 DNA,平台又会烂成"存了假事实"。

**优化后的 DNA 架构(只含内在链)**:
| DNA 链 | 含义 | 例(LG-2027-018) |
|---|---|---|
| **Identity** | code/类目/子类/silhouette/版本 | LG / leggings / high-waist / v1 |
| **Construction DNA** | 廓形/腰线/长度/贴合(压缩)/接缝(seamless/cut-sew/bonded)/复杂度/trims | 7/8 长 · 高腰 · 中压缩 · 无缝 · 低复杂 |
| **Fabric DNA** | 成分族/GSM 带/弹力(2/4 向)/功能(吸湿/UV/抗菌)/手感 | 尼龙氨纶 · 中 GSM · 4 向 · 吸湿 |
| **Performance DNA** | 用途(训练/瑜伽/休闲/跑)/支撑/不透/耐久 | 训练 · 中支撑 · 高不透 |
| **Market DNA** | 零售价带/定位(premium/mid/value)/目标客户类型/季节 | mid · 春夏 |
| **Capability DNA** | 所需工厂能力类目(链 factory_capabilities)→ 谁能做、什么成本档 | 需"无缝 strong" |
| **Commercial DNA** | 基础 FOB 带/基础毛利/MOQ/交期 | $7-10 · 50 MOQ |
| **Trend DNA**(可选,低置信) | 趋势标签(前瞻) | "Pilates/芭蕾核心" |

- **强制**:Identity + Construction + Fabric 族 + Market 带 + Capability(够做匹配与报价)。**可选**:细 Performance、全 BOM、Trend。
- **派生(不入 DNA)**:Customer Fit、Factory Fit、Win Rate、Attack Score → 由 DNA × 客户/工厂/历史**计算**。
- **DNA 即通用语言**:客户需求表达为 **DNA 目标**(这个买手要 4 向高压缩无缝打底,$6-9 带)→ 与产品 DNA 匹配 = Fit;工厂能力、面料、趋势全用 DNA 表达 → **一套词表,万物可匹配**。这是把"相似/替代/契合"从手感变成可计算的那一步。

---

## 5. Product Intelligence Flywheel(学习闭环)

**关键洞见:飞轮在 DNA 层学习,不在产品层。** 这样**新产品凭相似 DNA 继承其 DNA 簇的成交统计**——解决新品冷启动,是飞轮真正强大的原因(跨产品泛化)。

| | 内容 |
|---|---|
| **存(Hard)** | 寄样请求/反馈 · 报价(价/赢负)· 订单 · 复购 · 毛利 · 工厂表现 · (轻)趋势信号 —— 每条都是一个 **DNA→结果** 的标注样本 |
| **派生(算,不当事实存)** | 各 DNA 簇/产品的 win rate · 客户偏好向量(DNA 维)· product-fit · attack score · 面料表现 · 毛利实现 vs 估计 |
| **永不存** | 派生分当权威列 · 主观意见当事实 · 趋势预测当确定 |
| **如何变准** | 冷启:能力 + DNA 规则匹配;温:DNA→结果统计("DNA 模式 X 在客户类型 Y、FOB Z 赢");热(多租户):跨账户 DNA-win 模型 |

**飞轮 = 护城河**:每张真实 quote/sample/order 都在给"什么 DNA 对什么客户会赢"打标签,越用越准。**诚实警告:今天 quotes/orders/samples = 0 行 → 飞轮还没有燃料。最高杠杆的下一步不是再设计,是开始捕获这些交易数据(见 §10)。**

---

## 6. Product Attack Engine(PIC 原生重设计)

把客户需求**翻译成 DNA 目标**(取自客户简报:类型/品类/价带/采购模型)→ 检索 DNA 匹配的产品 → 打分排序 → 输出**精确资产**:
```
AttackPackage(company) = Top-N of {
  product_code, sample_code, fabric_code, factory_id,
  est_fob, est_margin, win_probability, confidence, evidence_tier,
  differentiation,            // 我方 DNA/能力 强项 ∩ 客户缺口
  rationale[]                 // 引证据:能力/DNA 契合/历史/就绪
} + avoid[] + basis{customerType, dnaTarget, factoryStrengths}
```
打分 = **DNA 契合 × 工厂能力 × 飞轮 win-rate(数据足才计入)× 毛利 × 样品就绪 × 客户偏好(P2)**;证据分层、空历史降级(能力+DNA 主导、标中置信)、纯函数无 LLM 进决策。回答九问:推什么(精确 ID)/为什么/寄什么样/什么面料/FOB/毛利/赢率/哪个厂/凭什么赢。**输出资产,不是品类。**

**Strategy Engine(组合级对偶)**:聚合所有客户的 DNA 需求 vs 我方资产/能力缺口 → "该开发哪些 DNA、淘汰哪些滞销、把开发预算押在哪"——把 Attack 从"卖现有"扩展到"造该造的"。

---

## 7. 运营视角与 KPI

| 角色 | PIC 带来的提升 |
|---|---|
| **VP Sales** | 更快、更对的产品包 → 回复率/转化率↑;首谈即带精确样品/FOB |
| **Head of PD** | 不再重复开发已有;按"会赢 + 趋势"开发 → 开发效率、**复用率**↑ |
| **GM** | 毛利率、复购率、**开发 ROI**↑;tribal knowledge 制度化、抗人员流失 |

**PIC 拥有的 KPI**:样→报→单转化(按产品)· 产品/DNA 簇 win rate · **样品复用率(vs 新开发)** · **开发 ROI(开发$→订单)** · 毛利实现 vs 估计 · attack package 生成时延 · 单产品复购率。

**North Star(单一)= 开发资本 ROIC = 订单毛利$ ÷ 投入开发$(样品+开发+面料)。**
理由:它是 SOE"GTM 资本 ROIC"的**产品侧对偶**,同属资本配置者语言;同时倒逼"开发对的东西"(分母)与"用它赢"(分子)。比"推荐采纳率"更接近第一性,比"成交额"多了分母。

---

## 8. 护城河

假设 Customer/Contact Intelligence 与 Apollo 类工具全面商品化。PIC 的独有护城河:
1. **数据**:专有 **DNA→结果**数据集(你的报价/样/单按 DNA + 客户类型标注)——别人没有,越用越大。
2. **工作流**:PD + 销售 + 报价都**穿过** PIC 跑 → 切换成本。
3. **智能**:**DNA 层** win 模型(泛化、复利)——不是"有数据",是"把数据变成越用越准的配置 edge"。
4. **网络效应/多租户**:跨工厂聚合 DNA-win → **全行业"什么好卖"模型**,单厂造不出——**最强的一条**。

**PIC 会是整个系统最值钱的部分吗?——大概率是,在 ODM 语境下。** Customer Intelligence 找门;PIC+SOE 决定**带什么进门、何时进**。客户数据是租的、在贬值;产品制胜智能是挣的、在复利、且行业独有。**但**:这是**潜在**护城河,**完全取决于飞轮是否转动**(= 是否纪律性地记录每一笔报价/样/单)。今天数据为空 → 护城河尚是期权,不是现金流。

---

## 9. 五年愿景与最终架构

```
        Customer Intelligence(WHO)
                 ×
        PIC(WHAT,经 Product DNA)
                 ×
        SOE(WHEN / HOW-MUCH,资本配置)
                 ×
        Quote Intelligence(WHAT PRICE)
                 ×
        Order Intelligence(交付 + 结果回灌)
   ────────────────────────────────────────
   中央 OS = SOE 配置器,编排「客户 × 产品 × 时机 × 价格 × 工厂」
            以最大化风险调整后回报;每笔结果回灌学习。
   通用语言 = 产品用 DNA、客户用 brief、约束用 Capacity —— 全平台同一套词表。
   多租户 → 行业级产品-客户-成交智能层(SOE "Aladdin" 的产品维度)。
```
- **PIC = 产品大脑;SOE = 配置器;CI = 需求传感器;Quote/Order = 执行与反馈;DNA = lingua franca。**
- 终态:每个实体(客户/联系人/产品/样/料/报价/订单)都编码、DNA/画像标注;系统持续配置"**哪个产品、给哪个客户、什么时机、什么价、哪个厂做**"以最大化长期回报,并从每个结果学习。这才是"全球服装集团的产品智能操作系统"。

---

## 10. 最关键的挑战(作为长期资本配置者,我必须说)

**约束不再是设计,是数据捕获与发货。**
- 本会话已产出 **6 份设计**(brief / V2 / product-attack / sample-library / PAC / PIC),代码侧**自 `5c432ed` 起一行未提交**;`quotes/orders/samples = 0 行`。
- PIC 的全部价值(飞轮/护城河/North Star)**以"有真实 DNA→结果数据"为前提**。再多架构都不会让飞轮转——**只有开始记录每一笔报价/样/单才会**。
- 因此最高杠杆的下一步**不是 PIC 全量实现**,而是:
  1. **提交并上线已验收的 Customer Intelligence Brief P0**(让销售今天就用)。
  2. **建 PIC 脊柱的最小版**:Product DNA schema + products(带 DNA)+ sample_library(引用 product)——**并让录入便宜**,使团队开始把样品/产品变成编码资产。
  3. **强制 quote/order 行带 product_code**——让飞轮**从今天起**有燃料。
- DNA、Attack、Strategy、Performance 智能**随数据自动点亮**;现在把它们全建出来 = 在空油箱上装涡轮。

**一句话**:PIC 是正确的 5 年抽象,Product DNA 是它的原语,飞轮是它的护城河;但**护城河靠记录交易挖,不靠写文档挖**。先发货、先捕获数据。

---

## 交付物对照

1. 架构评审 → §1-3 · 2. PAC 战略批判 → §2 · 3. PIC 架构 → §3 · 4. Product DNA → §4 · 5. 飞轮 → §5 · 6. Attack Engine 重设计 → §6 · 7. 运营模型 → §7 · 8. KPI/North Star → §7 · 9. 护城河 → §8 · 10. 五年愿景 → §9 · (+ §10 资本配置者的诚实约束)。

**文档关系**:PIC 取代 PAC 作顶层抽象;PAC = PIC 的资产基质层;Sample/Product-Attack 旧文 = PIC 的 facet/engine。

*本文为战略架构评审,不含代码。下一步建议见 §10:先发货 + 先捕获数据,再按数据点亮 PIC。*
