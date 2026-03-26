-- Add 'cancelled' to agent_runs status check constraint
ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check;
ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed', 'cancelled'));
