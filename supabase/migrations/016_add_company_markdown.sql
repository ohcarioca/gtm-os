-- Add company_markdown to prospect_companies for reuse in lead scoring
ALTER TABLE prospect_companies ADD COLUMN IF NOT EXISTS company_markdown text;
