# Rejected Leads Dedup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Save rejected leads to a dedicated table and skip them on future prospecting runs to avoid wasting API calls.

**Architecture:** New `rejected_leads` table with unique index on `(user_id, linkedin_url)`. Insert on 3 rejection points (validation fail, low score, scoring error). Check in `find-lead.ts` alongside existing `leads` dedup.

**Tech Stack:** Supabase (Postgres), TypeScript, LangGraph nodes

---

### Task 1: Create database migration

**Files:**
- Create: `supabase/migrations/009_add_rejected_leads.sql`

**Step 1: Write the migration**

```sql
-- Rejected leads: tracks leads the agent already evaluated and rejected,
-- so they won't be re-processed on future runs.

CREATE TABLE rejected_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  linkedin_url TEXT NOT NULL,
  name TEXT,
  reason TEXT NOT NULL,
  score INTEGER,
  segment_id UUID REFERENCES segments(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE UNIQUE INDEX rejected_leads_user_linkedin
  ON rejected_leads(user_id, linkedin_url);

ALTER TABLE rejected_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own rejected leads"
  ON rejected_leads FOR ALL
  USING (auth.uid() = user_id);
```

**Step 2: Commit**

```bash
git add supabase/migrations/009_add_rejected_leads.sql
git commit -m "feat: add rejected_leads table for dedup"
```

---

### Task 2: Add RejectedLead type

**Files:**
- Modify: `src/lib/types/database.ts`

**Step 1: Add the interface at the end of the file (before the closing)**

```typescript
export interface RejectedLead {
  id: string;
  user_id: string;
  linkedin_url: string;
  name: string | null;
  reason: "low_score" | "validation_failed" | "scoring_error";
  score: number | null;
  segment_id: string | null;
  created_at: string;
}
```

**Step 2: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "feat: add RejectedLead type"
```

---

### Task 3: Add rejected leads dedup check in find-lead.ts

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts`

The existing `getExistingLinkedInUrls` checks the `leads` table. Add a similar check for `rejected_leads` and combine both sets.

**Step 1: Add `getRejectedLinkedInUrls` function after `getExistingLinkedInUrls` (line 30)**

```typescript
async function getRejectedLinkedInUrls(
  userId: string,
  urls: string[]
): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const { data } = await supabase
    .from("rejected_leads")
    .select("linkedin_url")
    .eq("user_id", userId)
    .in("linkedin_url", urls);
  return new Set((data ?? []).map((r) => r.linkedin_url as string));
}
```

**Step 2: Update the dedup check in `findLead` function (around line 109)**

Change from:
```typescript
const existingUrls = await getExistingLinkedInUrls(state.userId, allUrls);
```

To:
```typescript
const [existingUrls, rejectedUrls] = await Promise.all([
  getExistingLinkedInUrls(state.userId, allUrls),
  getRejectedLinkedInUrls(state.userId, allUrls),
]);
```

**Step 3: Update the skip condition (line 112)**

Change from:
```typescript
if (existingUrls.has(profile.normalizedUrl)) continue;
```

To:
```typescript
if (existingUrls.has(profile.normalizedUrl)) continue;
if (rejectedUrls.has(profile.normalizedUrl)) continue;
```

**Step 4: Verify build**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "feat: skip previously rejected leads in find-lead dedup"
```

---

### Task 4: Save rejected leads in validate-profile.ts

**Files:**
- Modify: `src/lib/agent/nodes/validate-profile.ts`

When validation fails (photo=false or activity=false), insert into `rejected_leads`.

**Step 1: Add supabase import at the top of the file**

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

**Step 2: Add rejected lead insert in the `!isValid` block (after line 107, before the return)**

Inside the `if (!isValid)` block (line 107), add before the return statement:

```typescript
    if (!isValid) {
      // Save rejected lead for dedup
      await supabase.from("rejected_leads").upsert(
        {
          user_id: state.userId,
          linkedin_url: linkedinUrl,
          name: dm.name as string,
          reason: "validation_failed",
          segment_id: state.segmentId,
        },
        { onConflict: "user_id,linkedin_url" }
      );

      return {
        // ... existing return unchanged
      };
    }
```

Note: Use `upsert` with `onConflict` to handle the case where the same lead was already rejected (idempotent).

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/lib/agent/nodes/validate-profile.ts
git commit -m "feat: save validation-rejected leads to rejected_leads table"
```

---

### Task 5: Save rejected leads in score-lead.ts

**Files:**
- Modify: `src/lib/agent/nodes/score-lead.ts`

Two rejection points: (1) score below threshold, (2) scoring parse failed 2x.

**Step 1: Add supabase import at the top of the file**

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);
```

**Step 2: Save rejected lead when scoring fails (inside the catch block, line 116-128)**

Before the return in the `attempt === 1` block:

```typescript
      if (attempt === 1) {
        const linkedinUrl = (dm.linkedinUrl as string) ?? "";
        if (linkedinUrl) {
          await supabase.from("rejected_leads").upsert(
            {
              user_id: state.userId,
              linkedin_url: linkedinUrl,
              name: dm.name as string,
              reason: "scoring_error",
              segment_id: state.segmentId,
            },
            { onConflict: "user_id,linkedin_url" }
          );
        }

        // Both attempts failed — discard lead as precaution
        return {
          // ... existing return unchanged
        };
      }
```

**Step 3: Save rejected lead when score is below threshold**

This happens in `graph.ts` conditional edge `meetsThreshold`, but we don't have access to supabase there. Instead, add the insert at the end of `scoreLead` when the score is below threshold.

After the score is computed (after line 129, before the final return), add a check:

```typescript
  // Save as rejected if below threshold
  if (score && score.total < state.minScoreThreshold) {
    const linkedinUrl = (dm.linkedinUrl as string) ?? "";
    if (linkedinUrl) {
      await supabase.from("rejected_leads").upsert(
        {
          user_id: state.userId,
          linkedin_url: linkedinUrl,
          name: dm.name as string,
          reason: "low_score",
          score: score.total,
          segment_id: state.segmentId,
        },
        { onConflict: "user_id,linkedin_url" }
      );
    }
  }

  return {
    currentScore: score,
    // ... existing return unchanged
  };
```

**Step 4: Verify build**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/lib/agent/nodes/score-lead.ts
git commit -m "feat: save score-rejected leads to rejected_leads table"
```

---

### Task 6: Run full build and verify

**Step 1: Run build**

Run: `npm run build`
Expected: Build succeeds with no errors

**Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors

**Step 3: Final commit (if any fixes needed)**

```bash
git commit -m "fix: address build/lint issues for rejected leads"
```
