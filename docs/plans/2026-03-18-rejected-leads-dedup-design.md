# Rejected Leads Dedup — Design

## Problem

When the agent runs prospecting multiple times, it can re-discover the same LinkedIn profiles, re-validate, re-score, and reject them again — wasting API calls (SerpAPI, LinkedIn MCP, Claude) and time.

## Solution

Save rejected leads to a dedicated `rejected_leads` table. Before processing a candidate, check if they were already rejected. If so, skip silently and move to the next candidate.

## Requirements

- Rejected leads are internal-only (no UI changes)
- Agent skips previously rejected leads silently (no log in feed)
- Rejected leads never expire
- No changes to existing `leads` table

## Database

New table `rejected_leads`:

```sql
CREATE TABLE rejected_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  linkedin_url TEXT NOT NULL,
  name TEXT,
  reason TEXT NOT NULL,  -- 'low_score', 'validation_failed', 'scoring_error'
  score INTEGER,         -- numeric score if available
  segment_id UUID REFERENCES segments(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX rejected_leads_user_linkedin ON rejected_leads(user_id, linkedin_url);

ALTER TABLE rejected_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage own rejected leads"
  ON rejected_leads FOR ALL USING (auth.uid() = user_id);
```

## Agent Pipeline Changes

### Insertion Points (3 rejection moments)

1. **`validate-profile.ts`** — profile invalid (no photo / inactive) → insert with `reason: 'validation_failed'`
2. **`score-lead.ts`** — score below threshold → insert with `reason: 'low_score'`, `score: total`
3. **`score-lead.ts`** — scoring parse failed 2x → insert with `reason: 'scoring_error'`

### Dedup Check Point

**`find-lead.ts`** — after finding a candidate on Google and extracting LinkedIn URL, before proceeding:

```typescript
const { data: rejected } = await supabase
  .from('rejected_leads')
  .select('id')
  .eq('user_id', userId)
  .eq('linkedin_url', linkedinUrl)
  .maybeSingle();

if (rejected) {
  // skip silently, try next search result
  continue;
}
```

This combines with the existing `leads` dedup (unique index on `linkedin_url`).

## Scope

- **In scope:** Migration, type updates, agent node changes (find-lead, validate-profile, score-lead)
- **Out of scope:** UI changes, API route changes, feed changes
