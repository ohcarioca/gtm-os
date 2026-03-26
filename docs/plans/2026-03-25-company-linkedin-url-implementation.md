# Company LinkedIn URL Extraction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract and save the company LinkedIn page URL during website scraping in both the company discovery and enrichment pipelines.

**Architecture:** Add `linkedin_url` field to the existing LLM prompts that already analyze company website markdown. No new API calls, nodes, or pipelines — just extend existing schemas, prompts, and DB inserts.

**Tech Stack:** Supabase (migration), Zod (schemas), Claude CLI (LLM prompts), TypeScript

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/018_add_company_linkedin_url.sql`

**Step 1: Write migration**

```sql
-- Add linkedin_url column to prospect_companies
ALTER TABLE prospect_companies ADD COLUMN linkedin_url TEXT;
```

**Step 2: Apply migration**

Run: `npx supabase db push` (or apply manually via Supabase dashboard)

**Step 3: Commit**

```bash
git add supabase/migrations/018_add_company_linkedin_url.sql
git commit -m "feat: add linkedin_url column to prospect_companies"
```

---

### Task 2: Update TypeScript Types

**Files:**
- Modify: `src/lib/types/database.ts:90-109` — `ProspectCompany` interface

**Step 1: Add linkedin_url to ProspectCompany**

In `src/lib/types/database.ts`, add `linkedin_url: string | null;` to the `ProspectCompany` interface, after `website`:

```typescript
export interface ProspectCompany {
  id: string;
  user_id: string;
  segment_id: string | null;
  name: string;
  website: string | null;
  linkedin_url: string | null;  // <-- add this line
  sector: string | null;
  size: string | null;
  region: string | null;
  description: string | null;
  tech_stack: string | null;
  products: string | null;
  hiring_status: string | null;
  icp_score: number;
  icp_justification: string | null;
  company_markdown: string | null;
  status: ProspectCompanyStatus;
  source: string;
  created_at: string;
}
```

**Step 2: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "feat: add linkedin_url to ProspectCompany type"
```

---

### Task 3: Update Company Discovery — analyze-company.ts

**Files:**
- Modify: `src/lib/agent/company-discovery/nodes/analyze-company.ts:5-20` — Zod schema
- Modify: `src/lib/agent/company-discovery/nodes/analyze-company.ts:54-78` — LLM prompt
- Modify: `src/lib/agent/company-discovery/nodes/analyze-company.ts:91-105` — analysis object

**Step 1: Add linkedin_url to analysisSchema**

Add after `employee_count`:

```typescript
linkedin_url: z.string().nullable().optional(),
```

**Step 2: Add linkedin_url to LLM prompt**

In the prompt string, add to the JSON return format description:

```
- linkedin_url: company LinkedIn page URL (e.g. "https://www.linkedin.com/company/acme-corp") or null if not found. Look for LinkedIn links in the page header, footer, or social media section.
```

And update the return JSON example at the end of the prompt to include `"linkedin_url": "..." or null`.

**Step 3: Add linkedin_url to analysis object**

In the analysis object (around line 91-105), add:

```typescript
linkedin_url: result.linkedin_url ?? null,
```

**Step 4: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 5: Commit**

```bash
git add src/lib/agent/company-discovery/nodes/analyze-company.ts
git commit -m "feat: extract linkedin_url in company analysis"
```

---

### Task 4: Update Company Discovery — save-company.ts

**Files:**
- Modify: `src/lib/agent/company-discovery/nodes/save-company.ts:4-17` — CompanyAnalysis interface
- Modify: `src/lib/agent/company-discovery/nodes/save-company.ts:93-109` — Supabase insert

**Step 1: Add linkedin_url to CompanyAnalysis interface**

Add after `employee_count`:

```typescript
linkedin_url: string | null;
```

**Step 2: Add linkedin_url to Supabase insert**

In the `.insert({...})` call, add:

```typescript
linkedin_url: analysis.linkedin_url,
```

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 4: Commit**

```bash
git add src/lib/agent/company-discovery/nodes/save-company.ts
git commit -m "feat: save linkedin_url in company discovery pipeline"
```

---

### Task 5: Update Enrichment — firecrawl-enrich.ts

**Files:**
- Modify: `src/lib/firecrawl-enrich.ts:7-18` — CompanyEnrichment interface
- Modify: `src/lib/firecrawl-enrich.ts:20-30` — Zod schema
- Modify: `src/lib/firecrawl-enrich.ts:48-64` — LLM prompt
- Modify: `src/lib/firecrawl-enrich.ts:68` — return value

**Step 1: Add linkedinUrl to CompanyEnrichment interface**

Add after `address`:

```typescript
linkedinUrl: string | null;
```

**Step 2: Add linkedinUrl to enrichmentSchema**

Add after `address`:

```typescript
linkedinUrl: z.string().nullable(),
```

**Step 3: Add linkedinUrl to LLM prompt**

Add to the extraction list in the prompt:

```
- linkedinUrl: company LinkedIn page URL (e.g. "https://www.linkedin.com/company/acme-corp") or null if not found. Look for LinkedIn links in the page footer, header, or social media section.
```

**Step 4: Update return value**

The return already spreads `data` into the result with `website`. The `linkedinUrl` will be included automatically from the Zod-parsed data. No change needed on line 68.

**Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 6: Commit**

```bash
git add src/lib/firecrawl-enrich.ts
git commit -m "feat: extract linkedin_url in company enrichment"
```

---

### Task 6: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` — migration list, Key Files if needed

**Step 1: Add migration 018 to the list**

Add after migration 017:

```
18. `018_add_company_linkedin_url.sql` — LinkedIn URL column for prospect_companies
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add migration 018 to CLAUDE.md"
```
