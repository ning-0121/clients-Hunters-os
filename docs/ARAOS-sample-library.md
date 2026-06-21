# ARAOS — Sample Library System P0 (设计评审 · 不含代码)

> 瓶颈已从"找客户"变成"**寄什么样**"。建一个**样品库 = 销售武器**(不是库存/仓储系统)。
> 让任何销售能:搜样 → 找到最佳样 → 知道是否就绪 → 知道在哪 → 知道能否立刻寄。
> 它是 **Product Attack Engine 缺失的那块真实数据集**,也将打通 Quote / Customer / Order Intelligence。

---

## 1. 架构审计

| 现状 | 说明 |
|---|---|
| **`sample_library`** | ❌ 不存在(greenfield)——本期新建 |
| **`samples`(已存在,0 行)** | 是**寄样事务记录**(company_id / status 生命周期 requested→confirmed→shipped→delivered→feedback / items jsonb / feedback)。**不是样品目录。** `actions/samples.ts`(createSample/updateSampleStatus)+ `/samples` 页是寄样流程 → **保留、链接,不替换** |
| **`factory_profiles`(2)/`factory_capabilities`(8)/`factory_certifications`(10)** | 真实工厂能力 → **样品的工厂归属 + 推荐时的能力加权** |
| **brief(`lib/intel/*`)** | customer type / product_match / 目标 FOB(product-attack)→ **样品推荐的客户侧输入** |
| **storage** | 无 Supabase storage 使用 → **P0 用 photo_urls(手填 URL),上传到 bucket = P1** |

**关键区分**:
- **`sample_library`** = 主目录(我们能寄的样,带编码/规格/就绪)——**销售武器**。
- **`samples`** = 寄样事务(寄给了谁、到哪了、反馈)——**台账**。
- 二者经 `samples.sample_library_id` 关联(寄出的是哪个库样)。**不混为一谈。**

---

## 2. 数据模型

### 新表 `sample_library`(主目录)
```
id                 uuid pk
sample_code        text UNIQUE NOT NULL      -- "QM-LEG-001"(人读编码)
sample_name        text NOT NULL
category           text NOT NULL             -- 归一:leggings|sports_bra|seamless|fleece|jogger|tracksuit|set|yoga|lounge|...
subcategory        text
photo_urls         text[]                    -- P0 手填 URL;P1 改 storage
fabric             text                      -- "Nylon/Spandex(四面弹)"
composition        text                      -- "78% Nylon 22% Spandex"
gsm                int
stretch            text                      -- 2-way | 4-way | none
factory_id         uuid REFERENCES factory_profiles(id)   -- 哪个厂能做
development_owner  text
development_date   date
status             text DEFAULT 'development' -- ready | development | out_of_stock | archived
ready_to_ship      boolean DEFAULT false
available_quantity int DEFAULT 0
estimated_fob      numeric                   -- 单件 USD(供 FOB/报价)
development_cost   numeric
lead_time_days     int
moq                int                       -- 供搜索/匹配(用户搜索含 MOQ)
tags               text[]                    -- 搜索辅助:["seamless","compression","ribbed"]
notes              text
is_active          boolean DEFAULT true
created_at / updated_at TIMESTAMPTZ
```
**索引**:`category`、`ready_to_ship WHERE ready_to_ship`、`estimated_fob`、`factory_id`、GIN(`tags`)。**RLS**:authenticated all(沿用现有约定)。

### 关联(最小改动)
- `samples` 增 `sample_library_id uuid REFERENCES sample_library(id)`(可空)——寄样时回填寄的是哪个库样 → 为 P1"样品转化率"打底。
- `category` 与 `factory_capabilities.category` **同一套归一词表**(seamless/leggings/sports_bra/fleece/yoga…),保证推荐时能 join 能力强弱。

### 就绪状态(派生,统一口径)
```
Ready            = status='ready'  且 ready_to_ship 且 available_quantity>0
Out of Stock     = status='ready'  但 available_quantity<=0(或 ready_to_ship=false 因缺货)
Development Needed = status='development'
Archived         = status='archived'(不参与推荐/搜索默认)
```

> **样品库初始为空**:P0 提供**录入 UI** 让样品团队填(这是真实数据,不预置假样)。推荐/搜索在空库时优雅降级(返回空 + 提示"样品库待录入"),随录入自动变强——与 Product Attack Engine 同一"诚实 + 数据飞轮"原则。

---

## 3. UI 设计

**新页 `/samples`(样品库 — 浏览/搜索)**
- 卡片网格:主图 · `sample_code` · 名称 · category/subcategory · fabric/GSM · `estimated_fob` · **就绪徽章**(🟢Ready / 🟡开发 / ⚪缺货)· 工厂。
- 左侧筛选:category · fabric · 结构(seamless/cut-and-sew via tags)· 就绪 only 开关 · FOB 区间 · MOQ ≤ · 工厂。顶部搜索框 + 排序(相关度/FOB/就绪/最新)。

**样品详情 `/samples/[id]`**
- 全规格 + 多图 + 就绪/库存 + FOB/开发成本/交期 + notes + **「寄样历史」**(join `samples` where sample_library_id)+ 编辑。

**录入/编辑表单**(样品团队):全字段;photo_urls 手填(P0)。

**嵌入客户简报(Product Attack Plan ④ Sample Attack Plan)**
- "**Top 5 推荐样品**":卡片(编码/主图/就绪徽章/FOB/推荐理由)→ 🟢"Ready 样,可直接寄" / 🟡"需开发"。
- 「寄此样」→ 复用现有 `createSample` 流程(回填 sample_library_id)。
- 链接到样品详情。**替换**当前 product-attack 里"无样品库 → 需开发"的降级文案。

---

## 4. 搜索设计

- **过滤**(全部走 DB 索引):`category`(枚举 eq/in)· `fabric`(ilike)· 结构关键词(tags contains: seamless/leggings/bra/fleece)· `moq <= X` · `estimated_fob BETWEEN low,high` · 就绪(`ready_to_ship=true`)· `factory_id`。
- **文本搜索**:`sample_code / sample_name / notes / tags` ilike(样品量级数百,无需全文引擎)。
- **排序**:公司上下文下按**推荐分**(§5);否则按 FOB / 就绪 / 最新。
- **默认**:`is_active=true 且 status!='archived'`。
- 纯查询层 `lib/samples/search.ts`(构造过滤),被 `/samples` 页与推荐复用。

---

## 5. 推荐逻辑(给定公司 → Top 5)

纯函数 `lib/samples/recommend.ts`:`recommendSamples(ctx, samples[]) → ScoredSample[]`,复用 Product Attack Engine 的打分思路,样品级。

输入 `ctx`(来自 brief,已有):客户需求品类(product_match high/medium)、customer type、目标 FOB 区间、factory_capabilities(强弱)。

每个库样 `matchScore(0-100)`:
- **品类契合**(最重):sample.category ∈ 客户需求品类 → 大分;∈ 工厂 strong 品类 → 再加。
- **工厂强度**:factory_capabilities[sample.category] = strong/medium/weak。
- **盈利性**:`estimated_fob` 落在/低于客户目标 FOB 带 + 相对 development_cost 的毛利空间。
- **开发就绪**:`Ready` >> `Development`(就绪样更可攻,权重高);Out of Stock 降权。
- **类型契合**:premium → 偏高工艺无缝;off-price → 偏基础 fleece/jogger。

输出 Top 5,每个带:就绪徽章 + 一句**有据**理由(品类契合 / 工厂强项 / 盈利 / 就绪)。空库 → 返回空 + 提示。**无 LLM,确定性,可单测。**

---

## 6. P0 路线图(本期)

1. 迁移 `015_sample_library.sql`:`sample_library` 表 + 索引 + RLS + `samples.sample_library_id`(你手动应用)。
2. `types`:`SampleLibraryItem` / `ScoredSample` / readiness 枚举。
3. `lib/samples/search.ts`(过滤构造)+ `lib/samples/recommend.ts`(纯推荐)+ 单测。
4. `actions/sample-library.ts`:create/update/archive 库样(录入)。
5. UI:`/samples` 列表+搜索 · `/samples/[id]` 详情 · 录入/编辑表单。
6. 嵌入简报:Product Attack Plan 的 Sample Attack Plan 调 `recommendSamples` → Top5(替换降级文案);「寄此样」复用 createSample 回填 sample_library_id。
7. `validate:samples` 单测(推荐打分、就绪派生、搜索过滤、空库降级)+ typecheck + build + UI 冒烟(录 2-3 个样 → 搜索 → 在 Oner/Vitality 简报里出现 Top5)。

**0 个 P0 外部依赖**;复用 factory 能力 + brief + 现有寄样流程。样品库由团队录入(真实数据)。

## 7. P1 路线图

- **照片上传**:Supabase storage bucket(取代手填 URL)。
- **样品转化分析**:经 `samples.sample_library_id` 统计每个库样的寄出→反馈→成单率 → "最易成单样品" 反哺推荐分。
- **接 Quote Intelligence**:样品 `estimated_fob` 一键带入报价行(样品→报价→订单闭环)。
- **从订单反哺**:won `orders.product_lines` 自动建议补充库样。
- **轻库存**:寄样扣减 available_quantity + 低库存提醒(仍非仓储系统)。
- **接 Order Intelligence**:复购订单关联其样品来源。

---

## 预估开发量

| 阶段 | 范围 | 估时 |
|---|---|---|
| **P0** | 迁移 + 2 纯库(search/recommend)+ 录入 action + 3 个 UI(列表/详情/表单)+ 简报嵌入 + 单测 + 冒烟 | **3-4 天** |
| **P1** | storage 上传 + 转化分析 + Quote 打通 + 订单反哺 | **3-5 天(随数据)** |

---

## 关键判断

- **样品库是"销售武器"不是仓储**:字段服务于"能不能寄、寄什么、报多少",不做复杂出入库。
- **与 `samples` 严格分层**:库(目录)vs 台账(寄样事务),经 `sample_library_id` 关联。
- **品类词表与 factory_capabilities 对齐**,推荐才能用真实能力强弱加权。
- **空库优雅降级、团队录入真实样**,随寄样/订单数据形成转化飞轮——这正是 Product Attack Engine 等待的真实数据集。

*本文为设计评审,不含代码、不建迁移。确认 P0 范围后再实现。*
