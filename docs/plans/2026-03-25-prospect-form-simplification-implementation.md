# Prospect Form Simplification — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two-tab prospect form with a single form using two radio groups (method + scope) and conditional sections.

**Architecture:** Update Zod schema → adapt API route → rewrite form component. The LangGraph pipeline stays untouched — the API route maps new fields to existing state shape.

**Tech Stack:** Next.js 14, TypeScript, Zod, shadcn/ui, Tailwind CSS

---

### Task 1: Update Zod schema

**Files:**
- Modify: `src/lib/validations/schemas.ts:12-32`

**Step 1: Replace `prospectRequestSchema`**

Replace the current discriminated union (lines 12-32) with:

```ts
export const prospectRequestSchema = z.discriminatedUnion("scope", [
  z.object({
    method: z.enum(["full", "linkedin_direct"]),
    scope: z.literal("companies"),
    quantity: z.number().int().min(1).max(20),
    company_ids: z.array(z.string().uuid()).min(1).max(50),
    target_roles: z.array(z.string().min(1)).min(1),
    min_score_threshold: z.number().int().min(0).max(100).default(70),
  }),
  z.object({
    method: z.enum(["full", "linkedin_direct"]),
    scope: z.literal("icp"),
    region: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
    target_roles: z.array(z.string().min(1)).min(1),
    min_score_threshold: z.number().int().min(0).max(100).default(70),
    company_types: z.array(z.string()).default([]),
  }),
]);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Type errors in `src/app/api/prospect/route.ts` (uses old `mode`/`linkedin_only` fields). That's expected — we fix it in Task 2.

**Step 3: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "refactor: update prospect schema with method/scope fields"
```

---

### Task 2: Adapt API route

**Files:**
- Modify: `src/app/api/prospect/route.ts:51-127`

**Step 1: Update payload mapping**

Replace the current mode-based logic (lines 51-85 and 112-127) to map from new schema fields. Key changes:

1. Replace `parsed.data.mode === "companies"` checks with `parsed.data.scope === "companies"`
2. Replace `parsed.data.linkedin_only` with `parsed.data.method === "linkedin_direct"`
3. Replace `parsed.data.mode === "open"` with `parsed.data.scope === "icp"`
4. In the `graph.stream()` call, change:
   - `region`: use `parsed.data.scope === "icp" ? parsed.data.region : ""`
   - `linkedinOnly`: use `parsed.data.method === "linkedin_direct"`
   - `companyTypes`: use `parsed.data.scope === "icp" ? (parsed.data.company_types ?? []) : []`

The full graph.stream input block becomes:

```ts
{
  region: parsed.data.scope === "icp" ? parsed.data.region : "",
  quantity: parsed.data.quantity,
  targetRoles: parsed.data.target_roles,
  searchTerms: [],
  companySizeTargets: [],
  minScoreThreshold: parsed.data.min_score_threshold ?? 70,
  companyProfile: companyProfile ?? null,
  targetCompanies: targetCompanies,
  linkedinOnly: parsed.data.method === "linkedin_direct",
  companyTypes: parsed.data.scope === "icp" ? (parsed.data.company_types ?? []) : [],
  runId: run!.id,
  userId: user.id,
}
```

Similarly update the company-fetching block:

```ts
if (parsed.data.scope === "companies") {
  const { data: selectedCompanies } = await supabase
    .from("prospect_companies")
    .select("id, name, website")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .in("id", parsed.data.company_ids);

  targetCompanies = shuffle(
    (selectedCompanies ?? []).map((c: { id: string; name: string; website: string | null }) => ({
      id: c.id, name: c.name, website: c.website,
    }))
  );
} else {
  const { data: approvedCompanies } = await supabase
    .from("prospect_companies")
    .select("id, name, website")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("icp_score", { ascending: false });

  targetCompanies = (approvedCompanies ?? []).map((c: { id: string; name: string; website: string | null }) => ({
    id: c.id, name: c.name, website: c.website,
  }));
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Type errors in `prospect-form.tsx` (sends old payload shape). Expected — we fix it in Task 3.

**Step 3: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "refactor: adapt prospect API route to method/scope schema"
```

---

### Task 3: Rewrite prospect form

**Files:**
- Modify: `src/components/prospect-form.tsx` (full rewrite)

**Step 1: Rewrite the form**

Replace the entire component. Key structural changes:

- Remove `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` imports
- Remove `mode` state → add `method` (`"full" | "linkedin_direct"`) and `scope` (`"companies" | "icp"`) state
- Remove `linkedinOnly` state (replaced by `method`)
- Remove `newType`, `handleAddType`, `handleTypeKeyDown` (inline add removed)
- Keep: company list, sector filter, ICP type chips (read-only toggle), cargos-alvo, score, quantity

Layout structure:

```tsx
<Card>
  <CardHeader><CardTitle>Nova Prospecção</CardTitle></CardHeader>
  <CardContent>
    <form onSubmit={handleSubmit} className="space-y-5">

      {/* Method radio group */}
      <div className="space-y-2">
        <Label>Método de busca</Label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setMethod("full")}
            className={`rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
              method === "full" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            <p className="font-medium">Busca completa</p>
            <p className="text-xs text-slate-400 mt-0.5">Google + LinkedIn + Firecrawl</p>
          </button>
          <button type="button" onClick={() => setMethod("linkedin_direct")}
            className={`rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
              method === "linkedin_direct" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            <p className="font-medium">LinkedIn direto</p>
            <p className="text-xs text-slate-400 mt-0.5">LinkedIn + Firecrawl</p>
          </button>
        </div>
      </div>

      {/* Scope radio group */}
      <div className="space-y-2">
        <Label>Escopo</Label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setScope("companies")}
            className={`rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
              scope === "companies" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            <p className="font-medium">Empresas aprovadas</p>
          </button>
          <button type="button" onClick={() => setScope("icp")}
            className={`rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
              scope === "icp" ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
            }`}>
            <p className="font-medium">Tipo ICP</p>
          </button>
        </div>
      </div>

      {/* Conditional: companies list (when scope=companies) */}
      {scope === "companies" && (
        <>
          {/* Sector filter + company checkboxes — same as current */}
        </>
      )}

      {/* Conditional: ICP types + region (when scope=icp) */}
      {scope === "icp" && (
        <>
          {/* ICP type chips (toggle only, no add) */}
          {/* Region input */}
        </>
      )}

      {/* Fixed fields */}
      {/* Cargos-alvo */}
      {/* Score mínimo + Quantidade (grid cols 2) */}
      {/* Submit button */}
    </form>
  </CardContent>
</Card>
```

Update `handleSubmit` to build new payload shape:

```ts
const body = scope === "companies"
  ? {
      method,
      scope: "companies" as const,
      quantity,
      company_ids: Array.from(selectedIds),
      target_roles: roles,
      min_score_threshold: minScore,
    }
  : {
      method,
      scope: "icp" as const,
      region,
      quantity,
      target_roles: roles,
      min_score_threshold: minScore,
      company_types: Array.from(selectedTypes),
    };
```

Update `canSubmit` logic:

```ts
const canSubmit = hasRoles && (scope === "companies" ? selectedIds.size > 0 : region.length > 0);
```

Remove unused imports: `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`, `Switch`, `Linkedin`, `Plus`, `X`.

Keep imports: `Building2`, `Search` (for scope button icons if desired), `Checkbox`, `Badge`, `Select*`.

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS — all three files aligned on new schema.

**Step 3: Verify dev server**

Run: `npm run dev`
Navigate to `/prospect` and verify:
- Method radio group works (visual toggle)
- Scope radio group works (shows/hides correct section)
- Companies list loads when scope=companies
- ICP chips load when scope=icp
- Form submits with correct payload

**Step 4: Commit**

```bash
git add src/components/prospect-form.tsx
git commit -m "feat: simplify prospect form with method/scope radio groups"
```

---

### Task 4: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update references**

- Add this design doc to Key Files section
- Update the prospect form description in Architecture section if needed

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add prospect form simplification to CLAUDE.md"
```
