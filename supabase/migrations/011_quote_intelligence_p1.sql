-- ============================================================
-- Migration 011: Quote Intelligence Engine — P1
--
-- Adds storage for the LLM-generated, customer-readable quote message
-- (#5 "复制报价话术"). The message is a DRAFT for the salesperson to review
-- and copy — it is never auto-sent. Competition inference (#6) and history
-- view (#7) need no schema change (inference is a pure function; history reads
-- existing quote_strategies rows).
--
-- Additive only — safe to re-run.
-- ============================================================

ALTER TABLE quote_strategies ADD COLUMN IF NOT EXISTS quote_message      TEXT;
ALTER TABLE quote_strategies ADD COLUMN IF NOT EXISTS quote_message_lang TEXT;
ALTER TABLE quote_strategies ADD COLUMN IF NOT EXISTS quote_message_at   TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────
-- VERIFY — should be 1
-- ─────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name = 'quote_strategies' AND column_name = 'quote_message') AS c_quote_message;
