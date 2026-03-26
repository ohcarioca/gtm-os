# Search Separation & Optimization Design

**Date:** 2026-03-25
**Status:** Approved

## Goal

Fully separate company search and lead search into independent pipelines, optimize token usage, and introduce a conversational chat dashboard as the primary entry point.

## Decisions

1. **UI:** Chat dashboard (state machine) as home page, dedicated pages (Empresas, Leads, Pipeline) unchanged
2. **Lead search:** Always based on approved companies — no open/ICP mode in lead pipeline
3. **No companies fallback:** Auto-suggest company search when user tries lead search with 0 approved companies
4. **Company search:** Two-stage triage — Haiku filters snippets before Firecrawl+Sonnet
5. **Lead find method:** Depends on user choice — Full (Google dork + LinkedIn) vs LinkedIn Direct (LinkedIn only)
6. **Score+Enrich:** Merged into single Sonnet call, reusing company_markdown from discovery
7. **Dork generation:** Template-based (no LLM) since company name is known

## 1. Chat Dashboard UI

### Layout

Sidebar (existing) + central area with greeting, text input, and dynamic quick actions. Style inspired by Claude.ai home screen.

### State Machine

```
idle → choosing_action → configuring → confirming → running → results
```

**`idle`:** Shows "Olá, {name}" + input + initial quick actions:
- "Busca por empresa" → `configuring_companies`
- "Buscar Leads" → checks approved companies → `choosing_action` or suggests company search
- ICP-based shortcuts (dynamic from company_profiles.icp_company_types): e.g. "Empresas de cobrança digital", "Fintechs de cobrança" → pre-fill company discovery params

**`choosing_action` (after "Buscar Leads"):** Shows method sub-actions:
- "Busca Completa" (method=full)
- "LinkedIn Direto" (method=linkedin_direct)

**`configuring`:** Editable parameter card:
- Company search: sector, region, sizes, keywords, quantity
- Lead search: target_roles, quantity, min_score, selected companies

User can type text → Haiku parses and updates fields.

**`confirming`:** Summary card with "Iniciar" / "Ajustar" buttons.

**`running`:** SSE stream displays progress as chat messages. Lead/company cards appear inline.

**`results`:** Summary + contextual quick actions ("Ver leads", "Buscar mais", "Nova busca").

### Dynamic Quick Actions

Quick actions change based on context:
- Initial: high-level choices (companies vs leads)
- After choosing leads: method choices + ICP type filters
- After run: result actions
- ICP shortcuts derived from `company_profiles.icp_company_types`

### Text Input

When user types free text instead of clicking quick actions:
- POST `/api/chat/parse` → Haiku extracts parameters
- Returns structured params → populates configuring card
- Missing required fields → chat asks specific questions (deterministic, not LLM)

## 2. Company Discovery Pipeline (Optimized)

### Flow

```
build_queries → search_companies → triage_snippets → scrape_company → analyze_company → save_company → loop
```

### Changes from Current

| Step | Before | After |
|------|--------|-------|
| `build_queries` | Haiku generates 8-10 queries | No change |
| `search_companies` | Serper searches URLs | No change |
| **`triage_snippets`** | Did not exist | **NEW:** Haiku analyzes title+snippet from Serper. Rejects obvious non-companies (blogs, news, generic lists). Passes only real company URLs |
| `scrape_company` | Firecrawl on all URLs | Firecrawl only on triage-approved URLs |
| `analyze_company` | Sonnet analyzes markdown | No change — but **saves markdown** on company for reuse in lead scoring |
| `save_company` | Inserts to prospect_companies | Adds `company_markdown` field for reuse |

### New Field

```sql
ALTER TABLE prospect_companies ADD COLUMN company_markdown text;
```

### Token Savings

~50-60% fewer Firecrawl + Sonnet calls (irrelevant URLs filtered by Haiku on snippets alone).

## 3. Lead Pipeline (Optimized)

### Flow

```
find_lead → validate_profile → score_and_enrich → create_lead → loop
```

### Changes from Current

| Step | Before | After |
|------|--------|-------|
| `triage_company` | Validated ICP inline | **REMOVED** — companies already approved |
| `find_lead` | 3 priorities (company, open dork, linkedin) | **Simplified:** company-first only, method decides source |
| `validate_profile` | Playwright scrapes LinkedIn | No change |
| `score_lead` + `enrich_lead` | 2 separate steps (Firecrawl + Sonnet) | **MERGED:** Single Sonnet call with LinkedIn data + saved `company_markdown`. Returns score + enrichment + message |
| `create_lead` | Inserts to DB | No change |

### find_lead Simplified

```
method = full:
  1. Google dork template: site:linkedin.com/in "[role]" "[company]"
  2. Fallback: LinkedIn search via Playwright

method = linkedin_direct:
  1. LinkedIn search via Playwright directly
```

No LLM-generated dork queries — company name is known, dork is a fixed template.

### score_and_enrich Merged

Single Sonnet call receives:
- LinkedIn profile data (from validate_profile)
- `company_markdown` (saved during company discovery)
- ICP profile

Returns single JSON:
```json
{
  "score": { "company_fit": 25, "role_fit": 28, "seniority": 15, "activity": 18, "total": 86 },
  "enrichment": { "description": "...", "sector": "...", "employee_count": 150, "products": [], "tech_stack": [] },
  "message": "Olá [nome], vi que..."
}
```

### No Approved Companies Flow

1. Chat detects 0 approved companies
2. Shows: "Você não tem empresas aprovadas ainda. Quer que eu busque empresas primeiro?"
3. Quick actions: "Buscar empresas" / "Importar empresas"
4. After approving companies → returns to lead flow

## 4. Tool Usage Map

### Company Pipeline

| Step | Tool | Model | Cost |
|------|------|-------|------|
| `build_queries` | Claude CLI | Haiku | Low |
| `search_companies` | Serper | — | Low |
| `triage_snippets` | Claude CLI | Haiku | Very low (snippets only) |
| `scrape_company` | Firecrawl | — | Medium (approved only) |
| `analyze_company` | Claude CLI | Sonnet | Medium (approved only) |
| `save_company` | Supabase | — | Negligible |

### Lead Pipeline

| Step | Tool | Model | Cost |
|------|------|-------|------|
| `find_lead` (full) | Serper + Playwright | — | Low (template dork, no LLM) |
| `find_lead` (linkedin) | Playwright | — | Low |
| `validate_profile` | Playwright | — | Low |
| `score_and_enrich` | Claude CLI | Sonnet | Medium (1 call vs 2 before) |
| `create_lead` | Supabase | — | Negligible |

### Savings vs Current Architecture

| Resource | Before | After | Savings |
|----------|--------|-------|---------|
| Firecrawl (companies) | 1 per URL found | 1 per triage-approved URL | ~50-60% |
| Firecrawl (leads) | 1 per lead | 0 (reuses markdown) | 100% |
| Sonnet (leads) | 2 per lead (score + triage) | 1 per lead (score_and_enrich) | 50% |
| Haiku (leads) | 1 per iteration (dork gen) | 0 (template dork) | 100% |
| Haiku (companies) | 1 (build_queries) | 2 (build_queries + triage_snippets) | +1 cheap call |

## 5. Database Changes

```sql
-- Add company_markdown to prospect_companies for reuse in lead scoring
ALTER TABLE prospect_companies ADD COLUMN company_markdown text;
```

## 6. New API Endpoint

### POST /api/chat/parse

Parses free text input into structured search parameters.

**Input:**
```json
{ "text": "quero encontrar diretores de cobrança em fintechs de SP", "context": "leads" | "companies" }
```

**Output:**
```json
{
  "action": "search_leads" | "search_companies",
  "params": { "target_roles": ["Diretor de Cobrança"], "region": "São Paulo", ... },
  "missing": ["quantity"]
}
```

Uses Claude CLI Haiku for extraction.

## 7. Files to Create/Modify

### New Files
- `src/components/chat-dashboard.tsx` — Chat UI with state machine
- `src/lib/agent/company-discovery/nodes/triage-snippets.ts` — Haiku snippet triage
- `src/lib/agent/nodes/score-and-enrich.ts` — Merged score+enrich node
- `src/app/api/chat/parse/route.ts` — Text parsing endpoint

### Modified Files
- `src/app/(app)/dashboard/page.tsx` — Replace current dashboard with chat
- `src/lib/agent/graph.ts` — Remove triage_company, replace score+enrich with merged node
- `src/lib/agent/company-discovery/graph.ts` — Add triage_snippets node
- `src/lib/agent/nodes/find-lead.ts` — Simplify to company-first only, template dorks
- `src/app/api/prospect/route.ts` — Remove ICP/open scope, simplify to companies-only
- `src/app/api/companies/discover/route.ts` — Pass markdown through pipeline

### Removed Files
- `src/lib/agent/nodes/triage-company.ts` — No longer needed
- `src/lib/agent/nodes/enrich-lead.ts` — Merged into score-and-enrich
- `src/lib/agent/nodes/score-lead.ts` — Merged into score-and-enrich
