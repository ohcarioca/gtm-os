-- GTM OS — Full Schema
-- Consolidated from 18 migrations into a single initial schema

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================
-- Tables
-- ============================================================

-- Segments
CREATE TABLE segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  search_terms TEXT[] NOT NULL DEFAULT '{}',
  company_size_targets TEXT[] NOT NULL DEFAULT '{medium}',
  min_score_threshold INTEGER NOT NULL DEFAULT 70
    CHECK (min_score_threshold >= 0 AND min_score_threshold <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Companies
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  size TEXT CHECK (size IN ('small', 'medium', 'large')),
  website TEXT,
  linkedin_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  linkedin_url TEXT,
  photo_url TEXT,
  connections INT,
  recent_activity TEXT,
  stage TEXT NOT NULL DEFAULT 'identified'
    CHECK (stage IN ('identified', 'connected', 'in_conversation', 'converted', 'lost')),
  score TEXT CHECK (score IN ('A+', 'A', 'B', 'C')),
  bant JSONB DEFAULT '{}',
  message TEXT,
  validation JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}' NOT NULL,
  phone TEXT,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent runs
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  quantity INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  leads_found INT DEFAULT 0,
  leads_approved INT DEFAULT 0,
  log JSONB[] DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- LinkedIn credentials (encrypted)
CREATE TABLE linkedin_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_email TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  session_cookies JSONB,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Company profiles (one per user)
CREATE TABLE company_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  value_proposition TEXT NOT NULL,
  icp TEXT NOT NULL,
  icp_company_types TEXT[] DEFAULT '{}',
  default_target_roles TEXT[] DEFAULT '{}',
  default_regions TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- LinkedIn usage tracking
CREATE TABLE linkedin_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  scrapes_count INTEGER NOT NULL DEFAULT 0,
  searches_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

-- Prospect companies (discovery pipeline)
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
  company_markdown TEXT,
  linkedin_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rejected leads (dedup across runs)
CREATE TABLE rejected_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linkedin_url TEXT NOT NULL,
  name TEXT,
  company TEXT,
  reason TEXT NOT NULL,
  score INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Rejected companies (dedup across runs)
CREATE TABLE rejected_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  reason TEXT NOT NULL,
  employee_estimate TEXT,
  sector TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- API keys (encrypted)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  service TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, service)
);

-- ============================================================
-- Triggers
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER linkedin_credentials_updated_at
  BEFORE UPDATE ON linkedin_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER company_profiles_updated_at
  BEFORE UPDATE ON company_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejected_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE rejected_companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS Policies
-- ============================================================

CREATE POLICY "Users can manage own segments"
  ON segments FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own companies"
  ON companies FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own leads"
  ON leads FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own agent_runs"
  ON agent_runs FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own linkedin_credentials"
  ON linkedin_credentials FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own company_profiles"
  ON company_profiles FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can read own usage" ON linkedin_usage
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own usage" ON linkedin_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own usage" ON linkedin_usage
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access" ON linkedin_usage
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Users can manage own prospect_companies"
  ON prospect_companies FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own rejected leads"
  ON rejected_leads FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users see own rejected companies"
  ON rejected_companies FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own API keys"
  ON api_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access on api_keys"
  ON api_keys FOR ALL
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- Indexes
-- ============================================================

CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_company ON leads(company_id);
CREATE INDEX idx_leads_user_stage ON leads(user_id, stage);
CREATE INDEX idx_companies_segment ON companies(segment_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_user ON agent_runs(user_id);
CREATE UNIQUE INDEX idx_leads_linkedin_url_user
  ON leads(user_id, linkedin_url) WHERE linkedin_url IS NOT NULL;
CREATE INDEX idx_prospect_companies_user ON prospect_companies(user_id);
CREATE INDEX idx_prospect_companies_status ON prospect_companies(user_id, status);
CREATE INDEX idx_prospect_companies_segment ON prospect_companies(segment_id);
CREATE UNIQUE INDEX rejected_leads_user_linkedin ON rejected_leads(user_id, linkedin_url);
CREATE UNIQUE INDEX rejected_companies_user_name ON rejected_companies(user_id, LOWER(name));
