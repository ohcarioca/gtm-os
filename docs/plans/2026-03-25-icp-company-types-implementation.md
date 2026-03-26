# ICP Company Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When user saves ICP in settings, LLM extracts company types; these appear as selectable chips in the open prospecting form and are used to focus dork queries.

**Architecture:** New `icp_company_types text[]` column on `company_profiles`. Server Action calls Claude CLI (Haiku) on ICP save. Prospect form fetches types via Server Action and renders chips. Selected types passed to agent state and injected into dork query prompt.

**Tech Stack:** Supabase (migration), Claude CLI (Haiku), Next.js Server Actions, React (chips UI), LangGraph state

---

### Task 1: Database migration — add `icp_company_types` column

**Files:**
- Create: `supabase/migrations/014_add_icp_company_types.sql`

**Step 1: Write the migration**

```sql
-- Add icp_company_types array to company_profiles
ALTER TABLE company_profiles
  ADD COLUMN IF NOT EXISTS icp_company_types text[] DEFAULT '{}';
```

**Step 2: Apply the migration**

Run: `npx supabase db push` or apply via Supabase dashboard.

**Step 3: Commit**

```bash
git add supabase/migrations/014_add_icp_company_types.sql
git commit -m "feat: add icp_company_types column to company_profiles"
```

---

### Task 2: Update TypeScript types and Zod schema

**Files:**
- Modify: `src/lib/types/database.ts:76-85` (CompanyProfile interface)

**Step 1: Add `icp_company_types` to CompanyProfile interface**

In `src/lib/types/database.ts`, add the field to the `CompanyProfile` interface:

```typescript
export interface CompanyProfile {
  id: string;
  user_id: string;
  name: string;
  sector: string;
  value_proposition: string;
  icp: string;
  icp_company_types: string[];
  created_at: string;
  updated_at: string;
}
```

**Step 2: Commit**

```bash
git add src/lib/types/database.ts
git commit -m "feat: add icp_company_types to CompanyProfile type"
```

---

### Task 3: Generate company types on ICP save (Server Action)

**Files:**
- Modify: `src/app/(app)/settings/actions.ts:29-49` (saveCompanyProfile function)

**Step 1: Update `saveCompanyProfile` to generate types via Claude CLI**

Add import for `callClaudeJSON` and `z` at the top of `src/app/(app)/settings/actions.ts`:

```typescript
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";
```

Then modify the `saveCompanyProfile` function. After validation, before the upsert, add LLM type generation:

```typescript
export async function saveCompanyProfile(formData: FormData) {
  const parsed = companyProfileSchema.safeParse({
    name: String(formData.get("company_name") ?? ""),
    sector: String(formData.get("sector") ?? ""),
    value_proposition: String(formData.get("value_proposition") ?? ""),
    icp: String(formData.get("icp") ?? ""),
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(", "));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Check if ICP text changed (skip LLM call if unchanged)
  const { data: existing } = await supabase
    .from("company_profiles")
    .select("icp, icp_company_types")
    .eq("user_id", user.id)
    .single();

  let icpCompanyTypes: string[] = existing?.icp_company_types ?? [];

  // Only regenerate if ICP text changed or no types exist yet
  if (!existing || existing.icp !== parsed.data.icp || icpCompanyTypes.length === 0) {
    try {
      const prompt = `Dado este Perfil de Cliente Ideal (ICP): "${parsed.data.icp}"
Setor da empresa: "${parsed.data.sector}"

Liste 5-10 tipos/categorias de empresa que se encaixam neste ICP.
Exemplos de formato: "Fintechs", "Bancos digitais", "Empresas de cobrança", "Operadoras de telecom"

Retorne JSON: {"types": ["tipo1", "tipo2", ...]}`;

      const result = await callClaudeJSON(
        prompt,
        z.object({ types: z.array(z.string().min(1)).min(1).max(10) }),
        { timeout: 30_000, model: "haiku" }
      );
      icpCompanyTypes = result.types;
    } catch (err) {
      console.warn("[settings] Failed to generate ICP company types:", err);
      // Keep existing types or empty — don't block save
    }
  }

  const { error } = await supabase.from("company_profiles").upsert({
    user_id: user.id,
    ...parsed.data,
    icp_company_types: icpCompanyTypes,
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
```

**Step 2: Verify the settings page still works**

Run: `npm run dev`, go to Settings, save a company profile with ICP text. Check that `icp_company_types` is populated in the database.

**Step 3: Commit**

```bash
git add src/app/(app)/settings/actions.ts
git commit -m "feat: generate ICP company types via Claude CLI on profile save"
```

---

### Task 4: Server Action to fetch and update company types

**Files:**
- Modify: `src/app/(app)/settings/actions.ts` (add new exported functions)

**Step 1: Add `getCompanyProfile` and `addCompanyType` Server Actions**

Append to `src/app/(app)/settings/actions.ts`:

```typescript
export async function getCompanyProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("company_profiles")
    .select("icp_company_types")
    .eq("user_id", user.id)
    .single();

  return data as { icp_company_types: string[] } | null;
}

export async function addCompanyType(type: string) {
  const trimmed = type.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("Tipo inválido");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("company_profiles")
    .select("icp_company_types")
    .eq("user_id", user.id)
    .single();

  if (!profile) throw new Error("Perfil não encontrado. Salve o ICP primeiro.");

  const existing: string[] = profile.icp_company_types ?? [];
  if (existing.includes(trimmed)) return; // Already exists

  const { error } = await supabase
    .from("company_profiles")
    .update({ icp_company_types: [...existing, trimmed] })
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}
```

**Step 2: Commit**

```bash
git add src/app/(app)/settings/actions.ts
git commit -m "feat: add getCompanyProfile and addCompanyType server actions"
```

---

### Task 5: Company type chips UI in prospect form

**Files:**
- Modify: `src/components/prospect-form.tsx` (open mode section, lines 280-333)

**Step 1: Add state and fetch for company types**

Add imports at the top of `src/components/prospect-form.tsx`:

```typescript
import { getCompanyProfile, addCompanyType } from "@/app/(app)/settings/actions";
import { X, Plus } from "lucide-react";
```

Add state inside `ProspectForm` component (after existing state declarations around line 48):

```typescript
// ICP company types state
const [companyTypes, setCompanyTypes] = useState<string[]>([]);
const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
const [newType, setNewType] = useState("");
const [loadingTypes, setLoadingTypes] = useState(false);
```

Add useEffect to fetch types when open mode is selected (after existing useEffect around line 68):

```typescript
useEffect(() => {
  if (mode === "open") {
    setLoadingTypes(true);
    getCompanyProfile()
      .then((profile) => {
        const types = profile?.icp_company_types ?? [];
        setCompanyTypes(types);
        setSelectedTypes(new Set(types)); // All selected by default
      })
      .catch(() => {
        setCompanyTypes([]);
        setSelectedTypes(new Set());
      })
      .finally(() => setLoadingTypes(false));
  }
}, [mode]);
```

Add handler functions (after `parseList` function around line 104):

```typescript
function handleToggleType(type: string) {
  setSelectedTypes((prev) => {
    const next = new Set(prev);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    return next;
  });
}

async function handleAddType() {
  const trimmed = newType.trim();
  if (!trimmed || companyTypes.includes(trimmed)) {
    setNewType("");
    return;
  }
  try {
    await addCompanyType(trimmed);
    setCompanyTypes((prev) => [...prev, trimmed]);
    setSelectedTypes((prev) => new Set([...prev, trimmed]));
    setNewType("");
  } catch {
    // Silently fail — user can retry
  }
}

function handleTypeKeyDown(e: React.KeyboardEvent) {
  if (e.key === "Enter" || e.key === ",") {
    e.preventDefault();
    handleAddType();
  }
}
```

**Step 2: Add chip UI in the open mode tab**

In the open mode `<TabsContent value="open">` section (around line 280), add the company types section after the "Região" input and before the score/quantity grid. Insert this JSX:

```tsx
{/* ICP Company Types */}
{companyTypes.length > 0 && (
  <div className="space-y-2">
    <Label>Tipos de Empresa (ICP)</Label>
    <div className="flex flex-wrap gap-2">
      {companyTypes.map((type) => (
        <button
          key={type}
          type="button"
          onClick={() => handleToggleType(type)}
          className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm border transition-colors ${
            selectedTypes.has(type)
              ? "bg-indigo-100 border-indigo-300 text-indigo-700"
              : "bg-slate-50 border-slate-200 text-slate-400 line-through"
          }`}
        >
          {type}
          {selectedTypes.has(type) && (
            <X className="h-3 w-3" />
          )}
        </button>
      ))}
    </div>
    <div className="flex gap-2">
      <Input
        value={newType}
        onChange={(e) => setNewType(e.target.value)}
        onKeyDown={handleTypeKeyDown}
        placeholder="Adicionar tipo..."
        className="flex-1"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleAddType}
        disabled={!newType.trim()}
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
    <p className="text-xs text-slate-400">Gerados pelo ICP nas configurações. Desmarque os que não quer nesta busca.</p>
  </div>
)}
```

**Step 3: Include selected types in the request body**

In the `handleSubmit` function, update the open mode body (around line 124-131) to include `company_types`:

```typescript
: {
    mode: "open" as const,
    region,
    quantity,
    target_roles: roles,
    min_score_threshold: minScore,
    linkedin_only: linkedinOnly,
    company_types: Array.from(selectedTypes),
  };
```

**Step 4: Verify the form renders correctly**

Run: `npm run dev`, go to Prospect page, click "Aberto" tab. If ICP has types saved, chips should appear.

**Step 5: Commit**

```bash
git add src/components/prospect-form.tsx
git commit -m "feat: add ICP company type chips to open prospect form"
```

---

### Task 6: Update Zod schema and API route to pass company types to agent

**Files:**
- Modify: `src/lib/validations/schemas.ts:22-31` (open mode schema)
- Modify: `src/lib/agent/state.ts` (add companyTypes to state)
- Modify: `src/app/api/prospect/route.ts:112-125` (pass companyTypes to graph)

**Step 1: Add `company_types` to open mode Zod schema**

In `src/lib/validations/schemas.ts`, update the open mode object (line 22-31):

```typescript
z.object({
  mode: z.literal("open"),
  region: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(20),
  target_roles: z.array(z.string().min(1)).min(1),
  min_score_threshold: z.number().int().min(0).max(100).default(70),
  linkedin_only: z.boolean().default(false),
  company_types: z.array(z.string()).default([]),
}),
```

**Step 2: Add `companyTypes` to agent state**

In `src/lib/agent/state.ts`, add after the `linkedinOnly` annotation (after line 99):

```typescript
companyTypes: Annotation<string[]>({
  reducer: (_a, b) => b,
  default: () => [],
}),
```

**Step 3: Pass `companyTypes` from API route to graph**

In `src/app/api/prospect/route.ts`, update the graph stream input (around line 112-125). Add `companyTypes` field:

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
    companyTypes: parsed.data.mode === "open" ? (parsed.data.company_types ?? []) : [],
    runId: run!.id,
    userId: user.id,
  },
  { recursionLimit: 300, streamMode: "updates", signal: abortSignal }
);
```

**Step 4: Verify build passes**

Run: `npm run build`
Expected: No type errors.

**Step 5: Commit**

```bash
git add src/lib/validations/schemas.ts src/lib/agent/state.ts src/app/api/prospect/route.ts
git commit -m "feat: pass company_types through schema, state, and API route"
```

---

### Task 7: Use company types in dork query generation

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts:51-84` (buildDorkQueries function)

**Step 1: Update `buildDorkQueries` to use `companyTypes`**

Modify the `buildDorkQueries` function in `src/lib/agent/nodes/find-lead.ts`. When `companyTypes` is non-empty, inject them into the prompt instead of relying solely on the raw ICP text:

```typescript
async function buildDorkQueries(state: AgentStateType): Promise<string[]> {
  const companyTypesStr = state.companyTypes.length > 0
    ? `\n- PRIORITY: The user selected these specific company types to target: ${state.companyTypes.join(", ")}. Every query MUST include keywords related to these company types.`
    : "";

  const prompt = `You are a Google dork expert for LinkedIn prospecting.

Context:
- Target roles: ${state.targetRoles.join(", ")}
- Search terms/sector: ${state.searchTerms.join(", ")}
- Region: ${state.region}
- Company profile: ${state.companyProfile ? JSON.stringify(state.companyProfile) : "N/A"}
- Already found: ${state.companiesSearched.length} leads (avoid repetition)

Generate 5-8 Google dork queries to find LinkedIn profiles of decision-makers.

Rules:
- All queries MUST start with site:linkedin.com/in
- CRITICAL: Every query MUST include sector/industry keywords from the ICP to filter for relevant companies. Never search just role + region — always include industry terms.${companyTypesStr}${state.companyProfile && state.companyTypes.length === 0 ? `\n- The ICP targets: ${state.companyProfile.icp}. Use sector keywords like "${state.companyProfile.sector}" and related industry terms in EVERY query.` : ""}
- Include Portuguese AND English role variations (e.g., "Diretor de Tecnologia" AND "CTO")
- Use city names from the region, including abbreviations (SP, RJ, etc.)
- Use OR operator for role variations in single queries
- Vary specificity: some precise, some broader for discovery
- Use company-type keywords (e.g., "fintech", "healthtech", "varejo", "e-commerce") to filter by industry

Return JSON: {"queries": ["query1", "query2", ...]}`;

  try {
    const result = await callClaudeJSON(prompt, dorkQueriesSchema, { timeout: 60_000, model: "haiku" });
    return result.queries;
  } catch (err) {
    console.error("[find-lead] Dork query generation failed, using fallback:", err);
    // Fallback: use company types as search terms if available
    const typeTerms = state.companyTypes.length > 0
      ? state.companyTypes.slice(0, 3).join(" OR ")
      : state.searchTerms.join(" ");
    return state.targetRoles.flatMap((role) => [
      `site:linkedin.com/in "${role}" ${typeTerms} "${state.region}"`,
      `site:linkedin.com/in "${role}" "${state.region}"`,
    ]);
  }
}
```

**Step 2: Also use company types in LinkedIn direct search fallback**

In the LinkedIn direct search section (around line 345-373), update the keywords to include company types:

In the Priority 3 section, update the keywords variable:

```typescript
const typeHint = state.companyTypes.length > 0 ? ` ${state.companyTypes[0]}` : "";
const keywords = `${role} ${state.searchTerms.join(" ")}${typeHint}`;
```

**Step 3: Verify build passes**

Run: `npm run build`
Expected: No type errors.

**Step 4: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "feat: use ICP company types in dork query generation"
```

---

### Task 8: Update CLAUDE.md and display types in settings page

**Files:**
- Modify: `CLAUDE.md` (add migration 014, update Key Files)
- Modify: `src/app/(app)/settings/page.tsx` (show saved types)

**Step 1: Show saved company types in settings page**

In `src/app/(app)/settings/page.tsx`, after the profile success message (line 59-63), add a display of saved types. Update the success message block:

```tsx
{typedProfile && (
  <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800 mb-6">
    <p>Perfil salvo — {typedProfile.name}</p>
    {typedProfile.icp_company_types && typedProfile.icp_company_types.length > 0 && (
      <div className="flex flex-wrap gap-1 mt-2">
        <span className="text-green-600 text-xs">Tipos de empresa:</span>
        {typedProfile.icp_company_types.map((type: string) => (
          <span key={type} className="inline-block bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full">
            {type}
          </span>
        ))}
      </div>
    )}
  </div>
)}
```

**Step 2: Update CLAUDE.md**

Add migration 014 to the migrations list:
```
14. `014_add_icp_company_types.sql` — ICP company types array for company_profiles
```

Add the design doc to Key Files:
```
- `docs/plans/2026-03-25-icp-company-types-design.md` — ICP company types for open prospecting
- `docs/plans/2026-03-25-icp-company-types-implementation.md` — ICP company types implementation plan
```

Update the Agent Pipeline section to mention company types:
```
- `find_lead` uses company types (from ICP) to focus dork queries when in open mode.
```

**Step 3: Commit**

```bash
git add CLAUDE.md src/app/(app)/settings/page.tsx
git commit -m "feat: display ICP company types in settings, update CLAUDE.md"
```

---

### Task 9: End-to-end verification

**Step 1: Test the full flow**

1. Go to Settings, fill in ICP text (e.g., "Empresas de telecom, fintechs e bancos digitais com mais de 500 funcionários"), save
2. Check database: `icp_company_types` should have values like `["Fintechs", "Bancos digitais", "Operadoras de telecom"]`
3. Go to Prospect > Aberto tab — chips should appear with all types selected
4. Deselect some types, add a custom type
5. Start prospecting — check agent logs for dork queries containing the selected types
6. Verify custom type was persisted (refresh page, type should still be there)

**Step 2: Run build**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 3: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues from e2e verification"
```
