-- ============================================================
-- Migration 009: conversion-power P0 (contact-centric + credibility + intent)
-- Additive only — does not touch existing data. Safe to re-run.
-- ============================================================

-- Contacts: role, email credibility, recent activity
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS role             TEXT;   -- founder|sourcing|product|production|operations|marketing|sales|other
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email_credibility TEXT;  -- verified|likely|guessed|none
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_active_at   TIMESTAMPTZ;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS activity_signal  TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_stage   TEXT;   -- (reserved for P2 LinkedIn module)

-- Companies: buying-intent engine
ALTER TABLE companies ADD COLUMN IF NOT EXISTS intent_score      INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS intent_signals    JSONB;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS intent_checked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_contacts_role        ON contacts(role);
CREATE INDEX IF NOT EXISTS idx_contacts_credibility ON contacts(email_credibility);
CREATE INDEX IF NOT EXISTS idx_companies_intent     ON companies(intent_score DESC) WHERE intent_score IS NOT NULL;

SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_name='contacts'  AND column_name='email_credibility') AS contacts_credibility,
  (SELECT count(*) FROM information_schema.columns WHERE table_name='companies' AND column_name='intent_score')      AS companies_intent;
