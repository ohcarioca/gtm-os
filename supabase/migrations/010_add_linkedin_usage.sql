-- Persistent LinkedIn usage tracking (replaces in-memory rate limits)
CREATE TABLE IF NOT EXISTS linkedin_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  scrapes_count INTEGER NOT NULL DEFAULT 0,
  searches_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

ALTER TABLE linkedin_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage" ON linkedin_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage" ON linkedin_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage" ON linkedin_usage
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do everything (for agent nodes running server-side)
CREATE POLICY "Service role full access" ON linkedin_usage
  FOR ALL USING (auth.role() = 'service_role');
