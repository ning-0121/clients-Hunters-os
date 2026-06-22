-- Migration 016 — agent_queue index + history trim (P0 follow-up-loop aftermath)
--
-- The runaway follow-up loop left ~198k completed rows in agent_queue. Without a
-- status index, the worker's claimJobs() scans the whole table every minute AND
-- API-side bulk deletes time out (lock contention). Add the index first, then the
-- DELETE runs fast. Apply in the Supabase SQL editor (idempotent).
--
-- Also adds the missing followup_runs.updated_at column: writing it errored
-- silently in queue-worker / followup-agent, which left runs stuck on 'scheduled'
-- and caused the loop. The code no longer writes it, but having the column
-- prevents the whole class of "write to non-existent column" silent failures.

CREATE INDEX IF NOT EXISTS idx_agent_queue_status         ON agent_queue(status);
CREATE INDEX IF NOT EXISTS idx_agent_queue_status_created ON agent_queue(status, created_at);

ALTER TABLE followup_runs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Trim terminal job history (keep waiting/active). Fast once the index exists.
DELETE FROM agent_queue WHERE status IN ('completed', 'cancelled', 'dead');

-- VERIFY — should be a small number (only waiting/active remain)
SELECT count(*) AS agent_queue_remaining FROM agent_queue;
SELECT (SELECT count(*) FROM information_schema.columns
        WHERE table_name = 'followup_runs' AND column_name = 'updated_at') AS followup_runs_has_updated_at;
