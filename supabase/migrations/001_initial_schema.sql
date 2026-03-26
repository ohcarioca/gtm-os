-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Segments table
CREATE TABLE segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  search_terms TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Companies table
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  size TEXT CHECK (size IN ('small', 'medium', 'large')),
  website TEXT,
  linkedin_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads table
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent runs table
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  quantity INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  leads_found INT DEFAULT 0,
  leads_approved INT DEFAULT 0,
  log JSONB[] DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- LinkedIn credentials table (encrypted)
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

-- Updated_at trigger
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

-- Row Level Security
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies
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

-- Indexes
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_company ON leads(company_id);
CREATE INDEX idx_leads_user_stage ON leads(user_id, stage);
CREATE INDEX idx_companies_segment ON companies(segment_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_user ON agent_runs(user_id);
