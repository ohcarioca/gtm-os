-- Add default target roles and regions to company_profiles
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS default_target_roles text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_regions text[] DEFAULT '{}';
