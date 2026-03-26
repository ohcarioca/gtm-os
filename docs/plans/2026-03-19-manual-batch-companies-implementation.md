# Manual & Batch Company Addition — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to add companies manually (individual form) or in batch (CSV/XLSX upload with column mapping), with automatic Firecrawl enrichment.

**Architecture:** Two new modals on the Companies page. Client-side file parsing (papaparse + sheetjs). Server Actions for insert + background enrichment. Follows existing modal/action patterns.

**Tech Stack:** Next.js Server Actions, Zod, papaparse, xlsx (sheetjs), shadcn/ui Dialog, existing Firecrawl enrichment.

---

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install papaparse and xlsx**

Run:
```bash
npm install papaparse xlsx && npm install -D @types/papaparse
```

**Step 2: Verify install**

Run: `npm run build`
Expected: Build succeeds with no errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add papaparse and xlsx for CSV/XLSX import"
```

---

### Task 2: Add Zod schemas

**Files:**
- Modify: `src/lib/validations/schemas.ts`

**Step 1: Add schemas to `src/lib/validations/schemas.ts`**

Add at the end of the file, before the type exports block:

```typescript
export const createProspectCompanySchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  sector: z.string().max(200).optional().or(z.literal("")),
  size: z.string().max(100).optional().or(z.literal("")),
  region: z.string().max(200).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
  segment_id: z.string().uuid().optional().or(z.literal("")),
});

export const importProspectCompaniesSchema = z.object({
  companies: z.array(createProspectCompanySchema).min(1).max(50),
  segment_id: z.string().uuid().optional().or(z.literal("")),
});
```

Add type exports:

```typescript
export type CreateProspectCompanyInput = z.infer<typeof createProspectCompanySchema>;
export type ImportProspectCompaniesInput = z.infer<typeof importProspectCompaniesSchema>;
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "feat: add Zod schemas for manual/batch company creation"
```

---

### Task 3: Add Server Actions

**Files:**
- Modify: `src/app/(app)/companies/actions.ts`

**Step 1: Add `createCompany` and `importCompanies` Server Actions**

Add these imports at top of file:

```typescript
import { createProspectCompanySchema, importProspectCompaniesSchema } from "@/lib/validations/schemas";
import { enrichCompany } from "@/lib/firecrawl-enrich";
```

Add these functions at the end of the file:

```typescript
export async function createCompany(input: unknown) {
  const parsed = createProspectCompanySchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { name, website, sector, size, region, description, segment_id } = parsed.data;

  const { data, error } = await supabase
    .from("prospect_companies")
    .insert({
      user_id: user.id,
      name,
      website: website || null,
      sector: sector || null,
      size: size || null,
      region: region || null,
      description: description || null,
      segment_id: segment_id || null,
      source: "manual",
      status: "approved",
    })
    .select("id")
    .single();

  if (error) throw error;

  // Non-blocking enrichment
  if (website) {
    enrichCompany(name, website).then(async (enrichment) => {
      if (!enrichment) return;
      await supabase
        .from("prospect_companies")
        .update({
          description: enrichment.description ?? description ?? null,
          tech_stack: enrichment.techStack.join(", ") || null,
          products: enrichment.products.join(", ") || null,
          hiring_status: enrichment.isHiring ? "Contratando" : "Não contratando",
          sector: enrichment.sector ?? sector ?? null,
          size: enrichment.employeeCount ?? size ?? null,
        })
        .eq("id", data.id)
        .eq("user_id", user.id);
    }).catch(console.error);
  }

  revalidatePath("/companies");
}

export async function importCompanies(input: unknown) {
  const parsed = importProspectCompaniesSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { companies, segment_id } = parsed.data;

  const rows = companies.map((c) => ({
    user_id: user.id,
    name: c.name,
    website: c.website || null,
    sector: c.sector || null,
    size: c.size || null,
    region: c.region || null,
    description: c.description || null,
    segment_id: segment_id || null,
    source: "manual" as const,
    status: "approved" as const,
  }));

  const { data, error } = await supabase
    .from("prospect_companies")
    .insert(rows)
    .select("id, name, website");

  if (error) throw error;

  // Non-blocking enrichment for companies with websites
  if (data) {
    for (const company of data) {
      if (!company.website) continue;
      enrichCompany(company.name, company.website).then(async (enrichment) => {
        if (!enrichment) return;
        await supabase
          .from("prospect_companies")
          .update({
            description: enrichment.description,
            tech_stack: enrichment.techStack.join(", ") || null,
            products: enrichment.products.join(", ") || null,
            hiring_status: enrichment.isHiring ? "Contratando" : "Não contratando",
            sector: enrichment.sector,
            size: enrichment.employeeCount,
          })
          .eq("id", company.id)
          .eq("user_id", user.id);
      }).catch(console.error);
    }
  }

  revalidatePath("/companies");
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/app/(app)/companies/actions.ts
git commit -m "feat: add createCompany and importCompanies server actions"
```

---

### Task 4: Create Add Company Modal

**Files:**
- Create: `src/components/add-company-modal.tsx`

**Step 1: Create the modal component**

Follow the same pattern as `src/components/add-lead-modal.tsx`. Create `src/components/add-company-modal.tsx`:

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
import { createCompany } from "@/app/(app)/companies/actions";
import type { Segment } from "@/lib/types/database";

interface AddCompanyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: Segment[];
}

export function AddCompanyModal({ open, onOpenChange, segments }: AddCompanyModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      await createCompany({
        name: form.get("name") as string,
        website: (form.get("website") as string) || undefined,
        sector: (form.get("sector") as string) || undefined,
        size: (form.get("size") as string) || undefined,
        region: (form.get("region") as string) || undefined,
        description: (form.get("description") as string) || undefined,
        segment_id: (form.get("segment_id") as string) || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar empresa.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Empresa</DialogTitle>
          <DialogDescription>Adicione uma empresa manualmente à sua lista.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company-name">Nome *</Label>
            <Input id="company-name" name="name" required placeholder="Nome da empresa" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-website">Website</Label>
            <Input id="company-website" name="website" type="url" placeholder="https://empresa.com" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company-sector">Setor</Label>
              <Input id="company-sector" name="sector" placeholder="Fintech, SaaS..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-size">Tamanho</Label>
              <Input id="company-size" name="size" placeholder="11-50, 200+..." />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-region">Região</Label>
            <Input id="company-region" name="region" placeholder="São Paulo, Brasil" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-description">Descrição</Label>
            <Input id="company-description" name="description" placeholder="Breve descrição da empresa" />
          </div>
          <div className="space-y-2">
            <Label>Segmento</Label>
            <Select name="segment_id">
              <SelectTrigger><SelectValue placeholder="Nenhum segmento" /></SelectTrigger>
              <SelectContent>
                {segments.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" disabled={loading}>
            {loading ? "Salvando..." : "Adicionar Empresa"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/add-company-modal.tsx
git commit -m "feat: add individual company creation modal"
```

---

### Task 5: Create Import Companies Modal

**Files:**
- Create: `src/components/import-companies-modal.tsx`

**Step 1: Create the 3-step import wizard modal**

Create `src/components/import-companies-modal.tsx`:

```typescript
"use client";

import { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, ArrowLeft, ArrowRight, FileSpreadsheet, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { importCompanies } from "@/app/(app)/companies/actions";
import type { Segment } from "@/lib/types/database";

interface ImportCompaniesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segments: Segment[];
}

type Step = "upload" | "mapping" | "confirm";

const SYSTEM_FIELDS = [
  { key: "name", label: "Nome *", required: true },
  { key: "website", label: "Website", required: false },
  { key: "sector", label: "Setor", required: false },
  { key: "size", label: "Tamanho", required: false },
  { key: "region", label: "Região", required: false },
  { key: "description", label: "Descrição", required: false },
] as const;

type FieldKey = (typeof SYSTEM_FIELDS)[number]["key"];

export function ImportCompaniesModal({ open, onOpenChange, segments }: ImportCompaniesModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [fileColumns, setFileColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({
    name: "", website: "", sector: "", size: "", region: "", description: "",
  });
  const [segmentId, setSegmentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("upload");
    setFileColumns([]);
    setRawRows([]);
    setMapping({ name: "", website: "", sector: "", size: "", region: "", description: "" });
    setSegmentId("");
    setError(null);
  }

  function handleOpenChange(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  function parseCSV(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rows = results.data as Record<string, string>[];
        if (rows.length === 0) {
          setError("Arquivo vazio.");
          return;
        }
        if (rows.length > 50) {
          setError("Máximo de 50 empresas por importação.");
          return;
        }
        setFileColumns(Object.keys(rows[0]));
        setRawRows(rows);
        autoMap(Object.keys(rows[0]));
        setStep("mapping");
      },
      error() {
        setError("Erro ao ler o arquivo CSV.");
      },
    });
  }

  function parseXLSX(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        if (rows.length === 0) {
          setError("Arquivo vazio.");
          return;
        }
        if (rows.length > 50) {
          setError("Máximo de 50 empresas por importação.");
          return;
        }
        setFileColumns(Object.keys(rows[0]));
        setRawRows(rows);
        autoMap(Object.keys(rows[0]));
        setStep("mapping");
      } catch {
        setError("Erro ao ler o arquivo XLSX.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function autoMap(columns: string[]) {
    const lower = columns.map((c) => c.toLowerCase().trim());
    const newMapping = { ...mapping };
    const hints: Record<FieldKey, string[]> = {
      name: ["name", "nome", "empresa", "company", "razao social", "razão social"],
      website: ["website", "site", "url", "dominio", "domínio"],
      sector: ["sector", "setor", "industria", "indústria", "industry"],
      size: ["size", "tamanho", "porte", "employees", "funcionarios", "funcionários"],
      region: ["region", "regiao", "região", "city", "cidade", "location", "local"],
      description: ["description", "descricao", "descrição", "about", "sobre"],
    };
    for (const field of SYSTEM_FIELDS) {
      const idx = lower.findIndex((c) => hints[field.key].includes(c));
      if (idx !== -1) newMapping[field.key] = columns[idx];
    }
    setMapping(newMapping);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") parseCSV(file);
    else if (ext === "xlsx" || ext === "xls") parseXLSX(file);
    else setError("Formato não suportado. Use CSV ou XLSX.");
  }

  const mappedRows = useCallback(() => {
    return rawRows
      .map((row) => {
        const mapped: Record<string, string> = {};
        for (const field of SYSTEM_FIELDS) {
          const col = mapping[field.key];
          mapped[field.key] = col ? (row[col] ?? "").trim() : "";
        }
        return mapped;
      })
      .filter((row) => row.name.length > 0);
  }, [rawRows, mapping]);

  const canAdvanceToConfirm = mapping.name !== "";

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      const rows = mappedRows();
      if (rows.length === 0) {
        setError("Nenhuma empresa válida para importar.");
        setLoading(false);
        return;
      }
      await importCompanies({
        companies: rows.map((r) => ({
          name: r.name,
          website: r.website || undefined,
          sector: r.sector || undefined,
          size: r.size || undefined,
          region: r.region || undefined,
          description: r.description || undefined,
        })),
        segment_id: segmentId || undefined,
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao importar empresas.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Empresas
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione um arquivo CSV ou XLSX com até 50 empresas."}
            {step === "mapping" && "Mapeie as colunas do arquivo para os campos do sistema."}
            {step === "confirm" && "Revise os dados e confirme a importação."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-red-50 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors">
              <Upload className="h-8 w-8 text-slate-400 mb-2" />
              <span className="text-sm text-slate-600">Clique para selecionar ou arraste o arquivo</span>
              <span className="text-xs text-slate-400 mt-1">.csv ou .xlsx — máximo 50 linhas</span>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === "mapping" && (
          <div className="space-y-4">
            <div className="space-y-3">
              {SYSTEM_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <Label className="w-28 text-right text-sm shrink-0">
                    {field.label}
                  </Label>
                  <Select
                    value={mapping[field.key]}
                    onValueChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v === "__skip__" ? "" : v }))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Pular" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">Pular</SelectItem>
                      {fileColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th key={f.key} className="px-3 py-2 text-left font-medium text-slate-600">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t">
                      {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="px-3 py-2 text-slate-700 truncate max-w-[200px]">
                          {row[mapping[f.key]] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawRows.length > 5 && (
                <p className="text-xs text-slate-400 px-3 py-2 bg-slate-50">
                  ... e mais {rawRows.length - 5} linhas
                </p>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep("upload"); setError(null); }}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={!canAdvanceToConfirm}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Avançar <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            {rawRows.length !== mappedRows().length && (
              <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
                {rawRows.length - mappedRows().length} linhas removidas (sem nome).
              </div>
            )}

            <div className="border rounded-lg overflow-x-auto max-h-60">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-slate-50">
                    {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th key={f.key} className="px-3 py-2 text-left font-medium text-slate-600">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows().map((row, i) => (
                    <tr key={i} className="border-t">
                      {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="px-3 py-2 text-slate-700 truncate max-w-[200px]">
                          {row[f.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <Label>Segmento (opcional)</Label>
              <Select value={segmentId} onValueChange={setSegmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Nenhum segmento" />
                </SelectTrigger>
                <SelectContent>
                  {segments.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("mapping")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={handleImport}
                disabled={loading || mappedRows().length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {loading ? "Importando..." : `Importar ${mappedRows().length} empresas`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 3: Commit**

```bash
git add src/components/import-companies-modal.tsx
git commit -m "feat: add CSV/XLSX import modal with column mapping wizard"
```

---

### Task 6: Add buttons to CompanyList and wire modals

**Files:**
- Modify: `src/components/company-list.tsx`
- Modify: `src/app/(app)/companies/client.tsx`

**Step 1: Update `company-list.tsx` to accept and show action buttons**

In `src/components/company-list.tsx`, update the `CompanyListProps` interface to accept an `actions` slot:

```typescript
interface CompanyListProps {
  companies: ProspectCompany[];
  actions?: React.ReactNode;
}
```

Update the `CompanyList` function signature:

```typescript
export function CompanyList({ companies, actions }: CompanyListProps)
```

Add the `actions` slot in the header area, replacing the existing `<div>` wrapping `<TabsList>`:

```tsx
<div className="flex items-center justify-between gap-4 flex-wrap">
  <TabsList>
    <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
    <TabsTrigger value="new">Novas ({counts.new})</TabsTrigger>
    <TabsTrigger value="approved">Aprovadas ({counts.approved})</TabsTrigger>
    <TabsTrigger value="rejected">Rejeitadas ({counts.rejected})</TabsTrigger>
  </TabsList>
  {actions && <div className="flex gap-2">{actions}</div>}
</div>
```

**Step 2: Update `client.tsx` to wire modals**

Replace the contents of `src/app/(app)/companies/client.tsx` with:

```typescript
"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Plus, FileSpreadsheet } from "lucide-react";
import { CompanyDiscoveryForm } from "@/components/company-discovery-form";
import { CompanyList } from "@/components/company-list";
import { AgentFeed } from "@/components/agent-feed";
import { AddCompanyModal } from "@/components/add-company-modal";
import { ImportCompaniesModal } from "@/components/import-companies-modal";
import type { Segment, ProspectCompany, CompanyProfile } from "@/lib/types/database";

interface CompaniesClientProps {
  companies: ProspectCompany[];
  segments: Segment[];
  companyProfile: CompanyProfile | null;
}

export function CompaniesClient({ companies, segments, companyProfile }: CompaniesClientProps) {
  const [stream, setStream] = useState<ReadableStream | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const router = useRouter();
  const abortRef = useRef<AbortController | null>(null);

  function handleSubmitting() {
    setIsRunning(true);
    setStream(null);
  }

  function handleStart(newStream: ReadableStream, controller: AbortController) {
    abortRef.current = controller;
    setStream(newStream);
  }

  const handleComplete = useCallback(() => {
    abortRef.current = null;
    setIsRunning(false);
    router.refresh();
  }, [router]);

  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">Empresas</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <CompanyDiscoveryForm
          segments={segments}
          companyProfile={companyProfile}
          onStart={handleStart}
          onSubmitting={handleSubmitting}
          isRunning={isRunning}
        />
        <AgentFeed
          stream={stream}
          isRunning={isRunning}
          onComplete={handleComplete}
          onCancel={handleCancel}
        />
      </div>

      <CompanyList
        companies={companies}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Adicionar
            </Button>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Importar CSV/XLSX
            </Button>
          </>
        }
      />

      <AddCompanyModal open={addOpen} onOpenChange={setAddOpen} segments={segments} />
      <ImportCompaniesModal open={importOpen} onOpenChange={setImportOpen} segments={segments} />
    </div>
  );
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/components/company-list.tsx src/app/(app)/companies/client.tsx
git commit -m "feat: wire add/import company modals to companies page"
```

---

### Task 7: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Architecture tree**

Add `add-company-modal.tsx` and `import-companies-modal.tsx` to the components section in the Architecture tree.

**Step 2: Update Key Files if needed**

Add pointer to the new design doc:
```
- `docs/plans/2026-03-19-manual-batch-companies-design.md` — Manual & batch company addition design
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with new company components"
```

---

### Task 8: Manual smoke test

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test individual add**

1. Navigate to `/companies`
2. Click "Adicionar" button
3. Fill in name + website, select segment
4. Submit — verify company appears in list as "approved"
5. If website provided, wait ~30s and refresh — verify enrichment fields populated

**Step 3: Test CSV import**

1. Create test CSV:
```csv
name,website,sector
Empresa Teste 1,https://example.com,SaaS
Empresa Teste 2,,Fintech
Empresa Teste 3,https://example2.com,
```
2. Click "Importar CSV/XLSX"
3. Upload file → verify preview shows 3 rows
4. Map columns → verify live preview updates
5. Confirm → verify 3 companies appear as "approved"

**Step 4: Test XLSX import**

Repeat step 3 with an .xlsx file.

**Step 5: Test edge cases**

- Upload file with > 50 rows → verify error message
- Upload file with missing name column → verify "name" mapping is required
- Upload empty file → verify error message
