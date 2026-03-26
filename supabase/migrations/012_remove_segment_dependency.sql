-- Make segment_id nullable on tables that reference segments
ALTER TABLE companies ALTER COLUMN segment_id DROP NOT NULL;
ALTER TABLE agent_runs ALTER COLUMN segment_id DROP NOT NULL;
