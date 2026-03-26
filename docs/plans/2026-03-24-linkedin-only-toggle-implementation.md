# LinkedIn Only Toggle — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toggle to skip Google dork queries and search LinkedIn directly via Playwright.

**Architecture:** A `linkedinOnly` boolean flows from the prospect form → API route → agent state. `find_lead` and `triage_company` branch on this flag. No DB changes.

**Tech Stack:** Next.js, LangGraph.js, Zod, shadcn/ui Switch

---

### Task 1: Add `linkedinOnly` to AgentState

**Files:**
- Modify: `src/lib/agent/state.ts:86-98` (after `currentRoleIndex`)

**Step 1: Add the field**

Add after `currentRoleIndex` annotation (line 94):

```typescript
linkedinOnly: Annotation<boolean>({
  reducer: (_a, b) => b,
  default: () => false,
}),
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors (field is optional with default)

**Step 3: Commit**

```bash
git add src/lib/agent/state.ts
git commit -m "feat: add linkedinOnly field to AgentState"
```

---

### Task 2: Add `linkedin_only` to Zod schema

**Files:**
- Modify: `src/lib/validations/schemas.ts:12-29`

**Step 1: Add `linkedin_only` to both variants**

Add `linkedin_only: z.boolean().default(false),` to both objects in the discriminated union. Place it after `min_score_threshold` in each:

```typescript
export const prospectRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("companies"),
    quantity: z.number().int().min(1).max(20),
    company_ids: z.array(z.string().uuid()).min(1).max(50),
    target_roles: z.array(z.string().min(1)).min(1),
    min_score_threshold: z.number().int().min(0).max(100).default(70),
    linkedin_only: z.boolean().default(false),
  }),
  z.object({
    mode: z.literal("open"),
    region: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
    target_roles: z.array(z.string().min(1)).min(1),
    min_score_threshold: z.number().int().min(0).max(100).default(70),
    linkedin_only: z.boolean().default(false),
  }),
]);
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "feat: add linkedin_only to prospect request schema"
```

---

### Task 3: Pass `linkedinOnly` from API route to graph

**Files:**
- Modify: `src/app/api/prospect/route.ts:112-124`

**Step 1: Add `linkedinOnly` to graph.stream initial state**

In the `graph.stream()` call (line 112), add `linkedinOnly` to the state object:

```typescript
const eventStream = await graph.stream(
  {
    region: region,
    quantity: parsed.data.quantity,
    targetRoles: parsed.data.target_roles,
    searchTerms: [],
    companySizeTargets: [],
    minScoreThreshold: parsed.data.min_score_threshold ?? 70,
    companyProfile: companyProfile ?? null,
    targetCompanies: targetCompanies,
    linkedinOnly: parsed.data.linkedin_only ?? false,
    runId: run!.id,
    userId: user.id,
  },
  { recursionLimit: 300, streamMode: "updates", signal: abortSignal }
);
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "feat: pass linkedinOnly from API route to agent graph"
```

---

### Task 4: Update `find-lead.ts` — LinkedIn Only logic

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts:86-311`

**Step 1: Add LinkedIn-only branch for company mode**

Inside the company-first block (after line 100, where `role` is defined), add a LinkedIn-only fast path before the Google dork query:

```typescript
// Inside the company-first block, after role is defined (line 99):

if (state.linkedinOnly) {
  // LinkedIn Only: skip Google dork, go directly to LinkedIn search
  log.message = `[LinkedIn Only] Buscando "${role}" na empresa: ${targetCompany.name}...`;

  const keywords = `${role} ${targetCompany.name}`;
  const candidates = await searchPeople(keywords, undefined, state.userId);

  for (const candidate of candidates) {
    const url = normalizeLinkedInUrl(candidate.linkedinUrl);
    const isDuplicate = await isAlreadyProcessed(url, state.userId, state.companiesSearched);
    if (isDuplicate) continue;

    const nextCompanyIdx = companyIdx + 1;
    const wrapped = nextCompanyIdx >= state.targetCompanies.length;

    return {
      currentCompany: {
        name: targetCompany.name,
        linkedinUrl: null,
        website: targetCompany.website,
      },
      currentDecisionMaker: {
        name: candidate.name,
        role: candidate.role,
        linkedinUrl: url,
        company: targetCompany.name,
      },
      currentCompanyIndex: wrapped ? 0 : nextCompanyIdx,
      currentRoleIndex: wrapped ? state.currentRoleIndex + 1 : state.currentRoleIndex,
      companiesSearched: [...state.companiesSearched, url],
      log: [{ ...log, message: `[LinkedIn Only] Encontrado (${targetCompany.name}, ${role}): ${candidate.name} - ${candidate.role} (${url})` }],
    };
  }

  // No candidate found via LinkedIn
  const nextCompanyIdx = companyIdx + 1;
  const wrapped = nextCompanyIdx >= state.targetCompanies.length;

  return {
    currentCompany: null,
    currentDecisionMaker: null,
    currentCompanyIndex: wrapped ? 0 : nextCompanyIdx,
    currentRoleIndex: wrapped ? state.currentRoleIndex + 1 : state.currentRoleIndex,
    searchRetries: state.searchRetries + 1,
    log: [{ ...log, message: `[LinkedIn Only] Nenhum lead "${role}" em ${targetCompany.name}, avançando...` }],
  };
}
```

**Step 2: Add LinkedIn-only branch for open mode**

After the company-first block closes (around line 182), add a LinkedIn-only fast path for open mode before the existing Google dork logic:

```typescript
// After the company-first block (line 184), before "Priority 1":

if (state.linkedinOnly) {
  // LinkedIn Only open mode: skip all Google queries
  log.message = "[LinkedIn Only] Buscando diretamente no LinkedIn...";

  for (const role of state.targetRoles) {
    const keywords = `${role} ${state.searchTerms.join(" ")}`.trim();
    const candidates = await searchPeople(keywords, state.region || undefined, state.userId);

    for (const candidate of candidates) {
      const url = normalizeLinkedInUrl(candidate.linkedinUrl);
      const isDuplicate = await isAlreadyProcessed(url, state.userId, state.companiesSearched);
      if (isDuplicate) continue;

      return {
        currentCompany: {
          name: candidate.company,
          linkedinUrl: null,
          website: null,
        },
        currentDecisionMaker: {
          name: candidate.name,
          role: candidate.role,
          linkedinUrl: url,
          company: candidate.company,
        },
        companiesSearched: [...state.companiesSearched, url],
        log: [{ ...log, message: `[LinkedIn Only] Encontrado: ${candidate.name} - ${candidate.role} (${url})` }],
      };
    }
  }

  return {
    currentCompany: null,
    currentDecisionMaker: null,
    searchRetries: state.searchRetries + 1,
    log: [{ ...log, message: `[LinkedIn Only] Nenhum lead novo encontrado (tentativa ${state.searchRetries + 1})` }],
  };
}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "feat: add LinkedIn Only mode to find-lead node"
```

---

### Task 5: Update `triage-company.ts` — Simplified triage

**Files:**
- Modify: `src/lib/agent/nodes/triage-company.ts:95-215`

**Step 1: Add LinkedIn-only early return**

After the existing "skip triage in company-first mode" check (line 115), add a block for linkedinOnly:

```typescript
// After the company-first skip block (line 115), before "skip if no company name":

// Simplified triage in LinkedIn Only mode: only check rejected_companies DB
if (state.linkedinOnly) {
  if (!companyName) {
    return {
      companyTriage: { pass: true, reason: "Sem nome de empresa para triar", employeeEstimate: "", sector: "" },
      log: [{ ...log, message: "[LinkedIn Only] Triagem pulada: sem nome de empresa" }],
    };
  }

  try {
    const previousReason = await isCompanyRejected(companyName, state.userId);
    if (previousReason) {
      return {
        companyTriage: { pass: false, reason: previousReason, employeeEstimate: "", sector: "" },
        log: [{ ...log, message: `[LinkedIn Only] Triagem empresa: ${companyName} — REPROVADA (já rejeitada: ${previousReason})` }],
      };
    }
  } catch {
    // DB check failed, let it pass
  }

  return {
    companyTriage: { pass: true, reason: "LinkedIn Only: triagem simplificada", employeeEstimate: "", sector: "" },
    log: [{ ...log, message: `[LinkedIn Only] Triagem empresa: ${companyName} — APROVADA (triagem simplificada)` }],
  };
}
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/triage-company.ts
git commit -m "feat: add simplified triage for LinkedIn Only mode"
```

---

### Task 6: Add Switch toggle to prospect form

**Files:**
- Modify: `src/components/prospect-form.tsx`

**Step 1: Add import for Switch**

Add to the imports at the top of the file:

```typescript
import { Switch } from "@/components/ui/switch";
```

**Step 2: Add state**

Add after the `loadingCompanies` state (line 46):

```typescript
const [linkedinOnly, setLinkedinOnly] = useState(false);
```

**Step 3: Add `linkedin_only` to the request body**

In `handleSubmit`, add `linkedin_only: linkedinOnly` to both body variants:

```typescript
const body =
  mode === "companies"
    ? {
        mode: "companies" as const,
        quantity,
        company_ids: Array.from(selectedIds),
        target_roles: roles,
        min_score_threshold: minScore,
        linkedin_only: linkedinOnly,
      }
    : {
        mode: "open" as const,
        region,
        quantity,
        target_roles: roles,
        min_score_threshold: minScore,
        linkedin_only: linkedinOnly,
      };
```

**Step 4: Add the Switch component to both tabs**

Add the toggle above the submit button in both TabsContent sections. Place it just before the `<Button>` in each form:

```tsx
<div className="flex items-center justify-between py-2">
  <Label htmlFor="linkedin-only" className="text-sm text-slate-600">
    Buscar direto no LinkedIn
  </Label>
  <Switch
    id="linkedin-only"
    checked={linkedinOnly}
    onCheckedChange={setLinkedinOnly}
  />
</div>
```

Note: The Switch `id` should be unique per tab if needed, but since only one tab renders at a time, the same id is fine.

**Step 5: Verify the Switch component exists**

Check if `src/components/ui/switch.tsx` exists. If not, run:

```bash
npx shadcn@latest add switch
```

**Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Commit**

```bash
git add src/components/prospect-form.tsx src/components/ui/switch.tsx
git commit -m "feat: add LinkedIn Only toggle to prospect form"
```

---

### Task 7: Manual test and final commit

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test the toggle**

1. Go to the prospect page
2. Verify the "Buscar direto no LinkedIn" switch appears in both tabs
3. Toggle it on, fill in the form, and start a prospecting run
4. Verify logs show `[LinkedIn Only]` prefix
5. Verify no Google/Serper calls are made (check server console)
6. Toggle it off and verify normal behavior resumes

**Step 3: Build check**

Run: `npm run build`
Expected: Build succeeds
