-- Add contact fields for manual lead creation
ALTER TABLE leads ADD COLUMN phone TEXT;
ALTER TABLE leads ADD COLUMN email TEXT;
ALTER TABLE leads ADD COLUMN notes TEXT;

-- Make segment_id nullable on companies for manually created leads
ALTER TABLE companies ALTER COLUMN segment_id DROP NOT NULL;
