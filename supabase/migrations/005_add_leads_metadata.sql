-- Add metadata JSONB to leads for enrichment data
ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}' NOT NULL;
