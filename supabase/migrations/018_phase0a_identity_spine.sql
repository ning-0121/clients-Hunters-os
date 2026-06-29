-- ============================================================
-- 018 · Phase 0a · clients-Hunters-OS (araos) · Identity Spine
-- Supabase: hpdcqjfwmcbdlgywhjog（araos，获客前端 / 上游）
-- Date: 2026-06-29
-- 设计依据: order-metronome/docs/integration/05-Phase-0-Integration-Spine-Design.md §B.3 / §B.0
-- ------------------------------------------------------------
-- 范围: 仅 araos 6 列（identity spine）。
-- 性质: 纯加法 · 可空 · 幂等(IF NOT EXISTS) · 无跨库 FK · 无索引 ·
--       不改 RLS · 不改 handoff 推送逻辑 ·
--       不改 metronome_handoffs 现有 status / entity_id / error_message 语义 ·
--       一键回滚 · 不影响线上。
-- 顺序: 三库分开推进，本文件 = 第 3 个(araos)。QIMO ffdc602 / finance fc352cf 已归档。
-- 类型: 5 列 uuid + qimo_ack_at 为 timestamptz（回执时间，非 id）。
-- 边界: 6 列在 0a 只“加列”，不接入任何业务/推送/状态逻辑；
--       启用(handoff 带回 QIMO id、回执回填)是后续 Phase，不在 0a。
-- 关键澄清: 新增 metronome_handoffs.qimo_entity_id 与现有 entity_id 是
--           两个不同列——现有 entity_id = araos 本地实体(sample/order)；
--           qimo_entity_id = QIMO 推送回执返回的对应实体 id。现有列语义不动。
-- ============================================================

ALTER TABLE companies          ADD COLUMN IF NOT EXISTS qimo_customer_id uuid;         -- 引用 QIMO customers.id
ALTER TABLE deals              ADD COLUMN IF NOT EXISTS qimo_quote_id    uuid;         -- 引用 QIMO quoter_quotes.id
ALTER TABLE orders             ADD COLUMN IF NOT EXISTS qimo_order_id    uuid;         -- 引用 QIMO orders.id
ALTER TABLE samples            ADD COLUMN IF NOT EXISTS qimo_order_id    uuid;         -- 引用 QIMO orders.id(可空)
ALTER TABLE metronome_handoffs ADD COLUMN IF NOT EXISTS qimo_entity_id   uuid;         -- QIMO 回执对应实体 id
ALTER TABLE metronome_handoffs ADD COLUMN IF NOT EXISTS qimo_ack_at      timestamptz;  -- QIMO 确认回执时间

-- ---- 列注释（说明引用对象 + 0a 不接业务逻辑 + 非跨库 FK）----
COMMENT ON COLUMN companies.qimo_customer_id IS
  'Phase0a identity spine: 赢单晋升后回填，引用 QIMO(scrtebex) customers.id（跨库共享企业 id，非 Postgres FK）。0a 仅加列，不接业务逻辑。';
COMMENT ON COLUMN deals.qimo_quote_id IS
  'Phase0a identity spine: 引用 QIMO quoter_quotes.id（售前策略→QIMO 正式报价，跨库共享 id，非 FK）。0a 仅加列。';
COMMENT ON COLUMN orders.qimo_order_id IS
  'Phase0a identity spine: 薄订单→QIMO 订单指针，引用 QIMO orders.id（跨库共享 id，非 FK）。0a 仅加列，不改 handoff 推送。';
COMMENT ON COLUMN samples.qimo_order_id IS
  'Phase0a identity spine: 打样→QIMO 关联，引用 QIMO orders.id（可空，跨库共享 id，非 FK）。0a 仅加列。';
COMMENT ON COLUMN metronome_handoffs.qimo_entity_id IS
  'Phase0a identity spine: QIMO 推送回执返回的对应实体 id（跨库共享 id，非 FK）。'
  '区别于现有 entity_id（araos 本地实体 sample/order）；0a 仅加列，不改现有 entity_id/status/error_message 语义。';
COMMENT ON COLUMN metronome_handoffs.qimo_ack_at IS
  'Phase0a identity spine: QIMO 确认回执时间（timestamptz）。0a 仅加列，不改 handoff 推送/status/error_message 逻辑。';

-- 注: 不加 qimo_supplier_id（延后 Phase 4）；不加任何索引（留 Phase 0e 回填按需）。

-- ============================================================
-- 验证 SQL（数据库门禁 — 在 araos Supabase SQL Editor 单独运行）
-- ------------------------------------------------------------
-- [1] 6 列存在（期望 6 行）
-- [2][3] 类型 + 可空：5 列 uuid + qimo_ack_at = timestamp with time zone；is_nullable 全 YES
-- SELECT table_name, column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND (
--   (table_name='companies'          AND column_name='qimo_customer_id') OR
--   (table_name='deals'              AND column_name='qimo_quote_id') OR
--   (table_name='orders'             AND column_name='qimo_order_id') OR
--   (table_name='samples'            AND column_name='qimo_order_id') OR
--   (table_name='metronome_handoffs' AND column_name IN ('qimo_entity_id','qimo_ack_at'))
-- ) ORDER BY table_name, column_name;
--
-- [4] 6 列 comment 存在（期望 6 行 description）
-- SELECT c.table_name, c.column_name, pgd.description
-- FROM information_schema.columns c
-- JOIN pg_class st ON st.relname=c.table_name AND st.relnamespace='public'::regnamespace
-- JOIN pg_description pgd ON pgd.objoid=st.oid AND pgd.objsubid=c.ordinal_position
-- WHERE c.table_schema='public' AND (
--   (c.table_name='companies'          AND c.column_name='qimo_customer_id') OR
--   (c.table_name='deals'              AND c.column_name='qimo_quote_id') OR
--   (c.table_name='orders'             AND c.column_name='qimo_order_id') OR
--   (c.table_name='samples'            AND c.column_name='qimo_order_id') OR
--   (c.table_name='metronome_handoffs' AND c.column_name IN ('qimo_entity_id','qimo_ack_at'))
-- ) ORDER BY c.table_name, c.column_name;
--
-- [5] 6 新列上无任何 FK（期望 0 行）
-- SELECT con.conname, t.relname AS tbl, a.attname AS col
-- FROM pg_constraint con
-- JOIN pg_class t ON t.oid=con.conrelid
-- JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(con.conkey)
-- WHERE con.contype='f' AND t.relnamespace='public'::regnamespace
--   AND ( (t.relname='companies'          AND a.attname='qimo_customer_id')
--      OR (t.relname='deals'              AND a.attname='qimo_quote_id')
--      OR (t.relname='orders'             AND a.attname='qimo_order_id')
--      OR (t.relname='samples'            AND a.attname='qimo_order_id')
--      OR (t.relname='metronome_handoffs' AND a.attname IN ('qimo_entity_id','qimo_ack_at')) );
--
-- [6] 6 新列上无任何索引（期望 0 行）
-- SELECT i.relname AS index_name, t.relname AS tbl, a.attname AS col
-- FROM pg_index ix
-- JOIN pg_class t ON t.oid=ix.indrelid
-- JOIN pg_class i ON i.oid=ix.indexrelid
-- JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=ANY(ix.indkey)
-- WHERE t.relnamespace='public'::regnamespace
--   AND ( (t.relname='companies'          AND a.attname='qimo_customer_id')
--      OR (t.relname='deals'              AND a.attname='qimo_quote_id')
--      OR (t.relname='orders'             AND a.attname='qimo_order_id')
--      OR (t.relname='samples'            AND a.attname='qimo_order_id')
--      OR (t.relname='metronome_handoffs' AND a.attname IN ('qimo_entity_id','qimo_ack_at')) );
--
-- [7] 原有关键列仍在（期望 11 行）
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema='public' AND (
--   (table_name='companies'          AND column_name='id') OR
--   (table_name='deals'              AND column_name IN ('id','status')) OR
--   (table_name='orders'             AND column_name IN ('id','order_ref')) OR
--   (table_name='samples'            AND column_name IN ('id','status')) OR
--   (table_name='metronome_handoffs' AND column_name IN ('id','entity_id','status','error_message'))
-- ) ORDER BY table_name, column_name;
--
-- [8] RLS 未被修改（report：5 表 rowsecurity + 策略数，对照执行前一致）
-- SELECT c.relname AS tbl, c.relrowsecurity AS rls_enabled,
--        (SELECT count(*) FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname) AS policy_count
-- FROM pg_class c
-- WHERE c.relnamespace='public'::regnamespace
--   AND c.relname IN ('companies','deals','orders','samples','metronome_handoffs')
-- ORDER BY c.relname;
--
-- [9] 新列旧行全 NULL（期望每个 non_null = 0）
-- SELECT 'companies' AS tbl, count(*) AS total, count(qimo_customer_id) AS non_null FROM companies
-- UNION ALL SELECT 'deals',  count(*), count(qimo_quote_id) FROM deals
-- UNION ALL SELECT 'orders', count(*), count(qimo_order_id) FROM orders
-- UNION ALL SELECT 'samples', count(*), count(qimo_order_id) FROM samples
-- UNION ALL SELECT 'metronome_handoffs', count(*), count(qimo_entity_id)+count(qimo_ack_at) FROM metronome_handoffs;
--
-- [10] metronome_handoffs 现有字段语义未改（期望 3 行）
--      entity_id | uuid | not_null=t   ·   status | text | f   ·   error_message | text | f
-- SELECT a.attname, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS not_null
-- FROM pg_attribute a JOIN pg_class t ON t.oid=a.attrelid
-- WHERE t.relname='metronome_handoffs' AND t.relnamespace='public'::regnamespace
--   AND a.attname IN ('entity_id','status','error_message')
-- ORDER BY a.attname;
-- ============================================================

-- ============================================================
-- 回滚 SQL（如需撤销，单独运行；本文件正常执行不含回滚）
-- ------------------------------------------------------------
-- ALTER TABLE companies          DROP COLUMN IF EXISTS qimo_customer_id;
-- ALTER TABLE deals              DROP COLUMN IF EXISTS qimo_quote_id;
-- ALTER TABLE orders             DROP COLUMN IF EXISTS qimo_order_id;
-- ALTER TABLE samples            DROP COLUMN IF EXISTS qimo_order_id;
-- ALTER TABLE metronome_handoffs DROP COLUMN IF EXISTS qimo_entity_id;
-- ALTER TABLE metronome_handoffs DROP COLUMN IF EXISTS qimo_ack_at;
-- ============================================================
