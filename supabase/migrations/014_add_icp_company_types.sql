-- Add icp_company_types array to company_profiles
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS icp_company_types text[] DEFAULT '{}';
