-- Prospect companies table (companies found by discovery pipeline)
CREATE TABLE prospect_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  website TEXT,
  sector TEXT,
  size TEXT,
  region TEXT,
  description TEXT,
  tech_stack TEXT,
  products TEXT,
  hiring_status TEXT,
  icp_score INTEGER DEFAULT 0,
  icp_justification TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'serper' CHECK (source IN ('serper', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prospect_companies_user ON prospect_companies(user_id);
CREATE INDEX idx_prospect_companies_status ON prospect_companies(user_id, status);
CREATE INDEX idx_prospect_companies_segment ON prospect_companies(segment_id);

ALTER TABLE prospect_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own prospect_companies"
  ON prospect_companies FOR ALL USING (auth.uid() = user_id);
