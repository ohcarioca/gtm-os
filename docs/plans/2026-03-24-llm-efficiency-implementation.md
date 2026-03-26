# LLM Efficiency Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce LLM consumption by ~75% by assigning appropriate models (Haiku/Sonnet instead of Opus) and consolidating redundant LLM calls.

**Architecture:** Add `{ model: "haiku" }` or `{ model: "sonnet" }` to each `callClaude`/`callClaudeJSON` call. Merge `scoreLead` + `createLead` into a single LLM call. Expand `analyzeCompany` to include enrichment fields.

**Tech Stack:** Claude CLI (`--model` flag), LangGraph state, Zod schemas

---

### Task 1: Add model parameter to Haiku-tier calls

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts:75`
- Modify: `src/lib/linkedin-playwright.ts:288`
- Modify: `src/lib/firecrawl-enrich.ts:65`
- Modify: `src/lib/agent/company-discovery/nodes/build-queries.ts:57`

**Step 1: Add `model: "haiku"` to `buildDorkQueries` in find-lead.ts**

Change line 75:
```typescript
// Before:
const result = await callClaudeJSON(prompt, dorkQueriesSchema, { timeout: 60_000 });

// After:
const result = await callClaudeJSON(prompt, dorkQueriesSchema, { timeout: 60_000, model: "haiku" });
```

**Step 2: Add `model: "haiku"` to `searchPeople` parse in linkedin-playwright.ts**

Change line 288:
```typescript
// Before:
results = await callClaudeJSON(parsePrompt, searchResultsSchema, { timeout: 30_000 });

// After:
results = await callClaudeJSON(parsePrompt, searchResultsSchema, { timeout: 30_000, model: "haiku" });
```

**Step 3: Add `model: "haiku"` to `enrichCompany` in firecrawl-enrich.ts**

Change line 65:
```typescript
// Before:
const data = await callClaudeJSON(prompt, enrichmentSchema, { timeout: 30_000 });

// After:
const data = await callClaudeJSON(prompt, enrichmentSchema, { timeout: 30_000, model: "haiku" });
```

**Step 4: Add `model: "haiku"` to `buildQueries` in company-discovery/build-queries.ts**

Change line 57:
```typescript
// Before:
const result = await callClaudeJSON(prompt, queriesSchema, { timeout: 60_000 });

// After:
const result = await callClaudeJSON(prompt, queriesSchema, { timeout: 60_000, model: "haiku" });
```

**Step 5: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts src/lib/linkedin-playwright.ts src/lib/firecrawl-enrich.ts src/lib/agent/company-discovery/nodes/build-queries.ts
git commit -m "perf: assign haiku model to simple extraction LLM calls"
```

---

### Task 2: Add model parameter to Sonnet-tier calls

**Files:**
- Modify: `src/lib/agent/nodes/triage-company.ts:215`
- Modify: `src/lib/agent/nodes/score-lead.ts:57`
- Modify: `src/lib/agent/nodes/create-lead.ts:40`
- Modify: `src/lib/linkedin-playwright.ts:417`
- Modify: `src/lib/agent/company-discovery/nodes/analyze-company.ts:76`

**Step 1: Add `model: "sonnet"` to `triageCompany` in triage-company.ts**

Change line 215:
```typescript
// Before:
const triage = await callClaudeJSON(prompt, triageSchema, { timeout: 30_000 });

// After:
const triage = await callClaudeJSON(prompt, triageSchema, { timeout: 30_000, model: "sonnet" });
```

**Step 2: Add `model: "sonnet"` to `scoreLead` in score-lead.ts**

Change line 57:
```typescript
// Before:
const score = await callClaudeJSON(prompt, scoreSchema, { timeout: 60_000 });

// After:
const score = await callClaudeJSON(prompt, scoreSchema, { timeout: 60_000, model: "sonnet" });
```

**Step 3: Add `model: "sonnet"` to `createLead` message in create-lead.ts**

Change line 40:
```typescript
// Before:
const message = await callClaude(messagePrompt, { timeout: 60_000 });

// After:
const message = await callClaude(messagePrompt, { timeout: 60_000, model: "sonnet" });
```

**Step 4: Add `model: "sonnet"` to `getProfile` parse in linkedin-playwright.ts**

Change line 417:
```typescript
// Before:
profileData = await callClaudeJSON(parsePrompt, profileSchema, { timeout: 45_000 });

// After:
profileData = await callClaudeJSON(parsePrompt, profileSchema, { timeout: 45_000, model: "sonnet" });
```

**Step 5: Add `model: "sonnet"` to `analyzeCompany` in analyze-company.ts**

Change line 76:
```typescript
// Before:
const result = await callClaudeJSON(prompt, analysisSchema, { timeout: 60_000 });

// After:
const result = await callClaudeJSON(prompt, analysisSchema, { timeout: 60_000, model: "sonnet" });
```

**Step 6: Commit**

```bash
git add src/lib/agent/nodes/triage-company.ts src/lib/agent/nodes/score-lead.ts src/lib/agent/nodes/create-lead.ts src/lib/linkedin-playwright.ts src/lib/agent/company-discovery/nodes/analyze-company.ts
git commit -m "perf: assign sonnet model to reasoning-heavy LLM calls"
```

---

### Task 3: Consolidate scoreLead + createLead into single LLM call

**Files:**
- Modify: `src/lib/agent/state.ts:54-66` — add `message` field to `currentScore`
- Modify: `src/lib/agent/nodes/score-lead.ts` — expand prompt and schema to include message generation
- Modify: `src/lib/agent/nodes/create-lead.ts` — remove LLM call, use `state.currentScore.message`

**Step 1: Update `currentScore` type in state.ts to include message**

Replace lines 54-66 in `src/lib/agent/state.ts`:
```typescript
  currentScore: Annotation<{
    total: number;
    dimensions: {
      company_fit: number;
      role_fit: number;
      seniority: number;
      activity: number;
    };
    justification: string;
    message: string;
  } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
```

**Step 2: Expand score-lead.ts prompt and schema to generate message**

Replace the full content of `src/lib/agent/nodes/score-lead.ts`:
```typescript
import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const scoreSchema = z.object({
  total: z.number().min(0).max(100),
  dimensions: z.object({
    company_fit: z.number().min(0).max(30),
    role_fit: z.number().min(0).max(30),
    seniority: z.number().min(0).max(20),
    activity: z.number().min(0).max(20),
  }),
  justification: z.string(),
  message: z.string(),
});

export async function scoreLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "score_lead", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;
  const company = state.currentCompany;
  const validation = state.currentValidation;

  if (!dm || !company) {
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: "Dados insuficientes para scoring." }],
    };
  }

  try {
    const prompt = `Score this B2B lead on a 0-100 scale AND generate a personalized LinkedIn message.

SEGMENT CRITERIA:
- Target roles: ${state.targetRoles.join(", ")}
- Search terms: ${state.searchTerms.join(", ")}
- Company sizes: ${state.companySizeTargets.join(", ")}
- Region: ${state.region}
${state.companyProfile ? `- ICP: ${state.companyProfile.icp}\n- Sector: ${state.companyProfile.sector}\n- Value proposition: ${state.companyProfile.value_proposition}` : ""}

LEAD DATA:
- Name: ${dm.name}
- Role: ${dm.role}
- Company: ${company.name}
- Connections: ${dm.connections ?? "unknown"}
- About: ${dm.about ?? "N/A"}
- Recently active: ${validation?.activity ?? "unknown"}

SCORING DIMENSIONS:
1. company_fit (0-30): Does the company match the ICP? Sector, size, relevance.
2. role_fit (0-30): Does the role match target roles? Exact match = high, related = medium.
3. seniority (0-20): Is this person a decision-maker? Connections > 500 is a strong signal.
4. activity (0-20): Is the person active on LinkedIn? Active = higher chance of response.

MESSAGE RULES:
- Max 300 characters, in Portuguese (Brazil)
- Professional but friendly tone
- Mention something specific about the person or their company
- Clear value hook${state.companyProfile ? `\n- My company: ${state.companyProfile.name} — ${state.companyProfile.value_proposition}` : ""}
- No excessive emojis

Return JSON with: total (sum of dimensions), dimensions (each score), justification (1-2 sentences in Portuguese), message (the LinkedIn message).`;

    const score = await callClaudeJSON(prompt, scoreSchema, { timeout: 60_000, model: "sonnet" });

    log.message = `Score: ${score.total}/100 — ${score.justification}`;

    return {
      currentScore: score,
      log: [log],
    };
  } catch (err) {
    console.error("[score-lead] Error:", err);
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: `Erro no scoring: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 3: Remove LLM call from create-lead.ts, use state.currentScore.message**

Replace the message generation block (lines 25-40) in `src/lib/agent/nodes/create-lead.ts`:
```typescript
// Before (lines 25-40):
    const messagePrompt = `Gere uma mensagem personalizada para LinkedIn ...`;
    const message = await callClaude(messagePrompt, { timeout: 60_000, model: "sonnet" });

// After:
    const message = state.currentScore?.message ?? "";
```

Also remove the `callClaude` import since it's no longer used:
```typescript
// Before (line 2):
import { callClaude } from "@/lib/claude-cli";

// After: remove this line entirely
```

**Step 4: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 5: Commit**

```bash
git add src/lib/agent/state.ts src/lib/agent/nodes/score-lead.ts src/lib/agent/nodes/create-lead.ts
git commit -m "perf: consolidate score + message generation into single LLM call"
```

---

### Task 4: Expand analyzeCompany to include enrichment fields (discovery pipeline)

**Files:**
- Modify: `src/lib/agent/company-discovery/nodes/analyze-company.ts` — add enrichment fields to schema and prompt
- Modify: `src/lib/agent/company-discovery/nodes/save-company.ts` — map new enrichment fields

**Step 1: Expand analysisSchema and prompt in analyze-company.ts**

Add enrichment fields to the schema (lines 5-16):
```typescript
const analysisSchema = z.object({
  is_company: z.boolean(),
  name: z.string().optional(),
  sector: z.string().optional(),
  size: z.string().optional(),
  description: z.string().optional(),
  products: z.array(z.string()).optional(),
  tech_stack: z.array(z.string()).optional(),
  hiring_status: z.boolean().optional(),
  icp_score: z.number().min(0).max(100).optional(),
  icp_justification: z.string().optional(),
  // Enrichment fields (new)
  contact_email: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  employee_count: z.string().nullable().optional(),
});
```

Update the prompt return JSON line (line 74) to include the new fields:
```
Return JSON: {"is_company": bool, "name": "...", "sector": "...", "size": "...", "description": "...", "products": [...], "tech_stack": [...], "hiring_status": bool, "icp_score": N, "icp_justification": "...", "contact_email": "..." or null, "contact_phone": "..." or null, "address": "..." or null, "employee_count": "50-200" or null}
```

Update the analysis object (lines 87-97) to include new fields:
```typescript
    const analysis = {
      name: result.name ?? domain,
      sector: result.sector ?? state.sector,
      size: result.size ?? null,
      description: result.description ?? null,
      products: result.products ?? [],
      tech_stack: result.tech_stack ?? [],
      hiring_status: result.hiring_status ?? false,
      icp_score: result.icp_score ?? 0,
      icp_justification: result.icp_justification ?? "",
      // Enrichment fields
      contact_email: result.contact_email ?? null,
      contact_phone: result.contact_phone ?? null,
      address: result.address ?? null,
      employee_count: result.employee_count ?? null,
    };
```

**Step 2: Update CompanyAnalysis interface in save-company.ts**

Update the interface (lines 4-14):
```typescript
interface CompanyAnalysis {
  name: string;
  sector: string;
  size: string | null;
  description: string | null;
  products: string[];
  tech_stack: string[];
  hiring_status: boolean;
  icp_score: number;
  icp_justification: string;
  // Enrichment fields
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  employee_count: string | null;
}
```

Check if the `prospect_companies` table has columns for these enrichment fields. If not, these fields are stored in the existing `metadata` or need a migration. For now, add them to the insert if columns exist, otherwise skip.

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors.

**Step 4: Commit**

```bash
git add src/lib/agent/company-discovery/nodes/analyze-company.ts src/lib/agent/company-discovery/nodes/save-company.ts
git commit -m "perf: expand analyzeCompany to include enrichment fields, saving 1 LLM call per discovery"
```

---

### Task 5: Verify build and update docs

**Files:**
- Modify: `CLAUDE.md` — update pipeline description to note model assignments

**Step 1: Run full build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Run lint**

Run: `npm run lint`
Expected: No new lint errors.

**Step 3: Update CLAUDE.md agent pipeline section**

Add a note about model assignments in the Agent Pipeline section:
```markdown
- LLM calls use Claude Code CLI (`claude --print`) — zero API cost.
- Model assignment: Haiku for extraction tasks (dork queries, search parsing, enrichment), Sonnet for reasoning tasks (triage, scoring, profile analysis, company analysis). No calls use Opus.
```

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with LLM model assignment strategy"
```
