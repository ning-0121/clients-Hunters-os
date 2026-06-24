-- Migration 017 — V2 Revenue OS: discipline + learning columns on companies.
--
-- Already applied to production via the Supabase SQL editor; recorded here
-- (idempotent) so dev / CI / future environments stay in sync.
--
--   next_action_due — manual due date for the lead's next action. Missing it
--     (or the action, or the owner) makes the lead a 🔴 red flag in 今日行动 —
--     the anti-stall discipline that stops deals dying silently.
--   why_no_reply    — recorded reason a lead went silent (Wrong Contact / Wrong
--     Wedge / Weak CTA / Timing / Existing Supplier / No Need / Unknown). Feeds
--     the learning loop that improves wedge/CTA over time.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS next_action_due TIMESTAMPTZ;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS why_no_reply    TEXT;
