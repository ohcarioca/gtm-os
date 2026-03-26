# Rejected Leads & Companies Dedup — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist rejected leads and companies to DB so they're never re-analyzed in future runs, saving API calls and time.

**Architecture:** Two tables (`rejected_leads`, `rejected_companies`) with RLS. Write rejections from `triage-company.ts` (companies), `graph.ts` routing (leads failing validation/score). Read dedup from `find-lead.ts` (leads, already coded) and `triage-company.ts` (companies, new).

**Tech Stack:** Supabase (Postgres), Zod, LangGraph.js

---

### Task 1: Create migration for `rejected_leads` and `rejected_companies` tables

**Files:**
- Create: `supabase/migrations/013_add_rejected_dedup.sql`

**Step 1: Write the migration**

```sql
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
```

**Step 2: Commit**

```bash
git add supabase/migrations/013_add_rejected_dedup.sql
git commit -m "feat: add rejected_leads and rejected_companies tables"
```

---

### Task 2: Save rejected companies in `triage-company.ts`

**Files:**
- Modify: `src/lib/agent/nodes/triage-company.ts`

**Step 1: Add Supabase import and dedup check + save logic**

Add import at top:
```ts
import { createClient } from "@supabase/supabase-js";
```

Add helper function after `findCompanyWebsite`:
```ts
async function isCompanyRejected(companyName: string, userId: string): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabase
    .from("rejected_companies")
    .select("reason")
    .eq("user_id", userId)
    .ilike("name", companyName)
    .limit(1)
    .single();

  return data?.reason ?? null;
}

async function saveRejectedCompany(
  companyName: string,
  userId: string,
  triage: { reason: string; employeeEstimate: string; sector: string }
): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.from("rejected_companies").upsert(
    {
      user_id: userId,
      name: companyName,
      reason: triage.reason,
      employee_estimate: triage.employeeEstimate,
      sector: triage.sector,
    },
    { onConflict: "user_id,name" }
  ).then(() => {});
}
```

**Step 2: Add dedup check at start of `triageCompany` function**

After the `!companyName` skip block (after line 75), add:
```ts
  // Check if company was previously rejected
  try {
    const previousReason = await isCompanyRejected(companyName, state.userId);
    if (previousReason) {
      return {
        companyTriage: { pass: false, reason: previousReason, employeeEstimate: "", sector: "" },
        log: [{ ...log, message: `Triagem empresa: ${companyName} — REPROVADA (já rejeitada: ${previousReason}). Pulando.` }],
      };
    }
  } catch {
    // DB check failed, continue with normal triage
  }
```

**Step 3: Save rejection after Claude CLI triage fails**

After the triage result is computed (after line 127 `const triage = ...`), add save logic:
```ts
    // Save rejected company for future dedup
    if (!triage.pass) {
      saveRejectedCompany(companyName, state.userId, triage).catch(() => {});
    }
```

**Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 5: Commit**

```bash
git add src/lib/agent/nodes/triage-company.ts
git commit -m "feat: save and check rejected companies for dedup in triage"
```

---

### Task 3: Save rejected leads in `graph.ts` routing

**Files:**
- Modify: `src/lib/agent/graph.ts`

The rejection points are in the graph routing functions. When `isValid` returns `find_lead` (validation failed) or `meetsThreshold` returns `find_lead` (score too low), the lead should be saved as rejected.

**Step 1: Add Supabase import and save helper**

Add at top:
```ts
import { createClient } from "@supabase/supabase-js";
```

Add helper after imports:
```ts
async function saveRejectedLead(state: AgentStateType, reason: string): Promise<void> {
  const dm = state.currentDecisionMaker;
  if (!dm?.linkedinUrl) return;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  await supabase.from("rejected_leads").upsert(
    {
      user_id: state.userId,
      linkedin_url: dm.linkedinUrl,
      name: dm.name,
      company: dm.company,
      reason,
      score: state.currentScore?.total ?? null,
    },
    { onConflict: "user_id,linkedin_url" }
  ).then(() => {});
}
```

**Step 2: Add save calls in routing functions**

Update `isValid`:
```ts
function isValid(state: AgentStateType): "score_lead" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const v = state.currentValidation;
  if (v && v.photo && v.activity) return "score_lead";
  // Save rejected lead (validation failed)
  saveRejectedLead(state, "validation_failed").catch(() => {});
  return shouldRetryOrStop(state);
}
```

Update `meetsThreshold`:
```ts
function meetsThreshold(state: AgentStateType): "enrich_lead" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const score = state.currentScore?.total ?? 0;
  if (score >= state.minScoreThreshold) return "enrich_lead";
  // Save rejected lead (low score)
  saveRejectedLead(state, "low_score").catch(() => {});
  return shouldRetryOrStop(state);
}
```

**Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

**Step 4: Commit**

```bash
git add src/lib/agent/graph.ts
git commit -m "feat: save rejected leads on validation failure and low score"
```

---

### Task 4: Update CLAUDE.md and design docs

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add migration 013 to the list**

After `12. ... remove segments`:
```
13. `013_add_rejected_dedup.sql` — Rejected leads and companies tables for cross-run dedup
```

**Step 2: Add bullet to Agent Pipeline section**

After the `triage_company` bullet:
```
- Rejected leads (validation_failed, low_score) and rejected companies (triage_failed) are saved to DB for cross-run dedup. `find-lead` checks `rejected_leads` before processing. `triage_company` checks `rejected_companies` before triaging.
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with rejected dedup tables"
```
