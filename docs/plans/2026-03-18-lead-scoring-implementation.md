# Lead Scoring & Qualification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Claude Haiku-powered `score_lead` node to the agent pipeline that scores leads 0-100 on company fit, role fit, seniority, and activity — with a configurable per-segment threshold that discards leads below the minimum.

**Architecture:** New `score_lead` node inserted between `validate_profile` and `enrich_lead` in the LangGraph pipeline. Uses Claude Haiku for nuanced scoring. Score stored in lead metadata. New `min_score_threshold` column on segments table with UI controls.

**Tech Stack:** LangGraph.js, Claude Haiku (`claude-haiku-4-5-20251001`), Supabase (Postgres), Next.js Server Actions, shadcn/ui

**Design doc:** `docs/plans/2026-03-18-lead-scoring-design.md`

---

### Task 1: Database Migration — Add `min_score_threshold` to segments

**Files:**
- Create: `supabase/migrations/008_add_segment_score_threshold.sql`

**Step 1: Write the migration**

```sql
-- Add configurable minimum score threshold per segment
ALTER TABLE segments
ADD COLUMN min_score_threshold integer NOT NULL DEFAULT 70;

-- Validate range 0-100
ALTER TABLE segments
ADD CONSTRAINT segments_min_score_threshold_range
CHECK (min_score_threshold >= 0 AND min_score_threshold <= 100);
```

**Step 2: Commit**

```bash
git add supabase/migrations/008_add_segment_score_threshold.sql
git commit -m "feat: add min_score_threshold column to segments"
```

---

### Task 2: Update TypeScript types — Segment and Score

**Files:**
- Modify: `src/lib/types/database.ts` (lines 2, 6-15)

**Step 1: Add `min_score_threshold` to Segment interface and update Score type**

In `src/lib/types/database.ts`:

1. Update `Score` type to include "D":
```typescript
export type Score = "A+" | "A" | "B" | "C" | "D";
```

2. Add `min_score_threshold` to `Segment` interface (after `company_size_targets` line 13):
```typescript
export interface Segment {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_roles: string[];
  search_terms: string[];
  company_size_targets: CompanySize[];
  min_score_threshold: number;
  created_at: string;
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (or only pre-existing ones)

**Step 3: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "feat: add min_score_threshold to Segment type and D to Score"
```

---

### Task 3: Update Zod schemas — segment validation + scoreEnum

**Files:**
- Modify: `src/lib/validations/schemas.ts` (lines 4, 7-13, 55-62)

**Step 1: Update schemas**

1. Update `scoreEnum` (line 4):
```typescript
export const scoreEnum = z.enum(["A+", "A", "B", "C", "D"]);
```

2. Add `min_score_threshold` to `createSegmentSchema` (after `company_size_targets` line 12):
```typescript
export const createSegmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  target_roles: z.array(z.string().min(1)).min(1),
  search_terms: z.array(z.string().min(1)).min(1),
  company_size_targets: z.array(z.enum(["small", "medium", "large"])).min(1),
  min_score_threshold: z.number().int().min(0).max(100).default(70),
});
```

3. Add `min_score_threshold` to `updateSegmentSchema` (after `company_size_targets` line 61):
```typescript
export const updateSegmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  target_roles: z.array(z.string().min(1)).min(1).optional(),
  search_terms: z.array(z.string().min(1)).min(1).optional(),
  company_size_targets: z.array(companySizeEnum).min(1).optional(),
  min_score_threshold: z.number().int().min(0).max(100).optional(),
});
```

**Step 2: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "feat: add min_score_threshold to segment Zod schemas"
```

---

### Task 4: Update agent state — add `currentScore` and `minScoreThreshold`

**Files:**
- Modify: `src/lib/agent/state.ts` (lines 3-41)

**Step 1: Add new state fields**

Add after `currentValidation` (line 22):

```typescript
currentScore: Annotation<{
  total: number;
  dimensions: Record<string, { score: number; max: number; reason: string }>;
  justification: string;
} | null>(),
```

Add after `searchTerms` (line 8), a new field for the threshold:

```typescript
companySizeTargets: Annotation<string[]>(),
minScoreThreshold: Annotation<number>(),
```

**Step 2: Commit**

```bash
git add src/lib/agent/state.ts
git commit -m "feat: add currentScore and minScoreThreshold to agent state"
```

---

### Task 5: Create `score_lead` node

**Files:**
- Create: `src/lib/agent/nodes/score-lead.ts`

**Step 1: Write the scoring node**

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { getApiKey } from "@/lib/claude-auth";
import type { AgentStateType } from "../state";

export async function scoreLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const dm = state.currentDecisionMaker;
  const company = state.currentCompany;
  const validation = state.currentValidation;

  if (!dm || !company) {
    return {
      currentScore: null,
      retries: state.retries + 1,
      log: [{
        step: "score_lead",
        message: "No lead data to score",
        timestamp: new Date().toISOString(),
      }],
    };
  }

  const segmentContext = [
    `Target roles: ${state.targetRoles.join(", ")}`,
    `Search terms: ${state.searchTerms.join(", ")}`,
    state.companySizeTargets?.length
      ? `Target company sizes: ${state.companySizeTargets.join(", ")}`
      : null,
    `Region: ${state.region}`,
  ].filter(Boolean).join("\n");

  const companyContext = state.companyProfile
    ? [
        `Our company: ${state.companyProfile.name}`,
        `Sector: ${state.companyProfile.sector}`,
        `Value proposition: ${state.companyProfile.value_proposition}`,
        `ICP: ${state.companyProfile.icp}`,
      ].join("\n")
    : "No company profile configured — score based on segment criteria only.";

  const leadData = [
    `Name: ${dm.name}`,
    `Role: ${dm.role || dm.snippet || "Unknown"}`,
    `Company: ${company.name}`,
    `Company snippet: ${company.snippet || "N/A"}`,
    `Connections: ${dm.connections ?? "Unknown"}`,
    `About: ${dm.about || "N/A"}`,
    `Recent activity: ${dm.recent_activity || "Unknown"}`,
    `Validation — photo: ${validation?.photo}, connections: ${validation?.connections}, role_match: ${validation?.role_match}, activity: ${validation?.activity}`,
  ].join("\n");

  const systemPrompt = `You are a B2B lead qualification expert. Score this lead on how well they match the prospecting criteria.

Return ONLY valid JSON with this exact structure:
{
  "total": <0-100>,
  "dimensions": {
    "company_fit": { "score": <0-30>, "max": 30, "reason": "<1 sentence in Portuguese>" },
    "role_fit": { "score": <0-30>, "max": 30, "reason": "<1 sentence in Portuguese>" },
    "seniority": { "score": <0-20>, "max": 20, "reason": "<1 sentence in Portuguese>" },
    "activity": { "score": <0-20>, "max": 20, "reason": "<1 sentence in Portuguese>" }
  },
  "justification": "<1 sentence summary in Portuguese>"
}

Scoring guidelines:
- company_fit (30pts): How well does the lead's company match the ICP? Consider sector, size, type.
- role_fit (30pts): Does the person's role match the target roles? Exact match = high, related = medium, unrelated = low.
- seniority (20pts): Is this person a decision maker? Consider connections (>500 = senior), about section, role title.
- activity (20pts): Is the person active on LinkedIn? Recent activity = high score.
- total MUST equal the sum of all dimension scores.`;

  const userPrompt = `## Segment Criteria (what we want)
${segmentContext}

## Our Company (who is prospecting)
${companyContext}

## Lead Data
${leadData}

Score this lead.`;

  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
    anthropicApiKey: getApiKey(),
  });

  let score: {
    total: number;
    dimensions: Record<string, { score: number; max: number; reason: string }>;
    justification: string;
  } | null = null;

  // Try scoring with 1 retry
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await llm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      const text = typeof response.content === "string"
        ? response.content
        : "";

      // Extract JSON from response (handle markdown code blocks)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON in response");

      score = JSON.parse(jsonMatch[0]);
      break;
    } catch (err) {
      if (attempt === 1) {
        // Both attempts failed — discard lead as precaution
        return {
          currentScore: null,
          retries: state.retries + 1,
          log: [{
            step: "score_lead",
            message: `Scoring failed for ${dm.name} — lead discarded as precaution`,
            timestamp: new Date().toISOString(),
          }],
        };
      }
    }
  }

  return {
    currentScore: score,
    log: [{
      step: "score_lead",
      message: `Lead scored: ${dm.name} (${score!.total}/100) — ${score!.justification}`,
      timestamp: new Date().toISOString(),
    }],
  };
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/score-lead.ts
git commit -m "feat: add score_lead agent node with Claude Haiku scoring"
```

---

### Task 6: Wire `score_lead` into the graph

**Files:**
- Modify: `src/lib/agent/graph.ts` (full file)

**Step 1: Add the new node and routing**

Replace the full contents of `src/lib/agent/graph.ts`:

```typescript
import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentState } from "./state";
import type { AgentStateType } from "./state";
import { findLead } from "./nodes/find-lead";
import { validateProfile } from "./nodes/validate-profile";
import { scoreLead } from "./nodes/score-lead";
import { createLead } from "./nodes/create-lead";
import { enrichLeadNode } from "./nodes/enrich-lead";

const MAX_RETRIES = 5;

function isValid(
  state: AgentStateType
): "score_lead" | "find_lead" | typeof END {
  if (state.retries >= MAX_RETRIES) return END;
  if (state.currentValidation?.photo && state.currentValidation?.activity) {
    return "score_lead";
  }
  return "find_lead";
}

function meetsThreshold(
  state: AgentStateType
): "enrich_lead" | "find_lead" | typeof END {
  if (state.retries >= MAX_RETRIES) return END;
  const score = state.currentScore;
  if (!score) return "find_lead";
  if (score.total >= state.minScoreThreshold) return "enrich_lead";
  return "find_lead";
}

function shouldContinue(
  state: AgentStateType
): "find_lead" | typeof END {
  if (state.leadsCreated >= state.quantity) return END;
  return "find_lead";
}

export function buildProspectingGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("find_lead", findLead)
    .addNode("validate_profile", validateProfile)
    .addNode("score_lead", scoreLead)
    .addNode("enrich_lead", enrichLeadNode)
    .addNode("create_lead", createLead)
    .addEdge(START, "find_lead")
    .addEdge("find_lead", "validate_profile")
    .addConditionalEdges("validate_profile", isValid)
    .addConditionalEdges("score_lead", meetsThreshold)
    .addEdge("enrich_lead", "create_lead")
    .addConditionalEdges("create_lead", shouldContinue);

  return graph.compile();
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add src/lib/agent/graph.ts
git commit -m "feat: wire score_lead node into agent pipeline graph"
```

---

### Task 7: Pass segment threshold and company size targets to the agent

**Files:**
- Modify: `src/app/api/prospect/route.ts` (lines 64-74)

**Step 1: Add `minScoreThreshold` and `companySizeTargets` to the graph input**

In `src/app/api/prospect/route.ts`, update the `graph.stream()` call (line 64-76) to include:

```typescript
const eventStream = await graph.stream(
  {
    segmentId: parsed.data.segment_id,
    region: parsed.data.region,
    quantity: parsed.data.quantity,
    targetRoles: segment.target_roles,
    searchTerms: segment.search_terms,
    companySizeTargets: segment.company_size_targets ?? [],
    minScoreThreshold: segment.min_score_threshold ?? 70,
    companyProfile: companyProfile ?? null,
    runId: run!.id,
    userId: user.id,
  },
  { recursionLimit: 300, streamMode: "updates", signal: abortSignal }
);
```

**Step 2: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "feat: pass minScoreThreshold and companySizeTargets to agent"
```

---

### Task 8: Update `create_lead` — derive letter grade from numeric score

**Files:**
- Modify: `src/lib/agent/nodes/create-lead.ts` (lines 53-66, 99-109)

**Step 1: Replace BANT scoring with numeric-to-letter derivation**

In `src/lib/agent/nodes/create-lead.ts`, replace the BANT scoring block (lines 53-66) with:

```typescript
  // Derive letter grade from numeric score
  const numericScore = state.currentScore?.total ?? 0;
  let score: string;
  if (numericScore >= 90) score = "A";
  else if (numericScore >= 75) score = "B";
  else score = "C";
```

**Step 2: Add scoring data to lead metadata**

Update the lead insert metadata (line 104-109) to include scoring:

```typescript
      metadata: {
        about: (dm.about as string) || null,
        scoring: state.currentScore ?? null,
        enriched_at: Object.values(dmEnrichment).some(v => v != null)
          ? new Date().toISOString()
          : null,
      },
```

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/create-lead.ts
git commit -m "feat: derive lead score from numeric scoring, store in metadata"
```

---

### Task 9: Add `score_lead` step config to agent feed

**Files:**
- Modify: `src/components/agent-feed.tsx` (lines 21-26)

**Step 1: Add score_lead to stepConfig**

Add after the `validate_profile` entry (line 24). You'll need to import `Target` from lucide-react (line 7):

```typescript
import { Square, Search, User, CheckCircle, ClipboardList, Zap, Target } from "lucide-react";
```

Add to `stepConfig`:
```typescript
  score_lead: { icon: Target, bg: "bg-cyan-100", text: "text-cyan-600" },
```

**Step 2: Commit**

```bash
git add src/components/agent-feed.tsx
git commit -m "feat: add score_lead step icon to agent feed"
```

---

### Task 10: Add `min_score_threshold` slider to Add Segment modal

**Files:**
- Modify: `src/components/add-segment-modal.tsx` (lines 68-237)

**Step 1: Add threshold state**

Add after `sizes` state (line 73):
```typescript
const [threshold, setThreshold] = useState(70);
```

Also add threshold to template type and presets — add to Template interface (line 17-25):
```typescript
interface Template {
  label: string;
  icon: React.ReactNode;
  name: string;
  description: string;
  roles: string[];
  terms: string[];
  sizes: CompanySize[];
  threshold: number;
}
```

Add `threshold: 70` to each template in `TEMPLATES` array and `applyTemplate` function:
```typescript
setThreshold(template.threshold);
```

**Step 2: Add slider UI**

Add after the "Termos de busca" field (line 218), before the error display:
```tsx
<div className="space-y-2">
  <Label htmlFor="seg-threshold">
    Score minimo de qualificacao: {threshold}/100
  </Label>
  <input
    id="seg-threshold"
    type="range"
    min={50}
    max={100}
    value={threshold}
    onChange={(e) => setThreshold(Number(e.target.value))}
    className="w-full accent-primary"
  />
  <p className="text-xs text-muted-foreground">
    Leads com score abaixo de {threshold} serao descartados automaticamente
  </p>
</div>
```

**Step 3: Pass threshold to `createSegment`**

Update the `handleConfirmCreate` call (line 118-124):
```typescript
await createSegment({
  name,
  description: description || undefined,
  target_roles: roles.split(",").map((s) => s.trim()).filter(Boolean),
  search_terms: terms.split(",").map((s) => s.trim()).filter(Boolean),
  company_size_targets: sizes,
  min_score_threshold: threshold,
});
```

**Step 4: Add threshold to resetState (line 136-145)**

```typescript
setThreshold(70);
```

**Step 5: Commit**

```bash
git add src/components/add-segment-modal.tsx
git commit -m "feat: add min_score_threshold slider to add segment modal"
```

---

### Task 11: Add `min_score_threshold` slider to Edit Segment modal

**Files:**
- Modify: `src/components/edit-segment-modal.tsx` (lines 26-105)

**Step 1: Add threshold state**

Add after `sizes` state (line 31):
```typescript
const [threshold, setThreshold] = useState(segment.min_score_threshold ?? 70);
```

**Step 2: Add slider UI**

Add after "Termos de busca" field (line 95), before error display:
```tsx
<div className="space-y-2">
  <Label htmlFor="edit-seg-threshold">
    Score minimo de qualificacao: {threshold}/100
  </Label>
  <input
    id="edit-seg-threshold"
    type="range"
    min={50}
    max={100}
    value={threshold}
    onChange={(e) => setThreshold(Number(e.target.value))}
    className="w-full accent-primary"
  />
  <p className="text-xs text-muted-foreground">
    Leads com score abaixo de {threshold} serao descartados automaticamente
  </p>
</div>
```

**Step 3: Pass threshold to `updateSegment`**

Update the `handleSubmit` call (line 46-53):
```typescript
await updateSegment({
  id: segment.id,
  name,
  description: description || undefined,
  target_roles: roles.split(",").map((s) => s.trim()).filter(Boolean),
  search_terms: terms.split(",").map((s) => s.trim()).filter(Boolean),
  company_size_targets: sizes,
  min_score_threshold: threshold,
});
```

**Step 4: Commit**

```bash
git add src/components/edit-segment-modal.tsx
git commit -m "feat: add min_score_threshold slider to edit segment modal"
```

---

### Task 12: Update segment server actions — handle `min_score_threshold`

**Files:**
- Modify: `src/app/(app)/segments/actions.ts` (lines 7-31, 33-61)

**Step 1: Add `min_score_threshold` to createSegment parameter type**

Update the `createSegment` function parameter (line 7-13):
```typescript
export async function createSegment(data: {
  name: string;
  description?: string;
  target_roles: string[];
  search_terms: string[];
  company_size_targets: string[];
  min_score_threshold?: number;
}) {
```

**Step 2: Add `min_score_threshold` to updateSegment parameter type**

Update the `updateSegment` function parameter (line 33-40):
```typescript
export async function updateSegment(data: {
  id: string;
  name?: string;
  description?: string;
  target_roles?: string[];
  search_terms?: string[];
  company_size_targets?: string[];
  min_score_threshold?: number;
}) {
```

**Step 3: Commit**

```bash
git add src/app/(app)/segments/actions.ts
git commit -m "feat: handle min_score_threshold in segment server actions"
```

---

### Task 13: Update lead detail modal — show scoring dimensions

**Files:**
- Modify: `src/components/lead-detail-modal.tsx` (lines 28-164)

**Step 1: Add scoring section**

After the validation section (line 90) and before the message section, add a new scoring section:

```tsx
{(() => {
  const scoring = lead.metadata?.scoring as {
    total: number;
    dimensions: Record<string, { score: number; max: number; reason: string }>;
    justification: string;
  } | null;
  if (!scoring) return null;
  return (
    <>
      <Separator />
      <div>
        <h4 className="text-sm font-semibold mb-2">
          Qualificacao: {scoring.total}/100
        </h4>
        <div className="space-y-2 text-sm">
          {Object.entries(scoring.dimensions).map(([key, dim]) => (
            <div key={key} className="flex items-center gap-2">
              <div className="w-24 text-slate-500 capitalize">
                {key.replace("_", " ")}
              </div>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-indigo-500 rounded-full"
                  style={{ width: `${(dim.score / dim.max) * 100}%` }}
                />
              </div>
              <span className="text-xs text-slate-500 w-12 text-right">
                {dim.score}/{dim.max}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-500 mt-2 italic">{scoring.justification}</p>
      </div>
    </>
  );
})()}
```

**Step 2: Update score badge to show numeric score**

Update the score badge in the header (line 64):
```tsx
{lead.score && (
  <Badge>
    {lead.score}
    {(lead.metadata?.scoring as { total: number } | null)?.total
      ? ` (${(lead.metadata.scoring as { total: number }).total}/100)`
      : ""}
  </Badge>
)}
```

**Step 3: Commit**

```bash
git add src/components/lead-detail-modal.tsx
git commit -m "feat: show scoring dimensions and numeric score in lead detail"
```

---

### Task 14: Update lead card — show numeric score

**Files:**
- Modify: `src/components/lead-card.tsx` (lines 94-98)

**Step 1: Update score badge to include numeric score**

Replace lines 94-98:
```tsx
{lead.score && (
  <span className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${scoreColors[lead.score] ?? scoreColors.C}`}>
    {(lead.metadata?.scoring as { total: number } | null)?.total
      ? `${(lead.metadata.scoring as { total: number }).total}/100`
      : `Score: ${lead.score}`}
  </span>
)}
```

**Step 2: Commit**

```bash
git add src/components/lead-card.tsx
git commit -m "feat: show numeric score on lead card"
```

---

### Task 15: Update CLAUDE.md — document new node and migration

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update documentation**

1. Add `score-lead.ts` to the agent nodes in the Architecture tree
2. Add migration `008_add_segment_score_threshold.sql` to the Migrations list
3. Update the pipeline description to include `score_lead` step

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with score_lead node and migration 008"
```

---

### Task 16: End-to-end verification

**Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: No new errors

**Step 2: Run linter**

Run: `npm run lint`
Expected: No new warnings/errors

**Step 3: Run build**

Run: `npm run build`
Expected: Successful build

**Step 4: Fix any issues found**

**Step 5: Final commit if fixes needed**

```bash
git commit -m "fix: resolve build issues from lead scoring feature"
```
