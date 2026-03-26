# Search Separation & Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fully separate company and lead search pipelines, optimize token usage with two-stage triage and merged score+enrich, and build a chat-style dashboard as the entry point.

**Architecture:** State machine-driven chat UI on the dashboard, two independent LangGraph pipelines (companies and leads), Haiku snippet triage for companies, single Sonnet call for lead scoring+enrichment reusing saved company markdown.

**Tech Stack:** Next.js 14, LangGraph.js, Claude CLI (Haiku/Sonnet), Serper, Playwright, Firecrawl, Supabase, Tailwind, shadcn/ui

---

### Task 1: Database Migration — Add company_markdown Column

**Files:**
- Create: `supabase/migrations/016_add_company_markdown.sql`

**Step 1: Write the migration**

```sql
-- Add company_markdown to prospect_companies for reuse in lead scoring
ALTER TABLE prospect_companies ADD COLUMN IF NOT EXISTS company_markdown text;
```

**Step 2: Apply migration**

Run: `npx supabase db push` (or apply via Supabase dashboard)

**Step 3: Update database types**

Modify: `src/lib/types/database.ts` — add `company_markdown: string | null` to the `prospect_companies` row type.

**Step 4: Commit**

```bash
git add supabase/migrations/016_add_company_markdown.sql src/lib/types/database.ts
git commit -m "feat: add company_markdown column to prospect_companies"
```

---

### Task 2: Company Discovery — Add triage_snippets Node

**Files:**
- Create: `src/lib/agent/company-discovery/nodes/triage-snippets.ts`
- Modify: `src/lib/agent/company-discovery/state.ts`
- Modify: `src/lib/agent/company-discovery/graph.ts`

**Step 1: Update company discovery state**

In `src/lib/agent/company-discovery/state.ts`, the `pendingUrls` already exists. Add a field to hold triage-approved URLs:

```typescript
// After pendingUrls field, add:
triageApprovedUrls: Annotation<{ url: string; title: string; snippet: string }[]>({
  reducer: (_a, b) => b,
  default: () => [],
}),
```

**Step 2: Create triage-snippets node**

Create `src/lib/agent/company-discovery/nodes/triage-snippets.ts`:

```typescript
import { CompanyDiscoveryStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";

const triageResultSchema = z.object({
  approved: z.array(z.object({
    url: z.string(),
    reason: z.string(),
  })),
});

export async function triageSnippets(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const { pendingUrls, sector, sizes, companyProfile } = state;

  if (!pendingUrls || pendingUrls.length === 0) {
    return {
      triageApprovedUrls: [],
      log: [{ step: "triage_snippets", message: "Nenhuma URL para triar", timestamp: new Date().toISOString() }],
    };
  }

  // pendingUrls now needs to carry title+snippet from search_companies
  // We'll refactor search_companies to store {url, title, snippet} objects
  const urlList = pendingUrls.map((u, i) =>
    `${i + 1}. URL: ${u.url}\n   Título: ${u.title}\n   Snippet: ${u.snippet}`
  ).join("\n\n");

  const icpContext = companyProfile?.icp || "";
  const prompt = `Analise estas URLs encontradas no Google e determine quais são sites de EMPRESAS REAIS que podem ser potenciais clientes.

SETOR ALVO: ${sector}
PORTES DESEJADOS: ${(sizes || []).join(", ")}
${icpContext ? `PERFIL ICP: ${icpContext}` : ""}

URLs ENCONTRADAS:
${urlList}

REGRAS DE REJEIÇÃO:
- Blogs, artigos de notícia, listas genéricas ("Top 10 empresas...")
- Redes sociais (LinkedIn, Facebook, Instagram)
- Sites de emprego (Glassdoor, Indeed)
- Diretórios genéricos sem informação de empresa específica
- Páginas governamentais ou acadêmicas

REGRAS DE APROVAÇÃO:
- Site institucional de empresa (domínio próprio)
- Página "sobre" ou "quem somos" de empresa
- Site com informações de produtos/serviços de empresa

Retorne APENAS as URLs que parecem ser sites de empresas reais.`;

  try {
    const result = await callClaudeJSON(prompt, triageResultSchema, {
      timeout: 30_000,
      model: "haiku",
    });

    const approvedUrls = result.approved
      .map(a => pendingUrls.find(u => u.url === a.url))
      .filter(Boolean);

    return {
      triageApprovedUrls: approvedUrls,
      log: [{
        step: "triage_snippets",
        message: `Triagem: ${approvedUrls.length}/${pendingUrls.length} URLs aprovadas`,
        timestamp: new Date().toISOString(),
      }],
    };
  } catch (error) {
    // On error, pass all URLs through (fail open)
    return {
      triageApprovedUrls: pendingUrls,
      log: [{
        step: "triage_snippets",
        message: `Erro na triagem, passando todas URLs: ${error}`,
        timestamp: new Date().toISOString(),
      }],
    };
  }
}
```

**Step 3: Refactor search_companies to store title+snippet**

Modify `src/lib/agent/company-discovery/nodes/search-companies.ts`:
- Change `pendingUrls` from `string[]` to `{ url: string; title: string; snippet: string }[]`
- When collecting results from Serper, keep the title and snippet alongside the URL

Update state type accordingly — `pendingUrls` becomes `{ url: string; title: string; snippet: string }[]`.

**Step 4: Wire triage_snippets into the graph**

Modify `src/lib/agent/company-discovery/graph.ts`:
- Add `triage_snippets` node after `search_companies`
- Route: `search_companies → triage_snippets → scrape_company`
- `scrape_company` now reads from `triageApprovedUrls` instead of `pendingUrls`

**Step 5: Update scrape_company to use triageApprovedUrls**

Modify `src/lib/agent/company-discovery/nodes/scrape-company.ts`:
- Read `currentUrl` from `triageApprovedUrls` instead of `pendingUrls`

**Step 6: Save markdown in save_company**

Modify `src/lib/agent/company-discovery/nodes/save-company.ts`:
- Include `company_markdown: state.currentMarkdown` when inserting into `prospect_companies`

**Step 7: Commit**

```bash
git add src/lib/agent/company-discovery/
git commit -m "feat: add snippet triage to company discovery pipeline"
```

---

### Task 3: Lead Pipeline — Remove triage_company, Simplify find_lead

**Files:**
- Modify: `src/lib/agent/graph.ts`
- Modify: `src/lib/agent/nodes/find-lead.ts`
- Delete: `src/lib/agent/nodes/triage-company.ts` (remove after rewiring)

**Step 1: Simplify find_lead to company-first only**

Modify `src/lib/agent/nodes/find-lead.ts`:
- Remove all "open dork" / ICP-based query generation (Priority 2)
- Remove Claude CLI call for dork query generation
- Keep only company-first mode:
  - `method=full`: Template dork `site:linkedin.com/in "[role]" "[company]"` via Serper, fallback LinkedIn search
  - `method=linkedin_direct`: LinkedIn search via Playwright directly
- Rotate through `targetCompanies` using `currentCompanyIndex` and `currentRoleIndex` (keep existing logic)

Template dork (no LLM):
```typescript
const dorkQuery = `site:linkedin.com/in "${role}" "${companyName}"`;
const results = await googleSearch(dorkQuery);
```

**Step 2: Remove triage_company from graph**

Modify `src/lib/agent/graph.ts`:
- Remove `triage_company` node
- Remove `companyPassesTriage` conditional
- Route: `find_lead → validate_profile` (direct)
- Remove import of `triageCompany`

**Step 3: Clean up state**

Modify `src/lib/agent/state.ts`:
- Remove `companyTriage` field (no longer used)
- Remove `companyTypes` field (no longer used — ICP scope removed from leads)
- Remove `searchTerms` field (no longer used — was for open dork)

**Step 4: Delete triage-company.ts**

```bash
rm src/lib/agent/nodes/triage-company.ts
```

**Step 5: Commit**

```bash
git add src/lib/agent/
git commit -m "refactor: remove triage_company, simplify find_lead to company-first only"
```

---

### Task 4: Lead Pipeline — Merge score_lead + enrich_lead into score_and_enrich

**Files:**
- Create: `src/lib/agent/nodes/score-and-enrich.ts`
- Modify: `src/lib/agent/graph.ts`
- Delete: `src/lib/agent/nodes/score-lead.ts`
- Delete: `src/lib/agent/nodes/enrich-lead.ts`

**Step 1: Create score-and-enrich node**

Create `src/lib/agent/nodes/score-and-enrich.ts`:

```typescript
import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";
import { createClient } from "@supabase/supabase-js";

const scoreAndEnrichSchema = z.object({
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
  enrichment: z.object({
    description: z.string(),
    sector: z.string(),
    employee_count: z.number().nullable(),
    products: z.array(z.string()),
    tech_stack: z.array(z.string()),
    is_hiring: z.boolean().nullable(),
    contact_email: z.string().nullable(),
    contact_phone: z.string().nullable(),
  }),
  message: z.string(),
});

export async function scoreAndEnrich(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const { currentDecisionMaker, currentCompany, companyProfile, targetRoles, region } = state;

  if (!currentDecisionMaker || !currentCompany) {
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ step: "score_and_enrich", message: "Dados insuficientes para scoring", timestamp: new Date().toISOString() }],
    };
  }

  // Fetch company_markdown from prospect_companies if available
  let companyMarkdown = "";
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await supabase
      .from("prospect_companies")
      .select("company_markdown")
      .eq("user_id", state.userId)
      .ilike("name", `%${currentCompany.name}%`)
      .not("company_markdown", "is", null)
      .limit(1)
      .single();
    if (data?.company_markdown) {
      companyMarkdown = data.company_markdown.slice(0, 3000);
    }
  } catch {
    // No markdown available, proceed without
  }

  const companyMismatch = currentCompany.name &&
    currentDecisionMaker.company &&
    !currentDecisionMaker.company.toLowerCase().includes(currentCompany.name.toLowerCase());

  const prompt = `Avalie este lead e extraia dados da empresa para prospecção B2B.

CRITÉRIOS DO SEGMENTO:
- Cargos alvo: ${targetRoles.join(", ")}
- Região: ${region}
${companyProfile ? `- ICP: ${companyProfile.icp}` : ""}

DADOS DO LEAD (LinkedIn):
- Nome: ${currentDecisionMaker.name}
- Cargo: ${currentDecisionMaker.role}
- Empresa atual: ${currentDecisionMaker.company}
- Conexões: ${currentDecisionMaker.connections || "N/A"}
- Sobre: ${currentDecisionMaker.about || "N/A"}
- Última atividade: ${currentDecisionMaker.lastActivityDate || "N/A"}
${companyMismatch ? `⚠️ ATENÇÃO: Empresa no LinkedIn (${currentDecisionMaker.company}) difere da empresa buscada (${currentCompany.name}). Penalize company_fit.` : ""}

EMPRESA BUSCADA: ${currentCompany.name}
Website: ${currentCompany.website || "N/A"}

${companyMarkdown ? `DADOS DA EMPRESA (website scraped):\n${companyMarkdown}` : "Sem dados do website disponíveis."}

SCORING (total = soma das dimensões):
- company_fit (0-30): Alinhamento com ICP (setor, porte, relevância)
- role_fit (0-30): Match exato/parcial com cargos alvo
- seniority (0-20): Sinal de decisor (conexões > 500 = forte)
- activity (0-20): Atividade recente no LinkedIn

ENRICHMENT: Extraia da empresa (se disponível no markdown):
- description, sector, employee_count, products, tech_stack, is_hiring
- contact_email, contact_phone (se encontrados)

MENSAGEM: Escreva uma mensagem de conexão LinkedIn em PT-BR:
- Máximo 300 caracteres
- Mencione detalhes específicos da pessoa/empresa
- Inclua hook de valor
- Tom profissional mas próximo`;

  try {
    const result = await callClaudeJSON(prompt, scoreAndEnrichSchema, {
      timeout: 60_000,
      model: "sonnet",
    });

    const updatedCompany = {
      ...currentCompany,
      metadata: {
        ...currentCompany.metadata,
        enrichment: result.enrichment,
      },
    };

    const updatedDM = {
      ...currentDecisionMaker,
      email: currentDecisionMaker.email || result.enrichment.contact_email,
      phone: currentDecisionMaker.phone || result.enrichment.contact_phone,
    };

    return {
      currentScore: {
        total: result.score.total,
        dimensions: result.score.dimensions,
        justification: result.score.justification,
        message: result.message,
      },
      currentCompany: updatedCompany,
      currentDecisionMaker: updatedDM,
      log: [{
        step: "score_and_enrich",
        message: `Score: ${result.score.total}/100 | Empresa enriquecida | Mensagem gerada`,
        timestamp: new Date().toISOString(),
      }],
    };
  } catch (error) {
    return {
      searchRetries: state.searchRetries + 1,
      log: [{
        step: "score_and_enrich",
        message: `Erro no scoring/enrich: ${error}`,
        timestamp: new Date().toISOString(),
      }],
    };
  }
}
```

**Step 2: Update graph to use merged node**

Modify `src/lib/agent/graph.ts`:
- Replace `score_lead` → `enrich_lead` → `create_lead` with `score_and_enrich` → `create_lead`
- Import `scoreAndEnrich` instead of `scoreLead` and `enrichLeadNode`
- Route: `validate_profile → [isValid] → score_and_enrich → [meetsThreshold] → create_lead`

**Step 3: Delete old files**

```bash
rm src/lib/agent/nodes/score-lead.ts src/lib/agent/nodes/enrich-lead.ts
```

**Step 4: Commit**

```bash
git add src/lib/agent/
git commit -m "feat: merge score+enrich into single Sonnet call, reuse company markdown"
```

---

### Task 5: Update Prospect API — Remove ICP Scope

**Files:**
- Modify: `src/app/api/prospect/route.ts`
- Modify: `src/lib/validations/schemas.ts`

**Step 1: Simplify prospect request schema**

Modify `src/lib/validations/schemas.ts`:
- Remove the ICP scope variant from `prospectRequestSchema`
- Keep only the companies scope:

```typescript
export const prospectRequestSchema = z.object({
  method: z.enum(["full", "linkedin_direct"]),
  quantity: z.number().int().min(1).max(20),
  company_ids: z.array(z.string().uuid()).min(1).max(50),
  target_roles: z.array(z.string().min(1)).min(1),
  min_score_threshold: z.number().int().min(0).max(100).default(70),
});
```

**Step 2: Simplify prospect API route**

Modify `src/app/api/prospect/route.ts`:
- Remove ICP/open scope handling
- Always fetch approved companies by `company_ids`
- Remove `companyTypes` from state initialization
- Remove `searchTerms` from state initialization

**Step 3: Commit**

```bash
git add src/app/api/prospect/route.ts src/lib/validations/schemas.ts
git commit -m "refactor: simplify prospect API to companies-only scope"
```

---

### Task 6: Chat Parse API Endpoint

**Files:**
- Create: `src/app/api/chat/parse/route.ts`

**Step 1: Create the parse endpoint**

```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase/server";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";
import { checkRateLimit } from "@/lib/security/rate-limit";

const parseResultSchema = z.object({
  action: z.enum(["search_leads", "search_companies"]),
  params: z.object({
    target_roles: z.array(z.string()).optional(),
    region: z.string().optional(),
    sector: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    quantity: z.number().optional(),
  }),
  missing: z.array(z.string()),
});

export async function POST(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await checkRateLimit(user.id);
  if (limited) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const { text, context } = await request.json();
  if (!text || typeof text !== "string") {
    return NextResponse.json({ error: "Text is required" }, { status: 400 });
  }

  // Fetch company profile for context
  const { data: profile } = await supabase
    .from("company_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const prompt = `Extraia parâmetros de busca deste texto do usuário.

CONTEXTO: O usuário quer ${context === "companies" ? "buscar empresas" : "buscar leads"}.
${profile ? `PERFIL DA EMPRESA: ${profile.name}, setor: ${profile.sector}, ICP: ${profile.icp}` : ""}

TEXTO DO USUÁRIO: "${text}"

Extraia os parâmetros que conseguir identificar:
- action: "search_leads" ou "search_companies"
- target_roles: cargos mencionados
- region: região/cidade/estado
- sector: setor/indústria
- sizes: portes de empresa (small, medium, large)
- keywords: palavras-chave relevantes
- quantity: quantidade desejada

Em "missing", liste os campos obrigatórios que NÃO foram mencionados:
- Para search_companies: sector e region são obrigatórios
- Para search_leads: target_roles é obrigatório`;

  try {
    const result = await callClaudeJSON(prompt, parseResultSchema, {
      timeout: 15_000,
      model: "haiku",
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: "Failed to parse" }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/chat/parse/route.ts
git commit -m "feat: add chat text parsing endpoint with Haiku"
```

---

### Task 7: Chat Dashboard — State Machine Component

**Files:**
- Create: `src/components/chat-dashboard.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`
- Modify: `src/app/(app)/dashboard/actions.ts` (if needed)

This is the largest task. Use the frontend-design skill for the UI implementation.

**Step 1: Define state machine types**

```typescript
type ChatState = "idle" | "choosing_action" | "configuring_companies" | "configuring_leads" | "confirming" | "running" | "results";

type ChatMessage = {
  id: string;
  role: "system" | "user" | "agent";
  content: string;
  timestamp: Date;
  quickActions?: QuickAction[];
  paramCard?: ParamCard;
  leadCard?: LeadCard;
  companyCard?: CompanyCard;
};

type QuickAction = {
  label: string;
  icon?: string;
  action: () => void;
  variant?: "default" | "outline";
};
```

**Step 2: Build the chat-dashboard component**

Create `src/components/chat-dashboard.tsx` ("use client"):

Key sections:
1. **Message list** — scrollable area rendering ChatMessage items
2. **Input bar** — text input at bottom with send button
3. **Quick actions** — rendered as buttons below messages, change per state
4. **Parameter cards** — inline editable forms for configuring searches
5. **SSE integration** — connects to existing `/api/prospect` and `/api/companies/discover` endpoints
6. **Result cards** — lead/company cards rendered inline as they stream in

**State transitions:**
- `idle` → user clicks "Busca por empresa" → `configuring_companies`
- `idle` → user clicks "Buscar Leads" → check approved companies count → `choosing_action` or suggest company search
- `choosing_action` → user clicks method → `configuring_leads`
- `configuring_*` → user clicks "Iniciar" → `confirming`
- `confirming` → user clicks "Confirmar" → `running` (start SSE)
- `running` → SSE completes → `results`
- `results` → user clicks "Nova busca" → `idle`

**Quick actions per state:**
- `idle`: ["Busca por empresa", "Buscar Leads"] + ICP type shortcuts (from company_profiles.icp_company_types)
- `choosing_action`: ["Busca Completa", "LinkedIn Direto"] + ICP type filters
- `configuring_*`: ["Iniciar", "Cancelar"]
- `running`: ["Cancelar"]
- `results`: ["Ver resultados", "Buscar mais", "Nova busca"]

**Step 3: Text input handling**

When user types text instead of clicking quick actions:
1. POST to `/api/chat/parse` with text + current context
2. If result has `missing` fields → show system message asking for them
3. If result is complete → populate param card and go to `confirming`

**Step 4: Wire into dashboard page**

Modify `src/app/(app)/dashboard/page.tsx`:
- Fetch user's company profile, approved companies count, ICP types
- Pass as props to `<ChatDashboard />`
- Keep existing `<DashboardContent>` as a secondary view or remove

**Step 5: Commit**

```bash
git add src/components/chat-dashboard.tsx src/app/(app)/dashboard/
git commit -m "feat: add chat dashboard with state machine UI"
```

---

### Task 8: Remove Old Prospect Form Page

**Files:**
- Modify: `src/components/prospect-form.tsx` — keep but simplify (remove ICP scope)
- Modify: `src/app/(app)/prospect/` — redirect to dashboard or remove

**Step 1: Simplify prospect-form.tsx**

- Remove ICP scope option (radio group now only has method)
- Remove `companyTypes`, `selectedTypes` state
- Remove ICP-related UI (company type chips, region for ICP)
- Scope is always "companies" — the form just selects which approved companies

**Step 2: Decide on prospect page**

Option A: Remove `/prospect` page, redirect to dashboard
Option B: Keep as standalone form accessible from sidebar for power users

Recommend: Keep as standalone but simplify. The chat dashboard is the primary entry point.

**Step 3: Commit**

```bash
git add src/components/prospect-form.tsx src/app/(app)/prospect/
git commit -m "refactor: simplify prospect form to companies-only scope"
```

---

### Task 9: Update Sidebar Navigation

**Files:**
- Modify: `src/components/sidebar.tsx`

**Step 1: Update sidebar links**

- "Nova Busca" → links to `/dashboard` (chat)
- "Perfil ICP" → stays
- "Empresas" → stays
- "Leads" → stays
- "Pipeline" → stays
- Remove "Prospect" link if it existed separately

Match sidebar items to the image: Nova Busca, Perfil ICP, Empresas, Leads, Pipeline.

**Step 2: Add "Execuções" section**

The image shows an "Execuções" section in the sidebar below the main nav, listing recent agent runs. Fetch from `agent_runs` table.

**Step 3: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: update sidebar to match new navigation structure"
```

---

### Task 10: Update CLAUDE.md and Memory

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Architecture tree**

- Add `src/components/chat-dashboard.tsx`
- Add `src/lib/agent/company-discovery/nodes/triage-snippets.ts`
- Add `src/lib/agent/nodes/score-and-enrich.ts`
- Add `src/app/api/chat/parse/route.ts`
- Remove `src/lib/agent/nodes/triage-company.ts`
- Remove `src/lib/agent/nodes/score-lead.ts`
- Remove `src/lib/agent/nodes/enrich-lead.ts`

**Step 2: Update Agent Pipeline section**

- Update prospecting pipeline flow: `find_lead → validate_profile → score_and_enrich → create_lead → loop`
- Update company discovery flow: add `triage_snippets` step
- Note: leads always based on approved companies, no ICP scope
- Note: score+enrich merged, reuses company_markdown

**Step 3: Update Migrations list**

- Add `016_add_company_markdown.sql`

**Step 4: Update Key Files — Design & Plans**

- Add `docs/plans/2026-03-25-search-separation-design.md`
- Add `docs/plans/2026-03-25-search-separation-implementation.md`

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for search separation changes"
```

---

## Task Dependency Order

```
Task 1 (DB migration) ← independent, do first
Task 2 (triage_snippets) ← depends on Task 1
Task 3 (simplify find_lead, remove triage_company) ← independent of Task 2
Task 4 (merge score+enrich) ← depends on Task 1 (company_markdown)
Task 5 (simplify prospect API) ← depends on Tasks 3, 4
Task 6 (chat parse API) ← independent
Task 7 (chat dashboard UI) ← depends on Tasks 5, 6
Task 8 (simplify prospect form) ← depends on Task 5
Task 9 (sidebar) ← depends on Task 7
Task 10 (docs) ← last
```

**Parallelizable groups:**
- Group 1: Tasks 1, 3, 6 (independent)
- Group 2: Tasks 2, 4 (depend on Task 1)
- Group 3: Task 5 (depends on 3, 4)
- Group 4: Tasks 7, 8 (depend on 5, 6)
- Group 5: Tasks 9, 10 (final)
