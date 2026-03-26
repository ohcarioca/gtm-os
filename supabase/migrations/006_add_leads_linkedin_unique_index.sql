-- Unique partial index to prevent duplicate leads by LinkedIn URL per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_linkedin_url_user
  ON leads(user_id, linkedin_url) WHERE linkedin_url IS NOT NULL;
