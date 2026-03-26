# Triage Company Node — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a lightweight company triage node that rejects ICP mismatches before the expensive scoring step, saving ~2 minutes per bad lead.

**Architecture:** New `triage_company` node inserted between `validate_profile` and `score_lead`. Uses Google Search snippets (fast) + Firecrawl scrape (fallback) + short Claude CLI prompt to pass/fail companies against ICP criteria. Skipped in company-first mode.

**Tech Stack:** LangGraph.js, Serper API, Firecrawl, Claude CLI (`callClaudeJSON`)

---

### Task 1: Add `companyTriage` field to agent state

**Files:**
- Modify: `src/lib/agent/state.ts:44` (after `currentValidation`)

**Step 1: Add the new state field**

After line 44 (`currentValidation` annotation), add:

```ts
companyTriage: Annotation<{
  pass: boolean;
  reason: string;
  employeeEstimate: string;
  sector: string;
} | null>({
  reducer: (_a, b) => b,
  default: () => null,
}),
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors related to `companyTriage`

**Step 3: Commit**

```bash
git add src/lib/agent/state.ts
git commit -m "feat: add companyTriage field to agent state"
```

---

### Task 2: Create `triage-company.ts` node

**Files:**
- Create: `src/lib/agent/nodes/triage-company.ts`

**Step 1: Create the triage node**

```ts
import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";
import { googleSearch } from "@/lib/google-search";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL ?? "http://localhost:3002";

const triageSchema = z.object({
  pass: z.boolean(),
  reason: z.string(),
  employeeEstimate: z.string(),
  sector: z.string(),
});

async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 15000,
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    return data?.data?.markdown ?? null;
  } catch {
    return null;
  }
}

async function findCompanyWebsite(companyName: string): Promise<string | null> {
  const results = await googleSearch(`"${companyName}" site oficial`);

  for (const r of results) {
    const link = r.link.toLowerCase();
    if (
      !link.includes("linkedin.com") &&
      !link.includes("facebook.com") &&
      !link.includes("instagram.com") &&
      !link.includes("twitter.com") &&
      !link.includes("glassdoor.com")
    ) {
      return r.link;
    }
  }

  return null;
}

export async function triageCompany(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "triage_company", message: "", timestamp: new Date().toISOString() };
  const companyName = state.currentDecisionMaker?.company || state.currentCompany?.name;

  // Skip triage in company-first mode (companies pre-approved by user)
  if (state.targetCompanies.length > 0) {
    return {
      companyTriage: { pass: true, reason: "Empresa pré-aprovada (modo company-first)", employeeEstimate: "", sector: "" },
      log: [{ ...log, message: `Triagem pulada: ${companyName ?? "empresa"} pré-aprovada` }],
    };
  }

  // Skip if no company name available
  if (!companyName) {
    return {
      companyTriage: { pass: true, reason: "Sem nome de empresa para triar", employeeEstimate: "", sector: "" },
      log: [{ ...log, message: "Triagem pulada: sem nome de empresa" }],
    };
  }

  try {
    log.message = `Triagem empresa: buscando dados de ${companyName}...`;

    // Step 1: Google Search for company info (fast)
    const searchResults = await googleSearch(`"${companyName}" empresa funcionários porte`);
    const snippets = searchResults
      .slice(0, 5)
      .map((r) => `${r.title}: ${r.snippet}`)
      .join("\n");

    // Step 2: If snippets are thin, try Firecrawl
    let firecrawlContent = "";
    if (snippets.length < 100) {
      const website = state.currentCompany?.website || await findCompanyWebsite(companyName);
      if (website) {
        const markdown = await scrapeWithFirecrawl(website);
        if (markdown) {
          firecrawlContent = markdown.slice(0, 3000);
        }
      }
    }

    // Step 3: Claude CLI quick triage
    const icp = state.companyProfile?.icp ?? `Médias empresas com ${state.companySizeTargets.join(", ")} funcionários. Setores: ${state.searchTerms.join(", ")}. Região: ${state.region}`;

    const prompt = `Você é um filtro rápido de ICP. Analise se esta empresa bate com o perfil de cliente ideal.

ICP:
${icp}

Empresa: ${companyName}

Dados do Google:
${snippets || "Nenhum resultado encontrado"}

${firecrawlContent ? `Dados do site:\n${firecrawlContent}` : ""}

Regras de REPROVAÇÃO automática:
- Startup com menos de 50 funcionários
- Multinacional/empresa gigante com mais de 1000 funcionários
- Setor completamente fora do ICP
- Empresa de tecnologia/software que claramente tem time tech robusto interno

Regras de APROVAÇÃO:
- Empresa média (100-500 funcionários) nos setores do ICP
- Porte incerto mas setor correto → APROVAR (dar benefício da dúvida)
- Dados insuficientes para decidir → APROVAR (deixar o scoring decidir)

Responda JSON: {"pass": boolean, "reason": "motivo em português (1 frase)", "employeeEstimate": "estimativa de funcionários ou 'desconhecido'", "sector": "setor da empresa ou 'desconhecido'"}`;

    const triage = await callClaudeJSON(prompt, triageSchema, { timeout: 30_000 });

    log.message = triage.pass
      ? `Triagem empresa: ${companyName} — APROVADA (setor: ${triage.sector}, ~${triage.employeeEstimate} funcionários)`
      : `Triagem empresa: ${companyName} — REPROVADA (${triage.reason}). Pulando lead.`;

    return {
      companyTriage: triage,
      log: [log],
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }

    console.error("[triage-company] Error:", err);
    // On error, let it pass through to scoring (don't block the pipeline)
    return {
      companyTriage: { pass: true, reason: "Erro na triagem, passando para scoring", employeeEstimate: "", sector: "" },
      log: [{ ...log, message: `Triagem empresa: erro, passando para scoring` }],
    };
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/triage-company.ts
git commit -m "feat: create triage-company node for ICP pre-filtering"
```

---

### Task 3: Wire triage node into the graph

**Files:**
- Modify: `src/lib/agent/graph.ts`

**Step 1: Add import**

Add after line 5 (`import { scoreLead }`):

```ts
import { triageCompany } from "./nodes/triage-company";
```

**Step 2: Add the conditional edge function**

Add after the `isValid` function (after line 23):

```ts
function companyPassesTriage(state: AgentStateType): "score_lead" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const triage = state.companyTriage;
  if (!triage || triage.pass) return "score_lead";
  return shouldRetryOrStop(state);
}
```

**Step 3: Update graph assembly**

Change the `isValid` conditional edge destination from `score_lead` to `triage_company`, and add the new node + edge. Replace the graph assembly (lines 37-52) with:

```ts
export function buildProspectingGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("find_lead", findLead)
    .addNode("validate_profile", validateProfile)
    .addNode("triage_company", triageCompany)
    .addNode("score_lead", scoreLead)
    .addNode("enrich_lead", enrichLeadNode)
    .addNode("create_lead", createLead)
    .addEdge(START, "find_lead")
    .addEdge("find_lead", "validate_profile")
    .addConditionalEdges("validate_profile", isValid)
    .addConditionalEdges("triage_company", companyPassesTriage)
    .addConditionalEdges("score_lead", meetsThreshold)
    .addEdge("enrich_lead", "create_lead")
    .addConditionalEdges("create_lead", shouldContinue);

  return graph.compile();
}
```

**Step 4: Update `isValid` to route to `triage_company` instead of `score_lead`**

Change the `isValid` function (line 18-23) to:

```ts
function isValid(state: AgentStateType): "triage_company" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const v = state.currentValidation;
  if (v && v.photo && v.activity) return "triage_company";
  return shouldRetryOrStop(state);
}
```

**Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/lib/agent/graph.ts
git commit -m "feat: wire triage_company node into prospecting graph"
```

---

### Task 4: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the pipeline description**

In the "Agent Pipeline" section, update the prospecting pipeline flow to include triage:

```
- Prospecting pipeline: `find_lead` → `validate_profile` → `triage_company` → `score_lead` → `enrich_lead` → `create_lead` → loop.
```

Add a new bullet:

```
- `triage_company` does a lightweight ICP check (Google snippets + Firecrawl fallback + short Claude CLI call) to reject obvious company mismatches before the expensive scoring step. Skipped in company-first mode.
```

Update the Architecture tree to include the new file:

```
│   │   │   ├── triage-company.ts
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with triage_company node"
```

---

### Task 5: Manual integration test

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Run a prospecting session in open mode**

Use the prospect form with an ICP that targets medium companies (100-500 employees). Watch the agent feed for triage log messages:

- `"Triagem empresa: buscando dados de X..."`
- `"Triagem empresa: X — APROVADA ..."` or `"... REPROVADA ..."`

**Step 3: Verify behavior**

- Companies that clearly don't match ICP (startups, multinationals) should be REPROVADA and skipped before scoring
- Companies that match or are uncertain should be APROVADA and proceed to scoring
- Company-first mode should skip triage entirely
- Errors in triage should not block the pipeline

**Step 4: Commit any fixes if needed**
