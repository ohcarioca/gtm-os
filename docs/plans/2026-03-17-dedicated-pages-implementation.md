# Dedicated Pages Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split monolithic dashboard into 4 dedicated pages: /dashboard (metrics), /pipeline (kanban), /contacts (CRUD), /segments (CRUD), with updated sidebar navigation.

**Architecture:** Refactor existing components into new page routes. Server components fetch data, pass to client components. Server actions for mutations. Generic confirm-modal reused across pages.

**Tech Stack:** Next.js 14 App Router, TypeScript, Tailwind CSS, shadcn/ui, Supabase, Zod, @dnd-kit

---

### Task 1: Database Migration — Add phone, email, notes to leads

**Files:**
- Create: `supabase/migrations/003_add_lead_contact_fields.sql`

**Step 1: Create migration file**

```sql
-- Add contact fields for manual lead creation
ALTER TABLE leads ADD COLUMN phone TEXT;
ALTER TABLE leads ADD COLUMN email TEXT;
ALTER TABLE leads ADD COLUMN notes TEXT;
```

**Step 2: Commit**

```bash
git add supabase/migrations/003_add_lead_contact_fields.sql
git commit -m "feat: add phone, email, notes columns to leads table"
```

---

### Task 2: Update types and Zod schemas

**Files:**
- Modify: `src/lib/types/database.ts` (Lead interface, lines 32-49)
- Modify: `src/lib/validations/schemas.ts` (add new schemas)

**Step 1: Add phone, email, notes to Lead interface**

In `src/lib/types/database.ts`, add after `message: string | null;` (line 43):

```typescript
phone: string | null;
email: string | null;
notes: string | null;
```

**Step 2: Add new Zod schemas to `src/lib/validations/schemas.ts`**

Add after `linkedinCredentialsSchema`:

```typescript
export const createLeadSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  company_name: z.string().min(1, "Empresa é obrigatória"),
  linkedin_url: z.string().url("URL do LinkedIn inválida"),
  role: z.string().optional(),
  stage: stageEnum.optional().default("identified"),
  score: scoreEnum.optional(),
  phone: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const updateLeadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  role: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  stage: stageEnum.optional(),
  score: scoreEnum.optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const updateSegmentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  target_roles: z.array(z.string().min(1)).min(1).optional(),
  search_terms: z.array(z.string().min(1)).min(1).optional(),
  company_size_targets: z.array(companySizeEnum).min(1).optional(),
});

export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type UpdateSegmentInput = z.infer<typeof updateSegmentSchema>;
```

**Step 3: Commit**

```bash
git add src/lib/types/database.ts src/lib/validations/schemas.ts
git commit -m "feat: add lead CRUD types and Zod schemas"
```

---

### Task 3: Update sidebar with 7 navigation links

**Files:**
- Modify: `src/components/sidebar.tsx`

**Step 1: Update the navigation array and imports**

Replace the entire `sidebar.tsx` content. Add imports for `Kanban`, `Users`, `Target` from lucide-react. Update the navigation array to:

```typescript
import { LayoutDashboard, Kanban, Users, Target, Search, Activity, Settings } from "lucide-react";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Pipeline", href: "/pipeline", icon: Kanban },
  { name: "Contatos", href: "/contacts", icon: Users },
  { name: "Segmentos", href: "/segments", icon: Target },
  { name: "Prospectar", href: "/prospect", icon: Search },
  { name: "Execuções", href: "/runs", icon: Activity },
  { name: "Configurações", href: "/settings", icon: Settings },
];
```

Rest of the component stays the same.

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: update sidebar with 7 navigation links"
```

---

### Task 4: Create confirm-modal component

**Files:**
- Create: `src/components/confirm-modal.tsx`

**Step 1: Create the generic confirmation modal**

```typescript
"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  onConfirm: () => void;
  loading?: boolean;
  variant?: "destructive" | "default";
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  onConfirm,
  loading = false,
  variant = "default",
}: ConfirmModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={variant === "destructive" ? "destructive" : "default"}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Aguarde..." : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/confirm-modal.tsx
git commit -m "feat: add generic confirm-modal component"
```

---

### Task 5: Create /dashboard page with metrics

**Files:**
- Modify: `src/app/(app)/dashboard/page.tsx` (rewrite entirely)
- Create: `src/components/metrics-cards.tsx`

**Step 1: Create metrics-cards component**

```typescript
"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Lead, AgentRun } from "@/lib/types/database";

interface MetricsCardsProps {
  leads: Lead[];
  runs: AgentRun[];
  serpApiQueries: number;
}

const stageLabels: Record<string, string> = {
  identified: "Identificado",
  connected: "Conectado",
  in_conversation: "Em Conversa",
  converted: "Convertido",
  lost: "Perdido",
};

const stageColors: Record<string, string> = {
  identified: "bg-blue-100 text-blue-800",
  connected: "bg-yellow-100 text-yellow-800",
  in_conversation: "bg-purple-100 text-purple-800",
  converted: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
};

const scoreColors: Record<string, string> = {
  "A+": "bg-green-100 text-green-800",
  A: "bg-blue-100 text-blue-800",
  B: "bg-yellow-100 text-yellow-800",
  C: "bg-gray-100 text-gray-800",
};

export function MetricsCards({ leads, runs, serpApiQueries }: MetricsCardsProps) {
  const totalLeads = leads.length;
  const totalRuns = runs.length;
  const converted = leads.filter((l) => l.stage === "converted").length;
  const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : "0";
  const totalFound = runs.reduce((sum, r) => sum + r.leads_found, 0);
  const totalApproved = runs.reduce((sum, r) => sum + r.leads_approved, 0);

  const stageCounts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.stage] = (acc[l.stage] || 0) + 1;
    return acc;
  }, {});

  const scoreCounts = leads.reduce<Record<string, number>>((acc, l) => {
    if (l.score) acc[l.score] = (acc[l.score] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Top metrics */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Total de Leads</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalLeads}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Execuções</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{totalRuns}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Taxa de Conversão</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{conversionRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">Queries SerpAPI</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{serpApiQueries}</p>
          </CardContent>
        </Card>
      </div>

      {/* Leads by stage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Leads por Estágio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            {Object.entries(stageLabels).map(([stage, label]) => (
              <div key={stage} className={`flex-1 rounded-lg p-3 text-center ${stageColors[stage]}`}>
                <p className="text-2xl font-bold">{stageCounts[stage] || 0}</p>
                <p className="text-xs font-medium">{label}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Leads by score + Found vs Approved */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Leads por Score</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-3">
              {["A+", "A", "B", "C"].map((score) => (
                <Badge key={score} className={`text-lg px-4 py-2 ${scoreColors[score]}`}>
                  {score}: {scoreCounts[score] || 0}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Encontrados vs Aprovados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <div>
                <p className="text-2xl font-bold">{totalFound}</p>
                <p className="text-xs text-gray-500">Encontrados</p>
              </div>
              <span className="text-gray-300 text-2xl">/</span>
              <div>
                <p className="text-2xl font-bold">{totalApproved}</p>
                <p className="text-xs text-gray-500">Aprovados</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

**Step 2: Rewrite dashboard page.tsx**

```typescript
import { createClient } from "@/lib/supabase/server";
import { MetricsCards } from "@/components/metrics-cards";
import type { Lead, AgentRun } from "@/lib/types/database";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false });

  const { data: runs } = await supabase
    .from("agent_runs")
    .select("*")
    .order("started_at", { ascending: false });

  // Count SerpAPI queries from agent run logs
  const serpApiQueries = (runs ?? []).reduce((count, run) => {
    const logEntries = (run as AgentRun).log ?? [];
    return count + logEntries.filter((entry) => entry.step === "search_company").length;
  }, 0);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <MetricsCards
        leads={(leads as Lead[]) ?? []}
        runs={(runs as AgentRun[]) ?? []}
        serpApiQueries={serpApiQueries}
      />
    </div>
  );
}
```

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/app/(app)/dashboard/page.tsx src/components/metrics-cards.tsx
git commit -m "feat: rewrite dashboard page with metrics summary"
```

---

### Task 6: Create /pipeline page

**Files:**
- Create: `src/app/(app)/pipeline/page.tsx`

**Step 1: Create the pipeline page**

This moves PipelineKanban from the old dashboard to its own page.

```typescript
import { createClient } from "@/lib/supabase/server";
import { PipelineKanban } from "@/components/pipeline-kanban";
import type { Lead } from "@/lib/types/database";

export default async function PipelinePage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Pipeline</h2>
      <PipelineKanban leads={(leads as Lead[]) ?? []} />
    </div>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/app/(app)/pipeline/page.tsx
git commit -m "feat: add dedicated pipeline page with kanban board"
```

---

### Task 7: Create /contacts page with CRUD

**Files:**
- Create: `src/app/(app)/contacts/page.tsx`
- Create: `src/app/(app)/contacts/actions.ts`
- Create: `src/components/add-lead-modal.tsx`
- Create: `src/components/edit-lead-modal.tsx`
- Modify: `src/components/contacts-table.tsx` (add action buttons)

**Step 1: Create contacts server actions**

`src/app/(app)/contacts/actions.ts`:

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { createLeadSchema, updateLeadSchema } from "@/lib/validations/schemas";
import { revalidatePath } from "next/cache";

export async function createLead(data: {
  name: string;
  company_name: string;
  linkedin_url: string;
  role?: string;
  stage?: string;
  score?: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  const parsed = createLeadSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.errors[0].message);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Find or create company
  const { data: existingCompany } = await supabase
    .from("companies")
    .select("id")
    .eq("name", parsed.data.company_name)
    .limit(1)
    .single();

  let companyId: string;
  if (existingCompany) {
    companyId = existingCompany.id;
  } else {
    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({
        user_id: user.id,
        segment_id: null,
        name: parsed.data.company_name,
      })
      .select("id")
      .single();
    if (companyError) throw new Error(companyError.message);
    companyId = newCompany.id;
  }

  const { error } = await supabase.from("leads").insert({
    user_id: user.id,
    company_id: companyId,
    name: parsed.data.name,
    role: parsed.data.role || null,
    linkedin_url: parsed.data.linkedin_url,
    stage: parsed.data.stage || "identified",
    score: parsed.data.score || null,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    notes: parsed.data.notes || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
}

export async function updateLead(data: {
  id: string;
  name?: string;
  role?: string;
  linkedin_url?: string;
  stage?: string;
  score?: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  const parsed = updateLeadSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.errors[0].message);

  const supabase = await createClient();
  const { id, ...updates } = parsed.data;

  // Remove undefined values
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(cleanUpdates).length === 0) return;

  const { error } = await supabase
    .from("leads")
    .update(cleanUpdates)
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
}

export async function deleteLead(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}
```

**Important note about companies.segment_id:** The companies table has `segment_id UUID NOT NULL`. For manually created leads, we need to handle this. The migration in Task 1 should also make segment_id nullable on companies, OR we should require a segment when adding a lead manually. Since the design says company is free text, we should make segment_id nullable. Add to migration 003:

```sql
ALTER TABLE companies ALTER COLUMN segment_id DROP NOT NULL;
```

**Step 2: Create add-lead-modal component**

`src/components/add-lead-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createLead } from "@/app/(app)/contacts/actions";

interface AddLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddLeadModal({ open, onOpenChange }: AddLeadModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      await createLead({
        name: form.get("name") as string,
        company_name: form.get("company_name") as string,
        linkedin_url: form.get("linkedin_url") as string,
        role: (form.get("role") as string) || undefined,
        stage: (form.get("stage") as string) || undefined,
        score: (form.get("score") as string) || undefined,
        phone: (form.get("phone") as string) || undefined,
        email: (form.get("email") as string) || undefined,
        notes: (form.get("notes") as string) || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar lead.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Lead</DialogTitle>
          <DialogDescription>Preencha os dados do lead manualmente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lead-name">Nome *</Label>
            <Input id="lead-name" name="name" required placeholder="Nome do contato" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-company">Empresa *</Label>
            <Input id="lead-company" name="company_name" required placeholder="Nome da empresa" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-linkedin">LinkedIn URL *</Label>
            <Input id="lead-linkedin" name="linkedin_url" required placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lead-role">Cargo</Label>
              <Input id="lead-role" name="role" placeholder="CEO, CTO..." />
            </div>
            <div className="space-y-2">
              <Label>Estágio</Label>
              <Select name="stage" defaultValue="identified">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="identified">Identificado</SelectItem>
                  <SelectItem value="connected">Conectado</SelectItem>
                  <SelectItem value="in_conversation">Em Conversa</SelectItem>
                  <SelectItem value="converted">Convertido</SelectItem>
                  <SelectItem value="lost">Perdido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Score</Label>
              <Select name="score">
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone">Telefone</Label>
              <Input id="lead-phone" name="phone" placeholder="+55 11 99999-9999" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-email">Email</Label>
            <Input id="lead-email" name="email" type="email" placeholder="email@empresa.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-notes">Notas</Label>
            <Input id="lead-notes" name="notes" placeholder="Observações sobre o lead" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Adicionar Lead"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Create edit-lead-modal component**

`src/components/edit-lead-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateLead } from "@/app/(app)/contacts/actions";
import type { Lead } from "@/lib/types/database";

interface EditLeadModalProps {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditLeadModal({ lead, open, onOpenChange }: EditLeadModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      await updateLead({
        id: lead.id,
        name: (form.get("name") as string) || undefined,
        role: (form.get("role") as string) || undefined,
        linkedin_url: (form.get("linkedin_url") as string) || undefined,
        stage: (form.get("stage") as string) || undefined,
        score: (form.get("score") as string) || undefined,
        phone: (form.get("phone") as string) || undefined,
        email: (form.get("email") as string) || undefined,
        notes: (form.get("notes") as string) || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar lead.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Lead</DialogTitle>
          <DialogDescription>Atualize os dados do lead.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input id="edit-name" name="name" defaultValue={lead.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-linkedin">LinkedIn URL</Label>
            <Input id="edit-linkedin" name="linkedin_url" defaultValue={lead.linkedin_url ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-role">Cargo</Label>
              <Input id="edit-role" name="role" defaultValue={lead.role ?? ""} />
            </div>
            <div className="space-y-2">
              <Label>Estágio</Label>
              <Select name="stage" defaultValue={lead.stage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="identified">Identificado</SelectItem>
                  <SelectItem value="connected">Conectado</SelectItem>
                  <SelectItem value="in_conversation">Em Conversa</SelectItem>
                  <SelectItem value="converted">Convertido</SelectItem>
                  <SelectItem value="lost">Perdido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Score</Label>
              <Select name="score" defaultValue={lead.score ?? undefined}>
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Telefone</Label>
              <Input id="edit-phone" name="phone" defaultValue={lead.phone ?? ""} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" name="email" type="email" defaultValue={lead.email ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notas</Label>
            <Input id="edit-notes" name="notes" defaultValue={lead.notes ?? ""} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: Update contacts-table with action buttons**

Modify `src/components/contacts-table.tsx` to add:
- An "Adicionar Lead" button at the top
- Edit and Delete icons on each row
- Integration with AddLeadModal, EditLeadModal, and ConfirmModal

Add these imports and state:
```typescript
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddLeadModal } from "@/components/add-lead-modal";
import { EditLeadModal } from "@/components/edit-lead-modal";
import { ConfirmModal } from "@/components/confirm-modal";
import { deleteLead } from "@/app/(app)/contacts/actions";
```

Add state for modals:
```typescript
const [showAddModal, setShowAddModal] = useState(false);
const [editingLead, setEditingLead] = useState<Lead | null>(null);
const [deletingLead, setDeletingLead] = useState<Lead | null>(null);
const [deleteLoading, setDeleteLoading] = useState(false);
```

Add "Adicionar Lead" button next to the search:
```typescript
<Button onClick={() => setShowAddModal(true)}>
  <Plus className="h-4 w-4 mr-2" /> Adicionar Lead
</Button>
```

Add action column to table with edit/delete icons. Add modals at the bottom of the component.

**Step 5: Create contacts page**

`src/app/(app)/contacts/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { ContactsTable } from "@/components/contacts-table";
import type { Lead, Segment } from "@/lib/types/database";

export default async function ContactsPage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false });

  const { data: segments } = await supabase
    .from("segments")
    .select("*")
    .order("name");

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Contatos</h2>
      <ContactsTable leads={(leads as Lead[]) ?? []} segments={(segments as Segment[]) ?? []} />
    </div>
  );
}
```

**Step 6: Verify build**

Run: `npm run build`

**Step 7: Commit**

```bash
git add src/app/(app)/contacts/ src/components/add-lead-modal.tsx src/components/edit-lead-modal.tsx src/components/contacts-table.tsx
git commit -m "feat: add contacts page with full CRUD (add, edit, delete leads)"
```

---

### Task 8: Create /segments page with CRUD

**Files:**
- Create: `src/app/(app)/segments/page.tsx`
- Create: `src/app/(app)/segments/actions.ts`
- Create: `src/components/segments-table.tsx`
- Create: `src/components/add-segment-modal.tsx`
- Create: `src/components/edit-segment-modal.tsx`
- Modify: `src/app/(app)/settings/actions.ts` (remove createSegment, deleteSegment — keep only saveLinkedInCredentials)

**Step 1: Create segments server actions**

`src/app/(app)/segments/actions.ts`:

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { createSegmentSchema, updateSegmentSchema } from "@/lib/validations/schemas";
import { revalidatePath } from "next/cache";

export async function createSegment(data: {
  name: string;
  description?: string;
  target_roles: string[];
  search_terms: string[];
  company_size_targets: string[];
}) {
  const parsed = createSegmentSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.errors[0].message);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: segment, error } = await supabase
    .from("segments")
    .insert({ ...parsed.data, user_id: user.id })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/segments");
  revalidatePath("/prospect");
  return segment.id as string;
}

export async function updateSegment(data: {
  id: string;
  name?: string;
  description?: string;
  target_roles?: string[];
  search_terms?: string[];
  company_size_targets?: string[];
}) {
  const parsed = updateSegmentSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.errors[0].message);

  const supabase = await createClient();
  const { id, ...updates } = parsed.data;

  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(cleanUpdates).length === 0) return;

  const { error } = await supabase
    .from("segments")
    .update(cleanUpdates)
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/segments");
  revalidatePath("/prospect");
}

export async function deleteSegment(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("segments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/segments");
  revalidatePath("/prospect");
}
```

**Step 2: Create segments-table component**

`src/components/segments-table.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { AddSegmentModal } from "@/components/add-segment-modal";
import { EditSegmentModal } from "@/components/edit-segment-modal";
import { ConfirmModal } from "@/components/confirm-modal";
import { deleteSegment } from "@/app/(app)/segments/actions";
import type { Segment } from "@/lib/types/database";

const sizeLabels: Record<string, string> = {
  small: "Pequeno",
  medium: "Médio",
  large: "Grande",
};

interface SegmentsTableProps {
  segments: Segment[];
}

export function SegmentsTable({ segments }: SegmentsTableProps) {
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [deletingSegment, setDeletingSegment] = useState<Segment | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  async function handleDelete() {
    if (!deletingSegment) return;
    setDeleteLoading(true);
    try {
      await deleteSegment(deletingSegment.id);
      setDeletingSegment(null);
    } catch {
      // toast would go here
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4 mr-2" /> Adicionar Segmento
        </Button>
      </div>
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead>Termos</TableHead>
              <TableHead>Porte</TableHead>
              <TableHead className="w-24">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {segments.map((seg) => (
              <TableRow key={seg.id}>
                <TableCell className="font-medium">{seg.name}</TableCell>
                <TableCell className="text-gray-500 max-w-[200px] truncate">
                  {seg.description || "—"}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {seg.target_roles.slice(0, 2).map((r) => (
                      <Badge key={r} variant="secondary" className="text-xs">{r}</Badge>
                    ))}
                    {seg.target_roles.length > 2 && (
                      <Badge variant="secondary" className="text-xs">+{seg.target_roles.length - 2}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {seg.search_terms.slice(0, 2).map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                    {seg.search_terms.length > 2 && (
                      <Badge variant="outline" className="text-xs">+{seg.search_terms.length - 2}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {seg.company_size_targets.map((s) => sizeLabels[s] || s).join(", ")}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setEditingSegment(seg)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeletingSegment(seg)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {segments.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                  Nenhum segmento encontrado
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <AddSegmentModal open={showAddModal} onOpenChange={setShowAddModal} />
      {editingSegment && (
        <EditSegmentModal
          segment={editingSegment}
          open={!!editingSegment}
          onOpenChange={(open) => { if (!open) setEditingSegment(null); }}
        />
      )}
      <ConfirmModal
        open={!!deletingSegment}
        onOpenChange={(open) => { if (!open) setDeletingSegment(null); }}
        title="Excluir Segmento"
        description={`Tem certeza que deseja excluir "${deletingSegment?.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        variant="destructive"
      />
    </div>
  );
}
```

**Step 3: Create add-segment-modal**

`src/components/add-segment-modal.tsx` — Reuse the template-based UI from `create-segment-modal.tsx` but call the new `segments/actions.ts` createSegment, and add a confirmation step before saving. The modal flow:
1. Fill form (same UI as create-segment-modal)
2. Click "Criar" → opens ConfirmModal with segment summary
3. Confirm → calls createSegment server action

```typescript
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ConfirmModal } from "@/components/confirm-modal";
import { Wifi, CreditCard, Code, Plus } from "lucide-react";
import { createSegment } from "@/app/(app)/segments/actions";
import type { CompanySize } from "@/lib/types/database";

// Same TEMPLATES and SIZE_OPTIONS as create-segment-modal.tsx

interface AddSegmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddSegmentModal({ open, onOpenChange }: AddSegmentModalProps) {
  // Same state and template logic as create-segment-modal.tsx
  // Plus:
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);

  // On form submit, instead of directly calling createSegment,
  // set showConfirm = true to show confirmation modal

  // On confirm, call createSegment with parsed data
  // On success, close both modals and reset state
}
```

The full code should mirror create-segment-modal.tsx structure but import from `@/app/(app)/segments/actions` and include the ConfirmModal confirmation step.

**Step 4: Create edit-segment-modal**

`src/components/edit-segment-modal.tsx`:

```typescript
"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { updateSegment } from "@/app/(app)/segments/actions";
import type { Segment, CompanySize } from "@/lib/types/database";

const SIZE_OPTIONS: { value: CompanySize; label: string }[] = [
  { value: "small", label: "Pequeno" },
  { value: "medium", label: "Médio" },
  { value: "large", label: "Grande" },
];

interface EditSegmentModalProps {
  segment: Segment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditSegmentModal({ segment, open, onOpenChange }: EditSegmentModalProps) {
  const [name, setName] = useState(segment.name);
  const [description, setDescription] = useState(segment.description ?? "");
  const [roles, setRoles] = useState(segment.target_roles.join(", "));
  const [terms, setTerms] = useState(segment.search_terms.join(", "));
  const [sizes, setSizes] = useState<CompanySize[]>(segment.company_size_targets);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleSize(size: CompanySize) {
    setSizes((prev) =>
      prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await updateSegment({
        id: segment.id,
        name,
        description: description || undefined,
        target_roles: roles.split(",").map((s) => s.trim()).filter(Boolean),
        search_terms: terms.split(",").map((s) => s.trim()).filter(Boolean),
        company_size_targets: sizes,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar segmento.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar Segmento</DialogTitle>
          <DialogDescription>Atualize os dados do segmento.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-seg-name">Nome *</Label>
            <Input id="edit-seg-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-seg-desc">Descrição</Label>
            <Input id="edit-seg-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Porte *</Label>
            <div className="flex gap-4">
              {SIZE_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={sizes.includes(opt.value)} onCheckedChange={() => toggleSize(opt.value)} />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-seg-roles">Roles-alvo *</Label>
            <Input id="edit-seg-roles" value={roles} onChange={(e) => setRoles(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-seg-terms">Termos de busca *</Label>
            <Input id="edit-seg-terms" value={terms} onChange={(e) => setTerms(e.target.value)} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 5: Create segments page**

`src/app/(app)/segments/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { SegmentsTable } from "@/components/segments-table";
import type { Segment } from "@/lib/types/database";

export default async function SegmentsPage() {
  const supabase = await createClient();

  const { data: segments } = await supabase
    .from("segments")
    .select("*")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Segmentos</h2>
      <SegmentsTable segments={(segments as Segment[]) ?? []} />
    </div>
  );
}
```

**Step 6: Clean up settings/actions.ts**

Remove `createSegment` and `deleteSegment` from `src/app/(app)/settings/actions.ts`. Keep only `saveLinkedInCredentials`. Remove the import of `createSegmentSchema`.

**Step 7: Update create-segment-modal.tsx import**

In `src/components/create-segment-modal.tsx` (used by prospect page), update the import:
```typescript
// Change from:
import { createSegment } from "@/app/(app)/settings/actions";
// Change to:
import { createSegment } from "@/app/(app)/segments/actions";
```

**Step 8: Verify build**

Run: `npm run build`

**Step 9: Commit**

```bash
git add src/app/(app)/segments/ src/components/segments-table.tsx src/components/add-segment-modal.tsx src/components/edit-segment-modal.tsx src/app/(app)/settings/actions.ts src/components/create-segment-modal.tsx
git commit -m "feat: add segments page with full CRUD and move actions from settings"
```

---

### Task 9: Final cleanup and build verification

**Files:**
- Modify: `src/app/(app)/dashboard/actions.ts` — keep as-is (updateLeadStage still used by pipeline-kanban)

**Step 1: Remove old dashboard imports of ContactsTable**

The dashboard page.tsx was already rewritten in Task 5. Verify it no longer imports ContactsTable or PipelineKanban.

**Step 2: Run full build**

Run: `npm run build`
Expected: Build succeeds with all pages rendering.

**Step 3: Run lint**

Run: `npm run lint`

**Step 4: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup after page separation"
```
