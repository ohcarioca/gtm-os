# Prospecting Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Redesign the prospecting form with two modes: "Por Empresas" (company-first with checkboxes) and "Aberto" (current dork queries), with randomized company order.

**Architecture:** Tabs inside existing ProspectForm, discriminated union Zod schema, updated API route to handle both modes with Fisher-Yates shuffle.

**Tech Stack:** Next.js Server Actions, Zod discriminated union, shadcn/ui Tabs, existing LangGraph pipeline (unchanged).

---

### Task 1: Update Zod schema to discriminated union

**Files:**
- Modify: `src/lib/validations/schemas.ts`

**Step 1: Replace `prospectRequestSchema`**

In `src/lib/validations/schemas.ts`, replace the existing `prospectRequestSchema`:

```typescript
// OLD:
export const prospectRequestSchema = z.object({
  segment_id: z.string().uuid(),
  region: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(20),
});
```

With:

```typescript
export const prospectRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("companies"),
    segment_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
    company_ids: z.array(z.string().uuid()).min(1).max(50),
  }),
  z.object({
    mode: z.literal("open"),
    segment_id: z.string().uuid(),
    region: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
  }),
]);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build will fail because `route.ts` and `prospect-form.tsx` still use the old schema shape. That's expected — we fix them in subsequent tasks.

**Step 3: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "feat: update prospectRequestSchema to discriminated union for two modes"
```

---

### Task 2: Add getApprovedCompanies Server Action

**Files:**
- Modify: `src/app/(app)/companies/actions.ts`

**Step 1: Add the action**

Add at the end of `src/app/(app)/companies/actions.ts`:

```typescript
export async function getApprovedCompaniesBySegment(segmentId: string) {
  if (!segmentId || !z.string().uuid().safeParse(segmentId).success) {
    return [];
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("prospect_companies")
    .select("id, name, website, icp_score")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .eq("segment_id", segmentId)
    .order("icp_score", { ascending: false });

  return data ?? [];
}
```

Add `z` import if not already present (it is imported via the schema imports — add `import { z } from "zod"` at top if needed).

**Step 2: Verify build**

Run: `npm run build`
Expected: May still have errors from Task 1's schema change. The action itself should compile fine.

**Step 3: Commit**

```bash
git add src/app/(app)/companies/actions.ts
git commit -m "feat: add getApprovedCompaniesBySegment server action"
```

---

### Task 3: Update API route for two modes

**Files:**
- Modify: `src/app/api/prospect/route.ts`

**Step 1: Add shuffle function at top of file (after imports)**

```typescript
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
```

**Step 2: Update POST handler**

Replace the section after schema validation (after `if (!segment)` check) with logic that handles both modes. The key changes:

1. After parsing, check `parsed.data.mode`:
   - If `"companies"`: fetch companies by `company_ids`, shuffle them, set `region` to empty string
   - If `"open"`: fetch approved companies for segment (current behavior), set region from input

2. Replace the existing `approvedCompanies` fetch block. The full updated logic after the segment fetch:

```typescript
  let targetCompanies: { id: string; name: string; website: string | null }[] = [];
  let region = "";

  if (parsed.data.mode === "companies") {
    // Company-first mode: fetch selected companies, shuffle order
    const { data: selectedCompanies } = await supabase
      .from("prospect_companies")
      .select("id, name, website")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .in("id", parsed.data.company_ids);

    targetCompanies = shuffle(
      (selectedCompanies ?? []).map((c: { id: string; name: string; website: string | null }) => ({
        id: c.id,
        name: c.name,
        website: c.website,
      }))
    );
  } else {
    // Open mode: use region, optionally load segment companies as before
    region = parsed.data.region;
    const { data: approvedCompanies } = await supabase
      .from("prospect_companies")
      .select("id, name, website")
      .eq("user_id", user.id)
      .eq("status", "approved")
      .eq("segment_id", parsed.data.segment_id)
      .order("icp_score", { ascending: false });

    targetCompanies = (approvedCompanies ?? []).map((c: { id: string; name: string; website: string | null }) => ({
      id: c.id,
      name: c.name,
      website: c.website,
    }));
  }
```

3. Remove the old `approvedCompanies` fetch block.

4. Update the `agent_runs` insert to use the dynamic `region`:

```typescript
  const { data: run } = await supabase.from("agent_runs").insert({
    user_id: user.id,
    segment_id: parsed.data.segment_id,
    region: region || "empresas-alvo",
    quantity: parsed.data.quantity,
    status: "running",
  }).select().single();
```

5. Update the `graph.stream` call to use the new variables:

```typescript
    region: region,
    // ...
    targetCompanies: targetCompanies,
```

Instead of the old inline mapping.

**Step 3: Verify build**

Run: `npm run build`
Expected: API route compiles. ProspectForm may still fail (fixed in Task 4).

**Step 4: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "feat: handle companies/open modes in prospect API with shuffle"
```

---

### Task 4: Redesign ProspectForm with tabs

**Files:**
- Modify: `src/components/prospect-form.tsx`

**Step 1: Rewrite ProspectForm**

Replace the entire content of `src/components/prospect-form.tsx` with:

```typescript
"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Plus, Building2, Search } from "lucide-react";
import { CreateSegmentModal } from "@/components/create-segment-modal";
import { getApprovedCompaniesBySegment } from "@/app/(app)/companies/actions";
import type { Segment } from "@/lib/types/database";

interface ProspectFormProps {
  segments: Segment[];
  onStart: (stream: ReadableStream, controller: AbortController) => void;
  onSegmentCreated?: () => void;
  isRunning: boolean;
}

interface ApprovedCompany {
  id: string;
  name: string;
  website: string | null;
  icp_score: number;
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export function ProspectForm({ segments, onStart, onSegmentCreated, isRunning }: ProspectFormProps) {
  const [mode, setMode] = useState<"companies" | "open">("companies");
  const [segmentId, setSegmentId] = useState("");
  const [region, setRegion] = useState("");
  const [quantity, setQuantity] = useState(5);
  const [modalOpen, setModalOpen] = useState(false);

  // Company mode state
  const [companies, setCompanies] = useState<ApprovedCompany[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  const fetchCompanies = useCallback(async (sid: string) => {
    if (!sid) {
      setCompanies([]);
      setSelectedIds(new Set());
      return;
    }
    setLoadingCompanies(true);
    try {
      const data = await getApprovedCompaniesBySegment(sid);
      setCompanies(data);
      setSelectedIds(new Set(data.map((c: ApprovedCompany) => c.id)));
    } catch {
      setCompanies([]);
      setSelectedIds(new Set());
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "companies" && segmentId) {
      fetchCompanies(segmentId);
    }
  }, [mode, segmentId, fetchCompanies]);

  function handleSegmentChange(value: string) {
    setSegmentId(value);
  }

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(companies.map((c) => c.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function handleToggleCompany(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const body =
      mode === "companies"
        ? { mode: "companies" as const, segment_id: segmentId, quantity, company_ids: Array.from(selectedIds) }
        : { mode: "open" as const, segment_id: segmentId, region, quantity };

    const controller = new AbortController();
    const response = await fetch("/api/prospect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) return;
    onStart(response.body, controller);
  }

  function handleSegmentCreated(newSegmentId: string) {
    setSegmentId(newSegmentId);
    onSegmentCreated?.();
  }

  const allSelected = companies.length > 0 && selectedIds.size === companies.length;
  const canSubmitCompanies = segmentId && selectedIds.size > 0;
  const canSubmitOpen = segmentId && region;

  return (
    <>
      <Card className="rounded-xl shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle>Nova Prospecção</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "companies" | "open")}>
            <TabsList className="w-full mb-4">
              <TabsTrigger value="companies" className="flex-1">
                <Building2 className="h-4 w-4 mr-1" />
                Por Empresas
              </TabsTrigger>
              <TabsTrigger value="open" className="flex-1">
                <Search className="h-4 w-4 mr-1" />
                Aberto
              </TabsTrigger>
            </TabsList>

            {/* Company-first mode */}
            <TabsContent value="companies">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Segmento</Label>
                  <Select value={segmentId} onValueChange={handleSegmentChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um segmento" />
                    </SelectTrigger>
                    <SelectContent>
                      {segments.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Novo Segmento
                  </Button>
                </div>

                {segmentId && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Empresas aprovadas</Label>
                      {companies.length > 0 && (
                        <label className="flex items-center gap-2 text-sm text-slate-600">
                          <Checkbox
                            checked={allSelected}
                            onCheckedChange={(checked) => handleSelectAll(checked === true)}
                          />
                          Selecionar todas
                        </label>
                      )}
                    </div>

                    {loadingCompanies ? (
                      <p className="text-sm text-slate-400 py-4 text-center">Carregando empresas...</p>
                    ) : companies.length === 0 ? (
                      <p className="text-sm text-slate-400 py-4 text-center">
                        Nenhuma empresa aprovada neste segmento.
                      </p>
                    ) : (
                      <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                        {companies.map((c) => (
                          <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                            <Checkbox
                              checked={selectedIds.has(c.id)}
                              onCheckedChange={(checked) => handleToggleCompany(c.id, checked === true)}
                            />
                            <span className="flex-1 text-sm text-slate-700 truncate">{c.name}</span>
                            <Badge className={`text-xs font-semibold shrink-0 ${scoreBadgeClass(c.icp_score)}`}>
                              {c.icp_score}
                            </Badge>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Quantidade de leads</Label>
                  <Input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
                </div>

                <Button type="submit" disabled={isRunning || !canSubmitCompanies} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                  {isRunning ? "Prospectando..." : "Iniciar Prospecção"}
                </Button>
              </form>
            </TabsContent>

            {/* Open dork mode */}
            <TabsContent value="open">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label>Segmento</Label>
                  <Select value={segmentId} onValueChange={handleSegmentChange}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um segmento" />
                    </SelectTrigger>
                    <SelectContent>
                      {segments.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => setModalOpen(true)}>
                    <Plus className="mr-2 h-4 w-4" /> Novo Segmento
                  </Button>
                </div>

                <div className="space-y-2">
                  <Label>Região</Label>
                  <Input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="Ex: São Paulo, Interior SP" />
                </div>

                <div className="space-y-2">
                  <Label>Quantidade de leads</Label>
                  <Input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
                </div>

                <Button type="submit" disabled={isRunning || !canSubmitOpen} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
                  {isRunning ? "Prospectando..." : "Iniciar Prospecção"}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <CreateSegmentModal open={modalOpen} onOpenChange={setModalOpen} onCreated={handleSegmentCreated} />
    </>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build passes.

**Step 3: Commit**

```bash
git add src/components/prospect-form.tsx
git commit -m "feat: redesign prospect form with companies/open tabs"
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add design doc references to Key Files section**

Add after the last plan entry:
```
- `docs/plans/2026-03-19-prospecting-redesign-design.md` — Prospecting redesign with two modes
- `docs/plans/2026-03-19-prospecting-redesign-implementation.md` — Prospecting redesign implementation plan
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add prospecting redesign plan references to CLAUDE.md"
```

---

### Task 6: Manual smoke test

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test "Por Empresas" mode**

1. Navigate to `/prospect`
2. Verify tabs appear: "Por Empresas" | "Aberto"
3. Select a segment with approved companies
4. Verify company list loads with checkboxes (all selected by default)
5. Uncheck some companies, verify selection state works
6. Submit — verify agent runs against selected companies

**Step 3: Test "Aberto" mode**

1. Switch to "Aberto" tab
2. Verify region field appears
3. Fill segment + region + quantity
4. Submit — verify agent runs with dork queries (current behavior)

**Step 4: Test edge cases**

- Select segment with no approved companies → verify "Nenhuma empresa aprovada" message
- Switch between tabs → verify form state is preserved
- Verify randomization: run "Por Empresas" twice with same companies → check log order differs
