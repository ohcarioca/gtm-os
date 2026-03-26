-- Rejected leads: leads that failed validation or scored below threshold
CREATE TABLE IF NOT EXISTS rejected_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_url TEXT NOT NULL,
  name TEXT,
  company TEXT,
  reason TEXT NOT NULL,
  score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX rejected_leads_user_linkedin ON rejected_leads(user_id, linkedin_url);
ALTER TABLE rejected_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own rejected leads" ON rejected_leads FOR ALL USING (auth.uid() = user_id);

-- Rejected companies: companies that failed ICP triage
CREATE TABLE IF NOT EXISTS rejected_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  employee_estimate TEXT,
  sector TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX rejected_companies_user_name ON rejected_companies(user_id, LOWER(name));
ALTER TABLE rejected_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own rejected companies" ON rejected_companies FOR ALL USING (auth.uid() = user_id);
