# Company-First Prospecting Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add company discovery page and company-first prospecting to improve lead quality.

**Architecture:** New `/companies` page with discovery pipeline (Serper → Firecrawl → Claude CLI). New `prospect_companies` DB table. Updated `find-lead` node uses approved companies for targeted LinkedIn searches, falling back to current open queries when no companies exist.

**Tech Stack:** Next.js 14 (App Router), LangGraph.js, Supabase, Playwright, Firecrawl, Claude CLI, Tailwind CSS, shadcn/ui

**Design doc:** `docs/plans/2026-03-19-company-first-prospecting-design.md`

---

### Task 1: Database Migration — `prospect_companies` table

**Files:**
- Create: `supabase/migrations/011_add_prospect_companies.sql`

**Step 1: Write the migration**

```sql
-- Prospect companies table (companies found by discovery pipeline)
CREATE TABLE prospect_companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID REFERENCES segments(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  website TEXT,
  sector TEXT,
  size TEXT,
  region TEXT,
  description TEXT,
  tech_stack TEXT,
  products TEXT,
  hiring_status TEXT,
  icp_score INTEGER DEFAULT 0,
  icp_justification TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'approved', 'rejected')),
  source TEXT NOT NULL DEFAULT 'serper' CHECK (source IN ('serper', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prospect_companies_user ON prospect_companies(user_id);
CREATE INDEX idx_prospect_companies_status ON prospect_companies(user_id, status);
CREATE INDEX idx_prospect_companies_segment ON prospect_companies(segment_id);

ALTER TABLE prospect_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own prospect_companies"
  ON prospect_companies FOR ALL USING (auth.uid() = user_id);
```

**Step 2: Run migration against Supabase**

Run: `npx supabase db push` or apply directly in Supabase dashboard.

**Step 3: Commit**

```bash
git add supabase/migrations/011_add_prospect_companies.sql
git commit -m "feat: add prospect_companies table migration"
```

---

### Task 2: TypeScript Types and Zod Schema

**Files:**
- Modify: `src/lib/types/database.ts`
- Modify: `src/lib/validations/schemas.ts`

**Step 1: Add ProspectCompany type**

In `src/lib/types/database.ts`, add after the `CompanyProfile` interface:

```typescript
export type ProspectCompanyStatus = "new" | "approved" | "rejected";

export interface ProspectCompany {
  id: string;
  user_id: string;
  segment_id: string | null;
  name: string;
  website: string | null;
  sector: string | null;
  size: string | null;
  region: string | null;
  description: string | null;
  tech_stack: string | null;
  products: string | null;
  hiring_status: string | null;
  icp_score: number;
  icp_justification: string | null;
  status: ProspectCompanyStatus;
  source: string;
  created_at: string;
}
```

**Step 2: Add Zod schemas**

In `src/lib/validations/schemas.ts`, add:

```typescript
export const companyDiscoveryRequestSchema = z.object({
  sector: z.string().min(1).max(200),
  region: z.string().min(1).max(100),
  sizes: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
  freeText: z.string().max(500).optional().default(""),
  quantity: z.number().int().min(1).max(20),
  segment_id: z.string().uuid().optional(),
});

export const updateProspectCompanySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "approved", "rejected"]),
});

export type CompanyDiscoveryRequestInput = z.infer<typeof companyDiscoveryRequestSchema>;
export type UpdateProspectCompanyInput = z.infer<typeof updateProspectCompanySchema>;
```

**Step 3: Commit**

```bash
git add src/lib/types/database.ts src/lib/validations/schemas.ts
git commit -m "feat: add ProspectCompany types and validation schemas"
```

---

### Task 3: Company Discovery Pipeline — LangGraph Nodes

**Files:**
- Create: `src/lib/agent/company-discovery/state.ts`
- Create: `src/lib/agent/company-discovery/nodes/build-queries.ts`
- Create: `src/lib/agent/company-discovery/nodes/search-companies.ts`
- Create: `src/lib/agent/company-discovery/nodes/scrape-company.ts`
- Create: `src/lib/agent/company-discovery/nodes/analyze-company.ts`
- Create: `src/lib/agent/company-discovery/nodes/save-company.ts`
- Create: `src/lib/agent/company-discovery/graph.ts`

**Step 1: Define state**

`src/lib/agent/company-discovery/state.ts`:

```typescript
import { Annotation } from "@langchain/langgraph";

export const CompanyDiscoveryState = Annotation.Root({
  userId: Annotation<string>(),
  segmentId: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  sector: Annotation<string>(),
  region: Annotation<string>(),
  sizes: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  keywords: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  freeText: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => "",
  }),
  quantity: Annotation<number>(),
  companyProfile: Annotation<{
    name: string;
    sector: string;
    value_proposition: string;
    icp: string;
  } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  // Working state
  searchQueries: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  pendingUrls: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  currentUrl: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  currentMarkdown: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  companiesSaved: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  companiesProcessed: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  searchRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  errorRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  log: Annotation<Array<{ step: string; message: string; timestamp: string }>>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type CompanyDiscoveryStateType = typeof CompanyDiscoveryState.State;
```

**Step 2: Build queries node**

`src/lib/agent/company-discovery/nodes/build-queries.ts`:

```typescript
import { z } from "zod";
import { CompanyDiscoveryStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const queriesSchema = z.object({
  queries: z.array(z.string()).min(1).max(10),
});

export async function buildCompanyQueries(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "build_queries", message: "", timestamp: new Date().toISOString() };

  try {
    const prompt = `You are a Google search expert for finding B2B companies.

Context:
- Sector: ${state.sector}
- Region: ${state.region}
- Company sizes: ${state.sizes.join(", ") || "any"}
- Keywords: ${state.keywords.join(", ") || "none"}
- Additional context: ${state.freeText || "none"}
- User's company ICP: ${state.companyProfile ? state.companyProfile.icp : "N/A"}
- Already found: ${state.companiesProcessed.length} companies

Generate 5-10 Google search queries to find companies in this sector/region.

Rules:
- Do NOT use site:linkedin.com — we want company websites and news articles
- Use varied strategies: direct company searches, industry lists, news articles, directories
- Include Portuguese AND English variations
- Target company websites, industry publications, startup databases, rankings
- Examples of good queries:
  - "fintechs em São Paulo lista 2025"
  - "empresas de tecnologia série A Brasil"
  - "top SaaS companies São Paulo"
  - "startups healthtech SP funding"

Return JSON: {"queries": ["query1", "query2", ...]}`;

    const result = await callClaudeJSON(prompt, queriesSchema, { timeout: 60_000 });
    log.message = `${result.queries.length} queries de busca geradas`;

    return {
      searchQueries: result.queries,
      log: [log],
    };
  } catch (err) {
    console.error("[build-company-queries] Error:", err);
    return {
      searchQueries: [
        `"${state.sector}" "${state.region}" empresas`,
        `"${state.sector}" companies "${state.region}"`,
      ],
      log: [{ ...log, message: "Fallback queries usadas" }],
    };
  }
}
```

**Step 3: Search companies node**

`src/lib/agent/company-discovery/nodes/search-companies.ts`:

```typescript
import { CompanyDiscoveryStateType } from "../state";
import { googleSearch } from "@/lib/google-search";

const SOCIAL_DOMAINS = [
  "linkedin.com", "facebook.com", "instagram.com",
  "twitter.com", "x.com", "glassdoor.com", "youtube.com",
  "tiktok.com", "wikipedia.org",
];

export async function searchCompanies(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "search_companies", message: "", timestamp: new Date().toISOString() };

  try {
    const allUrls: string[] = [];
    const seen = new Set(state.companiesProcessed);

    for (const query of state.searchQueries) {
      const results = await googleSearch(query);

      for (const result of results) {
        const url = result.link.toLowerCase();
        const domain = new URL(result.link).hostname.replace("www.", "");

        if (SOCIAL_DOMAINS.some((s) => url.includes(s))) continue;
        if (seen.has(domain)) continue;

        seen.add(domain);
        allUrls.push(result.link);
      }
    }

    if (allUrls.length === 0) {
      return {
        searchRetries: state.searchRetries + 1,
        log: [{ ...log, message: "Nenhum site de empresa encontrado" }],
      };
    }

    log.message = `${allUrls.length} sites de empresas encontrados`;

    return {
      pendingUrls: allUrls,
      log: [log],
    };
  } catch (err) {
    console.error("[search-companies] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na busca: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 4: Scrape company node**

`src/lib/agent/company-discovery/nodes/scrape-company.ts`:

```typescript
import { CompanyDiscoveryStateType } from "../state";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL ?? "http://localhost:3002";

export async function scrapeCompany(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "scrape_company", message: "", timestamp: new Date().toISOString() };

  const url = state.pendingUrls[0];
  if (!url) {
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: "Sem URLs pendentes para scrape" }],
    };
  }

  try {
    log.message = `Extraindo conteúdo de ${new URL(url).hostname}...`;

    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      return {
        pendingUrls: state.pendingUrls.slice(1),
        companiesProcessed: [new URL(url).hostname.replace("www.", "")],
        log: [{ ...log, message: `Falha ao extrair ${url} (${response.status}), pulando` }],
      };
    }

    const data = await response.json();
    const markdown = data?.data?.markdown ?? null;

    if (!markdown) {
      return {
        pendingUrls: state.pendingUrls.slice(1),
        companiesProcessed: [new URL(url).hostname.replace("www.", "")],
        log: [{ ...log, message: `Sem conteúdo extraído de ${url}, pulando` }],
      };
    }

    return {
      currentUrl: url,
      currentMarkdown: markdown,
      log: [log],
    };
  } catch (err) {
    console.error("[scrape-company] Error:", err);
    return {
      pendingUrls: state.pendingUrls.slice(1),
      companiesProcessed: [new URL(url).hostname.replace("www.", "")],
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro no scrape: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 5: Analyze company node**

`src/lib/agent/company-discovery/nodes/analyze-company.ts`:

```typescript
import { z } from "zod";
import { CompanyDiscoveryStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const companyAnalysisSchema = z.object({
  name: z.string(),
  sector: z.string(),
  size: z.string().nullable(),
  description: z.string(),
  products: z.string().nullable(),
  tech_stack: z.string().nullable(),
  hiring_status: z.string().nullable(),
  icp_score: z.number().min(0).max(100),
  icp_justification: z.string(),
  is_company_site: z.boolean(),
});

export async function analyzeCompany(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "analyze_company", message: "", timestamp: new Date().toISOString() };

  if (!state.currentUrl || !state.currentMarkdown) {
    return {
      pendingUrls: state.pendingUrls.slice(1),
      log: [{ ...log, message: "Sem dados para análise" }],
    };
  }

  try {
    const prompt = `Analyze this website content and determine if it's a company website worth prospecting.

SEARCH CRITERIA:
- Target sector: ${state.sector}
- Target region: ${state.region}
- Target sizes: ${state.sizes.join(", ") || "any"}
- Keywords: ${state.keywords.join(", ") || "none"}
- Additional context: ${state.freeText || "none"}
${state.companyProfile ? `- Our ICP: ${state.companyProfile.icp}\n- Our sector: ${state.companyProfile.sector}\n- Our value proposition: ${state.companyProfile.value_proposition}` : ""}

WEBSITE:
URL: ${state.currentUrl}
Content (markdown):
${state.currentMarkdown.slice(0, 8000)}

INSTRUCTIONS:
1. First determine: is_company_site — is this actually a company website (not a news article, directory listing, or blog)?
2. If it IS a company site, extract data and score ICP fit.
3. If it is NOT a company site, set is_company_site=false and icp_score=0.

Extract:
- name: company name
- sector: industry/sector
- size: employee count or range (e.g. "50-200", "500+"), null if unknown
- description: one-sentence description (max 200 chars)
- products: main products/services (comma-separated, max 5), null if unknown
- tech_stack: technologies mentioned (comma-separated), null if unknown
- hiring_status: "hiring" if job postings found, "not_hiring" otherwise, null if unknown
- icp_score: 0-100 how well this company matches our ICP criteria
- icp_justification: 1-2 sentences explaining the score (in Portuguese)
- is_company_site: true if this is a company website

Return JSON.`;

    const analysis = await callClaudeJSON(prompt, companyAnalysisSchema, { timeout: 45_000 });
    const domain = new URL(state.currentUrl).hostname.replace("www.", "");

    if (!analysis.is_company_site) {
      log.message = `${state.currentUrl} não é site de empresa, pulando`;
      return {
        currentUrl: null,
        currentMarkdown: null,
        pendingUrls: state.pendingUrls.slice(1),
        companiesProcessed: [domain],
        log: [log],
      };
    }

    log.message = `${analysis.name} — ICP Score: ${analysis.icp_score}/100 — ${analysis.icp_justification}`;

    // Pass analysis data forward via state for save-company node
    return {
      currentUrl: state.currentUrl,
      currentMarkdown: JSON.stringify(analysis),
      pendingUrls: state.pendingUrls.slice(1),
      companiesProcessed: [domain],
      log: [log],
    };
  } catch (err) {
    console.error("[analyze-company] Error:", err);
    const domain = new URL(state.currentUrl).hostname.replace("www.", "");
    return {
      currentUrl: null,
      currentMarkdown: null,
      pendingUrls: state.pendingUrls.slice(1),
      companiesProcessed: [domain],
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na análise: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 6: Save company node**

`src/lib/agent/company-discovery/nodes/save-company.ts`:

```typescript
import { createClient } from "@supabase/supabase-js";
import { CompanyDiscoveryStateType } from "../state";

export async function saveCompany(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "save_company", message: "", timestamp: new Date().toISOString() };

  if (!state.currentUrl || !state.currentMarkdown) {
    return { log: [{ ...log, message: "Sem empresa para salvar" }] };
  }

  try {
    const analysis = JSON.parse(state.currentMarkdown);

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check duplicate by website domain
    const domain = new URL(state.currentUrl).hostname.replace("www.", "");
    const { data: existing } = await supabase
      .from("prospect_companies")
      .select("id")
      .eq("user_id", state.userId)
      .ilike("website", `%${domain}%`)
      .limit(1)
      .single();

    if (existing) {
      log.message = `${analysis.name} já existe na base, pulando`;
      return {
        currentUrl: null,
        currentMarkdown: null,
        log: [log],
      };
    }

    await supabase.from("prospect_companies").insert({
      user_id: state.userId,
      segment_id: state.segmentId,
      name: analysis.name,
      website: state.currentUrl,
      sector: analysis.sector,
      size: analysis.size,
      region: state.region,
      description: analysis.description,
      tech_stack: analysis.tech_stack,
      products: analysis.products,
      hiring_status: analysis.hiring_status,
      icp_score: analysis.icp_score,
      icp_justification: analysis.icp_justification,
      status: "new",
      source: "serper",
    });

    log.message = `Empresa salva: ${analysis.name} (ICP: ${analysis.icp_score}/100)`;

    return {
      currentUrl: null,
      currentMarkdown: null,
      companiesSaved: state.companiesSaved + 1,
      log: [log],
    };
  } catch (err) {
    console.error("[save-company] Error:", err);
    return {
      currentUrl: null,
      currentMarkdown: null,
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro ao salvar: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 7: Assemble graph**

`src/lib/agent/company-discovery/graph.ts`:

```typescript
import { END, START, StateGraph } from "@langchain/langgraph";
import { CompanyDiscoveryState, CompanyDiscoveryStateType } from "./state";
import { buildCompanyQueries } from "./nodes/build-queries";
import { searchCompanies } from "./nodes/search-companies";
import { scrapeCompany } from "./nodes/scrape-company";
import { analyzeCompany } from "./nodes/analyze-company";
import { saveCompany } from "./nodes/save-company";

const MAX_SEARCH_RETRIES = 5;
const MAX_ERROR_RETRIES = 3;

function afterSearch(state: CompanyDiscoveryStateType): "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.pendingUrls.length === 0 && state.searchRetries >= MAX_SEARCH_RETRIES) return END;
  if (state.pendingUrls.length === 0) return END;
  return "scrape_company";
}

function afterScrape(state: CompanyDiscoveryStateType): "analyze_company" | "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.currentMarkdown) return "analyze_company";
  // Scrape failed — try next URL
  if (state.pendingUrls.length > 0) return "scrape_company";
  return END;
}

function afterAnalyze(state: CompanyDiscoveryStateType): "save_company" | "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  // If currentMarkdown is JSON (analysis passed), save it
  if (state.currentUrl && state.currentMarkdown) return "save_company";
  // Not a company site — try next URL
  if (state.pendingUrls.length > 0) return "scrape_company";
  return END;
}

function afterSave(state: CompanyDiscoveryStateType): "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.companiesSaved >= state.quantity) return END;
  if (state.pendingUrls.length > 0) return "scrape_company";
  return END;
}

export function buildCompanyDiscoveryGraph() {
  const graph = new StateGraph(CompanyDiscoveryState)
    .addNode("build_queries", buildCompanyQueries)
    .addNode("search_companies", searchCompanies)
    .addNode("scrape_company", scrapeCompany)
    .addNode("analyze_company", analyzeCompany)
    .addNode("save_company", saveCompany)
    .addEdge(START, "build_queries")
    .addEdge("build_queries", "search_companies")
    .addConditionalEdges("search_companies", afterSearch)
    .addConditionalEdges("scrape_company", afterScrape)
    .addConditionalEdges("analyze_company", afterAnalyze)
    .addConditionalEdges("save_company", afterSave);

  return graph.compile();
}
```

**Step 8: Commit**

```bash
git add src/lib/agent/company-discovery/
git commit -m "feat: add company discovery LangGraph pipeline"
```

---

### Task 4: API Route — Company Discovery SSE

**Files:**
- Create: `src/app/api/companies/discover/route.ts`

**Step 1: Write the SSE route**

Follow the same pattern as `src/app/api/prospect/route.ts`. The route:
1. Authenticates user
2. Validates input with `companyDiscoveryRequestSchema`
3. Fetches user's `company_profiles` for ICP context
4. Builds and streams the company discovery graph via SSE

```typescript
import { createClient } from "@/lib/supabase/server";
import { companyDiscoveryRequestSchema } from "@/lib/validations/schemas";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed } = checkRateLimit(user.id);
  if (!allowed) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const body = await request.json();
  const parsed = companyDiscoveryRequestSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("name, sector, value_proposition, icp")
    .eq("user_id", user.id)
    .single();

  const abortSignal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      abortSignal.addEventListener("abort", () => { cancelled = true; });

      try {
        const { buildCompanyDiscoveryGraph } = await import("@/lib/agent/company-discovery/graph");
        const graph = buildCompanyDiscoveryGraph();

        const eventStream = await graph.stream(
          {
            userId: user.id,
            segmentId: parsed.data.segment_id ?? null,
            sector: parsed.data.sector,
            region: parsed.data.region,
            sizes: parsed.data.sizes,
            keywords: parsed.data.keywords,
            freeText: parsed.data.freeText,
            quantity: parsed.data.quantity,
            companyProfile: companyProfile ?? null,
          },
          { recursionLimit: 200, streamMode: "updates", signal: abortSignal }
        );

        for await (const event of eventStream) {
          if (cancelled) break;
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      } catch (error) {
        if (!abortSignal.aborted) {
          console.error("[Company Discovery Error]", error);
          try {
            const errorMsg = error instanceof Error ? error.message : "Discovery failed";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`));
          } catch { /* stream closed */ }
        }
      } finally {
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

**Step 2: Commit**

```bash
git add src/app/api/companies/discover/route.ts
git commit -m "feat: add company discovery SSE API route"
```

---

### Task 5: Server Actions — Company Management (CRUD)

**Files:**
- Create: `src/app/(app)/companies/actions.ts`

**Step 1: Write server actions**

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { updateProspectCompanySchema } from "@/lib/validations/schemas";
import { revalidatePath } from "next/cache";

export async function getProspectCompanies(segmentId?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  let query = supabase
    .from("prospect_companies")
    .select("*")
    .eq("user_id", user.id)
    .order("icp_score", { ascending: false });

  if (segmentId) {
    query = query.eq("segment_id", segmentId);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function updateCompanyStatus(id: string, status: "approved" | "rejected") {
  const parsed = updateProspectCompanySchema.safeParse({ id, status });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("prospect_companies")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
  revalidatePath("/companies");
}

export async function bulkUpdateCompanyStatus(
  minScore: number,
  status: "approved" | "rejected"
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const operator = status === "approved" ? "gte" : "lt";
  const { error } = await supabase
    .from("prospect_companies")
    .update({ status })
    .eq("user_id", user.id)
    .eq("status", "new")
    [operator]("icp_score", minScore);

  if (error) throw error;
  revalidatePath("/companies");
}

export async function deleteProspectCompany(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("prospect_companies")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
  revalidatePath("/companies");
}
```

**Step 2: Commit**

```bash
git add src/app/(app)/companies/actions.ts
git commit -m "feat: add company management server actions"
```

---

### Task 6: Companies Page — UI Components

**Files:**
- Create: `src/app/(app)/companies/page.tsx`
- Create: `src/app/(app)/companies/client.tsx`
- Create: `src/components/company-discovery-form.tsx`
- Create: `src/components/company-list.tsx`

**Step 1: Server page**

`src/app/(app)/companies/page.tsx`:

```typescript
import { createClient } from "@/lib/supabase/server";
import { CompaniesClient } from "./client";
import type { Segment } from "@/lib/types/database";
import type { ProspectCompany } from "@/lib/types/database";

export default async function CompaniesPage() {
  const supabase = await createClient();
  const { data: companies } = await supabase
    .from("prospect_companies")
    .select("*")
    .order("icp_score", { ascending: false });

  const { data: segments } = await supabase
    .from("segments")
    .select("*")
    .order("name");

  return (
    <CompaniesClient
      companies={(companies as ProspectCompany[]) ?? []}
      segments={(segments as Segment[]) ?? []}
    />
  );
}
```

**Step 2: Client component**

`src/app/(app)/companies/client.tsx` — manages discovery form, agent feed, and company list. Follow the same pattern as `src/app/(app)/prospect/client.tsx` with:
- Discovery form (left column)
- Agent feed (right column, reuse `AgentFeed` component)
- Company list below (full width) with filter tabs (All/New/Approved/Rejected)
- Approve/reject buttons on each company card

**Step 3: Discovery form component**

`src/components/company-discovery-form.tsx` — form with fields:
- Sector (Input)
- Region (Input)
- Sizes (multi-checkbox: 1-10, 11-50, 51-200, 201-500, 500+)
- Keywords (Input with comma-separated tags)
- Free text (Textarea)
- Quantity (Input number, 1-20)
- Segment selector (optional, Select)
- Submit button

Submits POST to `/api/companies/discover`, returns ReadableStream to parent.

**Step 4: Company list component**

`src/components/company-list.tsx` — displays prospect companies:
- Filter tabs: Todas | Novas | Aprovadas | Rejeitadas
- Each company card shows: name, sector, size, icp_score badge, description
- Expand to show: tech_stack, products, hiring_status, icp_justification, website link
- Action buttons: Aprovar (green) / Rejeitar (red)
- Bulk action: "Aprovar todas com score >= X"

**Step 5: Commit**

```bash
git add src/app/(app)/companies/ src/components/company-discovery-form.tsx src/components/company-list.tsx
git commit -m "feat: add companies discovery page with form and list"
```

---

### Task 7: Sidebar — Add "Empresas" Entry

**Files:**
- Modify: `src/components/sidebar.tsx`

**Step 1: Add Empresas to navigation**

In `src/components/sidebar.tsx`, add `Building2` to lucide imports and insert the entry after "Segmentos":

```typescript
import { Building2 } from "lucide-react";

// In navigation array, after Segmentos:
{ name: "Empresas", href: "/companies", icon: Building2 },
```

Final navigation order:
1. Dashboard
2. Pipeline
3. Contatos
4. Segmentos
5. **Empresas** (new)
6. Prospectar
7. Execuções
8. Configurações

**Step 2: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: add Empresas to sidebar navigation"
```

---

### Task 8: Update `find-lead` — Company-First Logic

**Files:**
- Modify: `src/lib/agent/state.ts`
- Modify: `src/lib/agent/nodes/find-lead.ts`
- Modify: `src/app/api/prospect/route.ts`

**Step 1: Add targetCompanies to agent state**

In `src/lib/agent/state.ts`, add:

```typescript
targetCompanies: Annotation<Array<{
  id: string;
  name: string;
  website: string | null;
}>>({
  reducer: (_a, b) => b,
  default: () => [],
}),
currentCompanyIndex: Annotation<number>({
  reducer: (_a, b) => b,
  default: () => 0,
}),
```

**Step 2: Update find-lead node**

In `src/lib/agent/nodes/find-lead.ts`, modify `findLead` to:
1. Check if `state.targetCompanies.length > 0`
2. If yes: pick company at `currentCompanyIndex`, build targeted dork query `site:linkedin.com/in "${role}" "${companyName}"`, search
3. If no results for this company or all companies exhausted: fallback to existing `buildDorkQueries()` logic
4. Increment `currentCompanyIndex` when moving to next company

**Step 3: Update prospect API route**

In `src/app/api/prospect/route.ts`, after fetching the segment:
1. Query `prospect_companies` where `status = 'approved'` for the segment
2. Pass them as `targetCompanies` in the graph input

```typescript
const { data: approvedCompanies } = await supabase
  .from("prospect_companies")
  .select("id, name, website")
  .eq("user_id", user.id)
  .eq("status", "approved")
  .eq("segment_id", parsed.data.segment_id)
  .order("icp_score", { ascending: false });
```

Add to graph stream input:
```typescript
targetCompanies: (approvedCompanies ?? []).map((c) => ({
  id: c.id,
  name: c.name,
  website: c.website,
})),
```

**Step 4: Commit**

```bash
git add src/lib/agent/state.ts src/lib/agent/nodes/find-lead.ts src/app/api/prospect/route.ts
git commit -m "feat: company-first logic in find-lead with fallback"
```

---

### Task 9: Update Agent Feed — Company Discovery Steps

**Files:**
- Modify: `src/components/agent-feed.tsx`

**Step 1: Add step configs for discovery nodes**

In `src/components/agent-feed.tsx`, add to `stepConfig`:

```typescript
import { Building2, Globe, FileText } from "lucide-react";

// Add to stepConfig:
build_queries: { icon: Search, bg: "bg-blue-100", text: "text-blue-600" },
search_companies: { icon: Globe, bg: "bg-indigo-100", text: "text-indigo-600" },
scrape_company: { icon: FileText, bg: "bg-orange-100", text: "text-orange-600" },
analyze_company: { icon: Target, bg: "bg-cyan-100", text: "text-cyan-600" },
save_company: { icon: Building2, bg: "bg-green-100", text: "text-green-600" },
```

**Step 2: Commit**

```bash
git add src/components/agent-feed.tsx
git commit -m "feat: add company discovery step icons to agent feed"
```

---

### Task 10: Update CLAUDE.md and Memory

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update Architecture tree**

Add `companies/` to the `(app)/` section:
```
│   │   ├── companies/      # Company discovery & management
```

Add `company-discovery/` to the `agent/` section:
```
│   │   ├── company-discovery/ # Company discovery pipeline
│   │   │   ├── nodes/
│   │   │   │   ├── build-queries.ts
│   │   │   │   ├── search-companies.ts
│   │   │   │   ├── scrape-company.ts
│   │   │   │   ├── analyze-company.ts
│   │   │   │   └── save-company.ts
│   │   │   ├── state.ts
│   │   │   └── graph.ts
```

Add `api/companies/discover/` to API section.

Add new components: `company-discovery-form.tsx`, `company-list.tsx`.

**Step 2: Update Migrations list**

Add: `11. 011_add_prospect_companies.sql — Prospect companies table for company-first discovery`

**Step 3: Update Key Files**

Add design doc: `docs/plans/2026-03-19-company-first-prospecting-design.md`
Add implementation plan: `docs/plans/2026-03-19-company-first-prospecting-implementation.md`

**Step 4: Update Agent Pipeline section**

Add note: "Company discovery pipeline: `build_queries` → `search_companies` → `scrape_company` → `analyze_company` → `save_company` → loop."
Add note: "Prospecting pipeline uses approved companies for targeted queries, falls back to open dork queries."

**Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with company-first prospecting"
```
