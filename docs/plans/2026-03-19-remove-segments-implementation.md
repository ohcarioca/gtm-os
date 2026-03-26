# Remove Segments — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove segments as a CRUD entity. Move prospecting parameters (target_roles, search_terms, min_score_threshold) directly into the prospect form. Filter companies by sector instead of segment.

**Architecture:** Delete segments page/components, update prospect form to include inline fields, update API route to accept parameters directly instead of segment lookup, update agent state, remove segment_id FKs from pipeline inserts.

**Tech Stack:** Same stack, just removing complexity.

---

### Task 1: Update Zod schema — remove segment, add inline fields

**Files:**
- Modify: `src/lib/validations/schemas.ts`

**Step 1: Replace `prospectRequestSchema`**

Replace the current discriminated union with one that has inline fields instead of segment_id:

```typescript
export const prospectRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("companies"),
    quantity: z.number().int().min(1).max(20),
    company_ids: z.array(z.string().uuid()).min(1).max(50),
    target_roles: z.array(z.string().min(1)).min(1),
    search_terms: z.array(z.string().min(1)).min(1),
    min_score_threshold: z.number().int().min(0).max(100).default(70),
  }),
  z.object({
    mode: z.literal("open"),
    region: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
    target_roles: z.array(z.string().min(1)).min(1),
    search_terms: z.array(z.string().min(1)).min(1),
    min_score_threshold: z.number().int().min(0).max(100).default(70),
  }),
]);
```

**Step 2: Remove segment-only schemas**

Delete `createSegmentSchema`, `updateSegmentSchema`, and their type exports (`CreateSegmentInput`, `UpdateSegmentInput`).

**Step 3: Remove segment_id from company schemas**

In `companyDiscoveryRequestSchema`, remove the `segment_id` field.
In `createProspectCompanySchema`, remove the `segment_id` field.
In `importProspectCompaniesSchema`, remove the `segment_id` field.

**Step 4: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "refactor: remove segment schemas, add inline prospect fields"
```

---

### Task 2: Update API route — inline parameters

**Files:**
- Modify: `src/app/api/prospect/route.ts`

**Step 1: Remove segment fetch**

Delete the segment fetch block:
```typescript
const { data: segment } = await supabase
  .from("segments")
  .select("*")
  .eq("id", parsed.data.segment_id)
  .single();
if (!segment) return new Response("Segment not found", { status: 404 });
```

**Step 2: Update agent_runs insert**

Remove `segment_id` from the insert. Change to:
```typescript
const { data: run } = await supabase.from("agent_runs").insert({
  user_id: user.id,
  region: region || "empresas-alvo",
  quantity: parsed.data.quantity,
  status: "running",
}).select().single();
```

**Step 3: Update graph.stream call**

Replace segment-derived fields with inline fields from parsed.data:
```typescript
targetRoles: parsed.data.target_roles,
searchTerms: parsed.data.search_terms,
companySizeTargets: [],
minScoreThreshold: parsed.data.min_score_threshold ?? 70,
```

Remove `segmentId` from the graph input entirely (it's no longer used).

**Step 4: Remove segment_id from company-first mode**

In companies mode, remove the `.eq("segment_id", ...)` filter — companies are now fetched purely by IDs.

**Step 5: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "refactor: use inline prospect params instead of segment lookup"
```

---

### Task 3: Update agent state and pipeline nodes

**Files:**
- Modify: `src/lib/agent/state.ts`
- Modify: `src/lib/agent/nodes/create-lead.ts`
- Modify: `src/lib/agent/company-discovery/nodes/save-company.ts`
- Modify: `src/app/api/companies/discover/route.ts`

**Step 1: Remove segmentId from agent state**

In `src/lib/agent/state.ts`, delete the `segmentId` annotation line. Keep targetRoles, searchTerms, companySizeTargets, minScoreThreshold as they are (they now come from the form, not from a segment).

**Step 2: Update create-lead.ts**

In `src/lib/agent/nodes/create-lead.ts`, remove `segment_id: state.segmentId` from the companies table insert. The field is NOT NULL in the DB so we need to handle this — set it to a placeholder or make it nullable.

Actually, the `companies` table has `segment_id NOT NULL` FK. Since we're removing segments, we should skip inserting into the `companies` table or make segment_id nullable. The simplest approach: remove `segment_id` from the insert and let it use a default. But it's NOT NULL...

The safest approach is to remove the `segment_id` field from the insert entirely. This will require a migration to make it nullable. Add this to the migration task.

For now, just remove `segment_id: state.segmentId` from the insert — we'll handle the DB in the migration task.

**Step 3: Update save-company.ts**

In `src/lib/agent/company-discovery/nodes/save-company.ts`, remove `segment_id: state.segmentId` from the prospect_companies insert.

**Step 4: Update company discovery state**

In `src/lib/agent/company-discovery/state.ts`, remove `segmentId` annotation.

**Step 5: Update company discovery route**

In `src/app/api/companies/discover/route.ts`, remove `segmentId` from the graph input.

**Step 6: Update company discovery request schema**

Already done in Task 1 (removed segment_id from companyDiscoveryRequestSchema).

**Step 7: Commit**

```bash
git add src/lib/agent/state.ts src/lib/agent/nodes/create-lead.ts src/lib/agent/company-discovery/nodes/save-company.ts src/lib/agent/company-discovery/state.ts src/app/api/companies/discover/route.ts
git commit -m "refactor: remove segmentId from agent pipeline state and nodes"
```

---

### Task 4: Database migration — make segment_id nullable

**Files:**
- Create: `supabase/migrations/012_remove_segment_dependency.sql`

**Step 1: Create migration**

```sql
-- Make segment_id nullable on tables that reference segments
ALTER TABLE companies ALTER COLUMN segment_id DROP NOT NULL;
ALTER TABLE agent_runs ALTER COLUMN segment_id DROP NOT NULL;

-- Set existing segment_id values to NULL (optional cleanup)
-- ALTER TABLE companies SET segment_id = NULL;
-- ALTER TABLE agent_runs SET segment_id = NULL;
```

Note: We're NOT dropping the segments table or the FK constraints yet — that can be done in a future cleanup. For now we just make segment_id nullable so the app works without segments.

**Step 2: Commit**

```bash
git add supabase/migrations/012_remove_segment_dependency.sql
git commit -m "migration: make segment_id nullable on companies and agent_runs"
```

---

### Task 5: Redesign ProspectForm — inline fields, sector filter

**Files:**
- Modify: `src/components/prospect-form.tsx`

**Step 1: Rewrite ProspectForm**

Major changes:
- Remove segment selector and CreateSegmentModal import
- Remove `onSegmentCreated` prop
- Add inline fields: target_roles (comma-separated input), search_terms (comma-separated input), min_score_threshold (number input)
- In "Por Empresas" mode: replace segment-based company loading with sector-based filtering
  - Fetch ALL approved companies on mount
  - Add sector filter dropdown (populated from unique sectors in the companies list)
  - Filter checkbox list by selected sector
- In "Aberto" mode: same fields but with region added
- Submit sends inline fields instead of segment_id

The new form structure:

```
Tab "Por Empresas":
  ├── Sector filter (dropdown from unique sectors of approved companies)
  ├── Company checkboxes (filtered by sector, all selected by default)
  ├── Cargos-alvo (comma-separated input, e.g. "CTO, VP Engineering")
  ├── Termos de busca (comma-separated input, e.g. "fintech, SaaS")
  ├── Score mínimo (number, default 70)
  ├── Quantidade de leads (number)
  └── Botão "Iniciar Prospecção"

Tab "Aberto":
  ├── Cargos-alvo (comma-separated input)
  ├── Termos de busca (comma-separated input)
  ├── Região (text input)
  ├── Score mínimo (number, default 70)
  ├── Quantidade de leads (number)
  └── Botão "Iniciar Prospecção"
```

New Server Action needed: `getAllApprovedCompanies()` (no segment filter).

**Step 2: Commit**

```bash
git add src/components/prospect-form.tsx
git commit -m "feat: redesign prospect form with inline fields and sector filter"
```

---

### Task 6: Update company actions — remove segment dependencies

**Files:**
- Modify: `src/app/(app)/companies/actions.ts`

**Step 1: Replace getApprovedCompaniesBySegment with getAllApprovedCompanies**

```typescript
export async function getAllApprovedCompanies() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("prospect_companies")
    .select("id, name, website, sector, icp_score")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("icp_score", { ascending: false });

  return data ?? [];
}
```

**Step 2: Remove segment_id from createCompany and importCompanies**

Remove `segment_id` from the insert objects in both functions. Remove `segment_id` from the schema destructuring.

**Step 3: Commit**

```bash
git add src/app/(app)/companies/actions.ts
git commit -m "refactor: remove segment_id from company actions, add getAllApprovedCompanies"
```

---

### Task 7: Update prospect page and client — remove segments prop

**Files:**
- Modify: `src/app/(app)/prospect/page.tsx`
- Modify: `src/app/(app)/prospect/client.tsx`

**Step 1: Update page.tsx**

Remove segment fetching. Remove segments prop from ProspectClient.

**Step 2: Update client.tsx**

Remove `segments` prop and `onSegmentCreated` callback. Remove segments from ProspectForm props.

**Step 3: Commit**

```bash
git add "src/app/(app)/prospect/page.tsx" "src/app/(app)/prospect/client.tsx"
git commit -m "refactor: remove segments from prospect page"
```

---

### Task 8: Delete segments page, components, sidebar nav

**Files:**
- Delete: `src/app/(app)/segments/page.tsx`
- Delete: `src/app/(app)/segments/actions.ts`
- Delete: `src/components/segments-table.tsx`
- Delete: `src/components/add-segment-modal.tsx`
- Delete: `src/components/create-segment-modal.tsx`
- Delete: `src/components/edit-segment-modal.tsx`
- Modify: `src/components/sidebar.tsx` — remove Segmentos nav item
- Modify: `src/app/(app)/contacts/page.tsx` — remove segments fetch and prop
- Modify: `src/components/contacts-table.tsx` — remove segments prop
- Modify: `src/components/run-list.tsx` — remove segment name display
- Modify: `src/app/(app)/runs/page.tsx` — remove segment join

**Step 1: Delete files**

```bash
rm -rf "src/app/(app)/segments"
rm src/components/segments-table.tsx
rm src/components/add-segment-modal.tsx
rm src/components/create-segment-modal.tsx
rm src/components/edit-segment-modal.tsx
```

**Step 2: Update sidebar.tsx**

Remove the Segmentos nav item (`{ name: "Segmentos", href: "/segments", icon: Target }`).

**Step 3: Update contacts page**

Remove segments fetch and segments prop from ContactsTable.

**Step 4: Update contacts-table.tsx**

Remove `segments` prop from interface (it's unused anyway).

**Step 5: Update run-list.tsx**

Replace `run.segment?.name` with just the region or remove segment display.

**Step 6: Update runs page**

Remove segment join from query: change `.select("*, segment:segments(name)")` to `.select("*")`.

**Step 7: Remove Segment type from database.ts**

Remove the Segment interface and any references to it. Keep CompanySize type if used elsewhere.

**Step 8: Update company-discovery-form.tsx**

Remove segment dropdown and segments prop.

**Step 9: Update companies/client.tsx and companies/page.tsx**

Remove segments prop passing.

**Step 10: Commit**

```bash
git add -A
git commit -m "refactor: delete segments page, components, and all references"
```

---

### Task 9: Build verification and cleanup

**Step 1: Run build**

```bash
npm run build
```

Fix any remaining TypeScript errors from dangling segment references.

**Step 2: Update CLAUDE.md**

- Remove segments from Architecture tree
- Remove segment design docs from Key Files
- Update pipeline description
- Add new plan references

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: fix build errors and update CLAUDE.md after segments removal"
```
