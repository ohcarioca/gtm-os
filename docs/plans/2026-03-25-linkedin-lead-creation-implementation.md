# LinkedIn Lead Creation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to paste LinkedIn profile URLs on the Contacts page and automatically scrape, score, and create leads with a preview step.

**Architecture:** New SSE API route `/api/leads/from-linkedin` processes URLs in parallel (max 3 concurrent). Frontend modal with dynamic URL inputs + editable preview table. Server action to batch-save reviewed leads.

**Tech Stack:** Next.js API Routes (SSE), Playwright (LinkedIn scraping), Claude CLI (scoring), Zod (validation), shadcn/ui (modal, table, inputs)

---

### Task 1: Add Zod schemas for LinkedIn lead creation

**Files:**
- Modify: `src/lib/validations/schemas.ts`

**Step 1: Add the new schemas at the end of the file (before the type exports)**

Add after `importProspectCompaniesSchema` (line 85):

```typescript
export const linkedinLeadRequestSchema = z.object({
  urls: z.array(
    z.string().url().regex(/linkedin\.com\/in\//, "URL deve ser um perfil LinkedIn válido")
  ).min(1, "Adicione pelo menos 1 URL").max(10, "Máximo 10 URLs por vez"),
});

export const saveLinkedinLeadsSchema = z.object({
  leads: z.array(z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    company_name: z.string().min(1),
    linkedin_url: z.string().url(),
    score: scoreEnum.optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    connections: z.number().optional(),
    about: z.string().optional(),
    message: z.string().optional(),
    bant: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
    validation: z.record(z.unknown()).optional(),
  })).min(1).max(10),
});

export type LinkedinLeadRequestInput = z.infer<typeof linkedinLeadRequestSchema>;
export type SaveLinkedinLeadsInput = z.infer<typeof saveLinkedinLeadsSchema>;
```

**Step 2: Run lint to verify**

Run: `npx next lint --file src/lib/validations/schemas.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/validations/schemas.ts
git commit -m "feat: add Zod schemas for LinkedIn lead creation"
```

---

### Task 2: Create SSE API route `/api/leads/from-linkedin`

**Files:**
- Create: `src/app/api/leads/from-linkedin/route.ts`

**Step 1: Create the API route**

```typescript
import { createClient } from "@/lib/supabase/server";
import { linkedinLeadRequestSchema } from "@/lib/validations/schemas";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { getProfile, closeBrowser, getDailyUsage, LinkedInAuthError, LinkedInLimitError } from "@/lib/linkedin-playwright";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";

export const dynamic = "force-dynamic";

const scoreResultSchema = z.object({
  score: z.object({
    total: z.number().min(0).max(100),
    dimensions: z.object({
      company_fit: z.number().min(0).max(30),
      role_fit: z.number().min(0).max(30),
      seniority: z.number().min(0).max(20),
      activity: z.number().min(0).max(20),
    }),
    justification: z.string(),
  }),
  message: z.string(),
});

function totalToGrade(total: number): string {
  if (total >= 80) return "A+";
  if (total >= 65) return "A";
  if (total >= 50) return "B";
  if (total >= 35) return "C";
  return "D";
}

async function processUrl(
  url: string,
  userId: string,
  companyProfile: { name: string; sector: string; value_proposition: string; icp: string } | null,
  targetRoles: string[],
): Promise<{
  url: string;
  status: "success" | "error" | "duplicate";
  error?: string;
  data?: {
    name: string;
    role: string;
    company_name: string;
    linkedin_url: string;
    score: string;
    score_total: number;
    score_dimensions: Record<string, number>;
    score_justification: string;
    email: string | null;
    phone: string | null;
    connections: number;
    about: string;
    message: string;
    is_recently_active: boolean;
    experience_matches_icp: boolean;
    photo_url: string | null;
  };
}> {
  try {
    // Check for duplicate in leads table
    const { createClient: createServiceClient } = await import("@supabase/supabase-js");
    const supabase = createServiceClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: existingLead } = await supabase
      .from("leads")
      .select("id")
      .eq("user_id", userId)
      .eq("linkedin_url", url)
      .limit(1)
      .single();

    if (existingLead) {
      return { url, status: "duplicate", error: "Lead já existe" };
    }

    // Check rejected_leads too
    const { data: rejected } = await supabase
      .from("rejected_leads")
      .select("id")
      .eq("user_id", userId)
      .eq("linkedin_url", url)
      .limit(1)
      .single();

    if (rejected) {
      return { url, status: "duplicate", error: "Lead foi rejeitado anteriormente" };
    }

    // Scrape LinkedIn profile
    const profile = await getProfile(url, userId, targetRoles);

    if (!profile) {
      return { url, status: "error", error: "Não foi possível obter dados do perfil" };
    }

    // Score with Claude
    const scorePrompt = `Score this B2B lead (0-100).

${companyProfile ? `SEGMENT CRITERIA:
- Target roles: ${targetRoles.join(", ")}
- ICP: ${companyProfile.icp}
- Sector: ${companyProfile.sector}
- Value proposition: ${companyProfile.value_proposition}` : `TARGET ROLES: ${targetRoles.join(", ")}`}

LEAD DATA:
- Name: ${profile.name}
- Role: ${profile.role}
- Company: ${profile.company}
- Connections: ${profile.connections}
- About: ${profile.about || "N/A"}
- Recently active: ${profile.isRecentlyActive}
- Experience matches ICP: ${profile.experienceMatchesICP}

SCORING DIMENSIONS:
1. company_fit (0-30): Does the company match the ICP?
2. role_fit (0-30): Does the role match target roles?
3. seniority (0-20): Decision-maker? Connections > 500 is a strong signal.
4. activity (0-20): Active on LinkedIn?

MESSAGE RULES:
- Max 300 characters, in Portuguese (Brazil)
- Professional but friendly tone
- Mention something specific about the person or their company
- Clear value hook${companyProfile ? `\n- My company: ${companyProfile.name} — ${companyProfile.value_proposition}` : ""}
- No excessive emojis

Return JSON: { score: { total, dimensions, justification (Portuguese) }, message }`;

    const scoreResult = await callClaudeJSON(scorePrompt, scoreResultSchema, { timeout: 60_000, model: "sonnet" });

    return {
      url,
      status: "success",
      data: {
        name: profile.name,
        role: profile.role,
        company_name: profile.company,
        linkedin_url: url,
        score: totalToGrade(scoreResult.score.total),
        score_total: scoreResult.score.total,
        score_dimensions: scoreResult.score.dimensions,
        score_justification: scoreResult.score.justification,
        email: profile.contactEmail,
        phone: profile.contactPhone,
        connections: profile.connections,
        about: profile.about,
        message: scoreResult.message,
        is_recently_active: profile.isRecentlyActive,
        experience_matches_icp: profile.experienceMatchesICP,
        photo_url: null,
      },
    };
  } catch (err) {
    if (err instanceof LinkedInAuthError) {
      return { url, status: "error", error: "auth_wall" };
    }
    if (err instanceof LinkedInLimitError) {
      return { url, status: "error", error: "rate_limit" };
    }
    console.error(`[from-linkedin] Error processing ${url}:`, err);
    return { url, status: "error", error: err instanceof Error ? err.message : "Erro desconhecido" };
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed } = checkRateLimit(user.id);
  if (!allowed) return new Response("Rate limit exceeded", { status: 429 });

  const body = await request.json();
  const parsed = linkedinLeadRequestSchema.safeParse(body);
  if (!parsed.success) {
    return new Response(JSON.stringify({ error: parsed.error.issues[0].message }), { status: 400 });
  }

  // Fetch company profile for scoring context
  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("name, sector, value_proposition, icp, default_target_roles")
    .eq("user_id", user.id)
    .single();

  const targetRoles = companyProfile?.default_target_roles ?? ["CEO", "CTO", "Founder"];

  // Check LinkedIn daily usage before starting
  const usage = await getDailyUsage(user.id);
  const availableScrapes = 100 - (usage?.scrapes_count ?? 0);
  if (availableScrapes <= 0) {
    return new Response(JSON.stringify({ error: "Limite diário de LinkedIn atingido" }), { status: 429 });
  }

  const urls = parsed.data.urls;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Send initial info
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          type: "start",
          total: urls.length,
          available_scrapes: availableScrapes,
        })}\n\n`));

        // Process URLs sequentially (LinkedIn rate-limiting + shared browser)
        for (let i = 0; i < urls.length; i++) {
          const url = urls[i];

          // Send processing status
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "processing",
            index: i,
            url,
          })}\n\n`));

          const result = await processUrl(url, user.id, companyProfile, targetRoles);

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "result",
            index: i,
            ...result,
          })}\n\n`));

          // If auth wall or rate limit, stop processing remaining
          if (result.error === "auth_wall" || result.error === "rate_limit") {
            // Mark remaining as skipped
            for (let j = i + 1; j < urls.length; j++) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                type: "result",
                index: j,
                url: urls[j],
                status: "error",
                error: result.error === "auth_wall"
                  ? "Sessão LinkedIn expirou"
                  : "Limite diário atingido",
              })}\n\n`));
            }
            break;
          }
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
      } catch (error) {
        console.error("[from-linkedin] Stream error:", error);
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({
            type: "error",
            error: error instanceof Error ? error.message : "Erro no processamento",
          })}\n\n`));
        } catch { /* stream closed */ }
      } finally {
        await closeBrowser();
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Step 2: Run lint**

Run: `npx next lint --file src/app/api/leads/from-linkedin/route.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/api/leads/from-linkedin/route.ts
git commit -m "feat: add SSE API route for LinkedIn lead creation"
```

---

### Task 3: Add server action `saveLinkedinLeads` to contacts actions

**Files:**
- Modify: `src/app/(app)/contacts/actions.ts`

**Step 1: Add the new server action**

Add at the end of the file (after `deleteLead`):

```typescript
export async function saveLinkedinLeads(data: {
  leads: Array<{
    name: string;
    role?: string;
    company_name: string;
    linkedin_url: string;
    score?: string;
    email?: string;
    phone?: string;
    connections?: number;
    about?: string;
    message?: string;
    metadata?: Record<string, unknown>;
    validation?: Record<string, unknown>;
  }>;
}) {
  const { saveLinkedinLeadsSchema } = await import("@/lib/validations/schemas");
  const parsed = saveLinkedinLeadsSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const results: string[] = [];

  for (const lead of parsed.data.leads) {
    // Find or create company
    const { data: existingCompany } = await supabase
      .from("companies")
      .select("id")
      .eq("name", lead.company_name)
      .limit(1)
      .single();

    let companyId: string;
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const { data: newCompany, error: companyError } = await supabase
        .from("companies")
        .insert({ user_id: user.id, name: lead.company_name })
        .select("id")
        .single();
      if (companyError) throw new Error(companyError.message);
      companyId = newCompany.id;
    }

    const { data: newLead, error } = await supabase.from("leads").insert({
      user_id: user.id,
      company_id: companyId,
      name: lead.name,
      role: lead.role || null,
      linkedin_url: lead.linkedin_url,
      stage: "identified",
      score: lead.score || null,
      email: lead.email || null,
      phone: lead.phone || null,
      connections: lead.connections || null,
      message: lead.message || null,
      notes: lead.about ? `LinkedIn: ${lead.about.substring(0, 500)}` : null,
      metadata: lead.metadata || null,
      validation: lead.validation || null,
    }).select("id").single();

    if (error) throw new Error(error.message);
    results.push(newLead.id);
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return results;
}
```

**Step 2: Run lint**

Run: `npx next lint --file src/app/\(app\)/contacts/actions.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add "src/app/(app)/contacts/actions.ts"
git commit -m "feat: add saveLinkedinLeads server action for batch lead creation"
```

---

### Task 4: Create the LinkedIn Leads Modal component

**Files:**
- Create: `src/components/linkedin-leads-modal.tsx`

**Step 1: Create the modal component**

This is the main UI component. It has three states:
1. **Input state** — URL inputs with "+" button
2. **Processing state** — progress as profiles are scraped/scored
3. **Preview state** — editable table with results, save button

```typescript
"use client";

import { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, X, Loader2, AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { saveLinkedinLeads } from "@/app/(app)/contacts/actions";
import { useRouter } from "next/navigation";

interface LinkedinLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LeadResult {
  url: string;
  status: "pending" | "processing" | "success" | "error" | "duplicate";
  error?: string;
  data?: {
    name: string;
    role: string;
    company_name: string;
    linkedin_url: string;
    score: string;
    score_total: number;
    email: string | null;
    phone: string | null;
    connections: number;
    about: string;
    message: string;
  };
}

function getScoreBadgeClasses(score: string): string {
  switch (score) {
    case "A+": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "A": return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "B": return "bg-amber-100 text-amber-700 border-amber-200";
    case "C": return "bg-slate-100 text-slate-600 border-slate-200";
    default: return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

const LINKEDIN_URL_REGEX = /linkedin\.com\/in\//;

export function LinkedinLeadsModal({ open, onOpenChange }: LinkedinLeadsModalProps) {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([""]);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [phase, setPhase] = useState<"input" | "processing" | "preview">("input");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addUrlInput() {
    if (urls.length >= 10) return;
    setUrls([...urls, ""]);
  }

  function removeUrlInput(index: number) {
    if (urls.length <= 1) return;
    setUrls(urls.filter((_, i) => i !== index));
  }

  function updateUrl(index: number, value: string) {
    const updated = [...urls];
    updated[index] = value;
    setUrls(updated);
  }

  const validUrls = urls.filter((u) => u.trim() && LINKEDIN_URL_REGEX.test(u));

  const startProcessing = useCallback(async () => {
    if (validUrls.length === 0) return;
    setError(null);
    setPhase("processing");

    // Initialize results
    const initial: LeadResult[] = validUrls.map((url) => ({
      url: url.trim(),
      status: "pending",
    }));
    setResults(initial);

    try {
      const response = await fetch("/api/leads/from-linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: validUrls.map((u) => u.trim()) }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Erro no servidor" }));
        setError(err.error || "Erro no servidor");
        setPhase("input");
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine);

            if (event.type === "processing") {
              setResults((prev) => prev.map((r, i) =>
                i === event.index ? { ...r, status: "processing" } : r
              ));
            }

            if (event.type === "result") {
              setResults((prev) => prev.map((r, i) =>
                i === event.index ? {
                  url: event.url,
                  status: event.status,
                  error: event.error,
                  data: event.data,
                } : r
              ));
            }

            if (event.type === "done") {
              setPhase("preview");
            }

            if (event.type === "error") {
              setError(event.error);
              setPhase("preview");
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de conexão");
      setPhase("input");
    }
  }, [validUrls]);

  function removeResult(index: number) {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }

  function updateResultField(index: number, field: string, value: string) {
    setResults((prev) => prev.map((r, i) => {
      if (i !== index || !r.data) return r;
      return { ...r, data: { ...r.data, [field]: value } };
    }));
  }

  const successResults = results.filter((r) => r.status === "success" && r.data);

  async function handleSave() {
    if (successResults.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      await saveLinkedinLeads({
        leads: successResults.map((r) => ({
          name: r.data!.name,
          role: r.data!.role || undefined,
          company_name: r.data!.company_name,
          linkedin_url: r.data!.linkedin_url,
          score: r.data!.score || undefined,
          email: r.data!.email || undefined,
          phone: r.data!.phone || undefined,
          connections: r.data!.connections,
          about: r.data!.about || undefined,
          message: r.data!.message || undefined,
        })),
      });
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar leads");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setUrls([""]);
    setResults([]);
    setPhase("input");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={phase === "input" ? "max-w-lg" : "max-w-4xl max-h-[90vh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle>
            {phase === "input" && "Adicionar via LinkedIn"}
            {phase === "processing" && "Buscando perfis..."}
            {phase === "preview" && "Revisar leads"}
          </DialogTitle>
          <DialogDescription>
            {phase === "input" && "Cole os links de perfis do LinkedIn para criar leads automaticamente."}
            {phase === "processing" && "Extraindo dados e calculando score de cada perfil."}
            {phase === "preview" && "Revise os dados antes de salvar. Você pode editar ou remover leads."}
          </DialogDescription>
        </DialogHeader>

        {/* Input phase */}
        {phase === "input" && (
          <div className="space-y-4">
            <div className="space-y-2">
              {urls.map((url, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={url}
                    onChange={(e) => updateUrl(i, e.target.value)}
                    placeholder="https://linkedin.com/in/nome-do-perfil"
                    className={url && !LINKEDIN_URL_REGEX.test(url) ? "border-red-300" : ""}
                  />
                  {urls.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeUrlInput(i)}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {urls.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addUrlInput}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar outro link
              </Button>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={startProcessing}
              disabled={validUrls.length === 0}
              className="w-full"
            >
              Buscar {validUrls.length} {validUrls.length === 1 ? "perfil" : "perfis"}
            </Button>
          </div>
        )}

        {/* Processing phase */}
        {phase === "processing" && (
          <div className="space-y-3">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                {r.status === "pending" && (
                  <div className="h-4 w-4 rounded-full bg-slate-200" />
                )}
                {r.status === "processing" && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                )}
                {r.status === "success" && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
                {(r.status === "error" || r.status === "duplicate") && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {r.data?.name || r.url}
                  </p>
                  {r.error && (
                    <p className="text-xs text-red-500">{r.error}</p>
                  )}
                  {r.data && (
                    <p className="text-xs text-slate-500">
                      {r.data.role} @ {r.data.company_name}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preview phase */}
        {phase === "preview" && (
          <div className="space-y-4">
            {/* Error/duplicate rows */}
            {results.filter((r) => r.status !== "success").length > 0 && (
              <div className="space-y-1">
                {results.filter((r) => r.status !== "success").map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-slate-500">
                    <AlertCircle className="h-3 w-3 text-red-400" />
                    <span className="truncate">{r.url}</span>
                    <span className="text-red-500">— {r.error}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Success table */}
            {successResults.length > 0 && (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => {
                      if (r.status !== "success" || !r.data) return null;
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <Input
                              value={r.data.name}
                              onChange={(e) => updateResultField(i, "name", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.data.role}
                              onChange={(e) => updateResultField(i, "role", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.data.company_name}
                              onChange={(e) => updateResultField(i, "company_name", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={getScoreBadgeClasses(r.data.score)}>
                              {r.data.score} ({r.data.score_total})
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.data.email || ""}
                              onChange={(e) => updateResultField(i, "email", e.target.value)}
                              className="h-8 text-sm"
                              placeholder="—"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeResult(i)}
                              className="h-8 w-8"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || successResults.length === 0}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  `Salvar ${successResults.length} ${successResults.length === 1 ? "lead" : "leads"}`
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Run lint**

Run: `npx next lint --file src/components/linkedin-leads-modal.tsx`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/linkedin-leads-modal.tsx
git commit -m "feat: add LinkedIn leads modal with URL input, SSE progress, and editable preview"
```

---

### Task 5: Wire the modal into the Contacts page

**Files:**
- Modify: `src/components/contacts-table.tsx`

**Step 1: Add import for the new modal**

Add after the existing `AddLeadModal` import (line 15):

```typescript
import { LinkedinLeadsModal } from "@/components/linkedin-leads-modal";
```

**Step 2: Add state for the new modal**

Inside the `ContactsTable` component, add after the `showAddModal` state (line 90):

```typescript
const [showLinkedinModal, setShowLinkedinModal] = useState(false);
```

**Step 3: Add the LinkedIn button next to the existing "Adicionar Lead" button**

Find the button that opens `showAddModal` and add a new button next to it. The toolbar section with the Plus icon and "Adicionar Lead" text — add a second button before or after it:

```typescript
<Button
  variant="outline"
  size="sm"
  onClick={() => setShowLinkedinModal(true)}
>
  <Sparkles className="h-4 w-4 mr-2" />
  Via LinkedIn
</Button>
```

**Step 4: Add the modal component**

Next to the existing `<AddLeadModal />`, add:

```typescript
<LinkedinLeadsModal open={showLinkedinModal} onOpenChange={setShowLinkedinModal} />
```

**Step 5: Run lint**

Run: `npx next lint --file src/components/contacts-table.tsx`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/contacts-table.tsx
git commit -m "feat: wire LinkedIn leads modal into contacts page"
```

---

### Task 6: Test the full flow manually and fix issues

**Files:**
- Potentially: any file from Tasks 1-5

**Step 1: Run the dev server**

Run: `npm run dev`
Expected: Server starts without errors

**Step 2: Run full lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Fix any issues found, commit**

```bash
git add -A
git commit -m "fix: address lint and build issues in LinkedIn lead creation"
```

---

### Task 7: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the Architecture tree**

Add under `src/app/api/`:
```
│   │   ├── leads/from-linkedin/ # SSE streaming for LinkedIn lead creation
```

Add under `src/components/`:
```
│   ├── linkedin-leads-modal.tsx  # LinkedIn URL → scrape → score → create leads
```

**Step 2: Add design doc to Key Files**

Add to the design docs list:
```
- `docs/plans/2026-03-25-linkedin-lead-creation-design.md` — Create leads from LinkedIn URLs (scrape + score + preview)
- `docs/plans/2026-03-25-linkedin-lead-creation-implementation.md` — LinkedIn lead creation implementation plan (7 tasks)
```

**Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with LinkedIn lead creation feature"
```
