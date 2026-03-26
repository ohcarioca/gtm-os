# LLM Efficiency Optimization — Design

## Problem

All 8 LLM calls in the agent pipelines run on **Opus 4.5** (the most expensive model). Most tasks are simple extraction/classification that don't need Opus-level reasoning. This wastes ~75% of the Max plan budget per run.

## Solution: Model Assignment + Call Consolidation

### Part 1: Model Assignment

| Call | Current | Proposed | Justification |
|------|---------|----------|---------------|
| `buildDorkQueries` (find-lead.ts) | Opus | **Haiku** | Generates search strings, no reasoning needed |
| `searchPeople` parse (linkedin-playwright.ts) | Opus | **Haiku** | Structured extraction from text — pure pattern matching |
| `triageCompany` (triage-company.ts) | Opus | **Sonnet** | Binary classification but needs ICP context interpretation |
| `getProfile` parse (linkedin-playwright.ts) | Opus | **Sonnet** | Long text (4 pages), needs to infer fields like `experienceMatchesICP` |
| `scoreLead` (score-lead.ts) | Opus | **Sonnet** | Multi-dimensional analysis, needs judgment |
| `enrichCompany` (firecrawl-enrich.ts) | Opus | **Haiku** | Structured data extraction from markdown |
| `createLead` msg (create-lead.ts) | Opus | **Sonnet** | Creative text generation (short) |
| `buildQueries` (company-discovery/build-queries.ts) | Opus | **Haiku** | Generates search queries, same logic as buildDorkQueries |
| `analyzeCompany` (company-discovery/analyze-company.ts) | Opus | **Sonnet** | Analysis + ICP scoring, needs judgment |

**Result: 4 Haiku calls, 5 Sonnet calls, 0 Opus calls.**

### Part 2: Consolidation

#### Consolidation 1: `scoreLead` + `createLead` → single LLM call

Today these are 2 sequential calls on the same lead data. The `createLead` prompt receives all the same context that `scoreLead` already analyzed.

**Change:** `score-lead.ts` prompt returns score + personalized message in one JSON response. `create-lead.ts` no longer calls the LLM — it only does the DB insert using `state.message` from the scoring step.

Combined schema:
```json
{
  "total": 78,
  "dimensions": { "company_fit": 25, "role_fit": 22, "seniority": 15, "activity": 16 },
  "justification": "...",
  "message": "Olá João, vi que a TechCorp..."
}
```

**Saving:** -1 Sonnet call per approved lead.

#### Consolidation 2: `analyzeCompany` absorbs enrichment fields (discovery pipeline only)

In company discovery, `analyzeCompany` already receives the full website markdown (up to 8000 chars) and extracts name, sector, size. Later, if the lead passes, `enrichCompany` receives the same markdown and extracts description, products, tech_stack, etc.

**Change:** `analyzeCompany` prompt expanded to also extract enrichment fields (description, products, tech_stack, is_hiring, contact_email, contact_phone). The `save-company.ts` node maps these additional fields to the DB insert.

**Note:** The standalone `enrichCompany` in the prospecting pipeline (`enrich-lead.ts`) remains unchanged — it runs in a different context (validated lead, may not have gone through discovery).

**Saving:** -1 Haiku call per discovered company.

## Impact

| Scenario (10 leads) | Before | After | Reduction |
|----------------------|--------|-------|-----------|
| Open mode | 61 calls (all Opus) | 51 calls (21 Haiku + 30 Sonnet) | ~75% less consumption |
| Company-first | 51 calls (all Opus) | 41 calls (17 Haiku + 24 Sonnet) | ~75% less consumption |
| Discovery (20 companies) | 21 calls (all Opus) | 19 calls (9 Haiku + 10 Sonnet) | ~80% less consumption |

## Files Changed

1. `src/lib/agent/nodes/find-lead.ts` — add `{ model: "haiku" }`
2. `src/lib/agent/nodes/triage-company.ts` — add `{ model: "sonnet" }`
3. `src/lib/agent/nodes/score-lead.ts` — add `{ model: "sonnet" }`, expand prompt to include message generation, update schema
4. `src/lib/agent/state.ts` — add `message` field to state (from score-lead)
5. `src/lib/agent/nodes/create-lead.ts` — remove LLM call, use `state.message` from scoring
6. `src/lib/linkedin-playwright.ts` — `searchPeople` parse: `{ model: "haiku" }`, `getProfile` parse: `{ model: "sonnet" }`
7. `src/lib/firecrawl-enrich.ts` — add `{ model: "haiku" }`
8. `src/lib/agent/company-discovery/nodes/build-queries.ts` — add `{ model: "haiku" }`
9. `src/lib/agent/company-discovery/nodes/analyze-company.ts` — add `{ model: "sonnet" }`, expand prompt/schema with enrichment fields
10. `src/lib/agent/company-discovery/nodes/save-company.ts` — map new enrichment fields from analysis
