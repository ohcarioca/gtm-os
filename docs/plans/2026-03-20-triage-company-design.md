# Triage Company Node — Design

## Problem

The prospecting pipeline in open mode (no target companies) wastes ~3 minutes per bad lead. It finds a person via Google dork, validates their LinkedIn profile, then scores them with Claude CLI — only to discover the company doesn't match the ICP (too small, too large, wrong sector). The scoring step correctly rejects these leads, but by then the expensive work is already done.

Example from production run:
- Startup founder (2 employees) → Score 62, rejected
- Executive at multinational (BNP Paribas) → Score 52, rejected
- CTO who IS the tech team → Score 35, rejected

Each rejection costs ~3 minutes (Serper + LinkedIn scrape + Claude scoring). 5 bad leads = 15 minutes wasted for zero results.

## Solution

Add a lightweight `triage_company` node between `validate_profile` and `score_lead` that checks if the company matches ICP basics (size, sector) before the expensive scoring step.

## Pipeline Flow

```
find_lead → validate_profile → triage_company → score_lead → enrich_lead → create_lead
```

## Node Logic

```
triage_company(state):
  1. SKIP if company-first mode (targetCompanies.length > 0)
     → Company already pre-approved by user, go straight to score_lead

  2. SKIP if no company name available
     → No data to check, let score_lead handle it

  3. Google Search (fast, ~1s):
     Query: "{companyName} empresa funcionários porte"
     Extract signals from snippets (employee count, sector keywords)

  4. If inconclusive → Firecrawl (slower, ~5-10s):
     Find company website via Google → scrape homepage → extract size/sector

  5. Claude CLI (short prompt, ~3-5s):
     Input: Google snippets + Firecrawl markdown (if available) + ICP criteria
     Output: { pass: boolean, reason: string, employee_estimate: string, sector: string }

  6. If fail → log reason, return to find_lead
     If pass → continue to score_lead with enriched company data
```

## Graph Changes (graph.ts)

Current:
```
validate_profile → [isValid?] → score_lead
```

New:
```
validate_profile → [isValid?] → triage_company → [companyPassesTriage?] → score_lead
```

New conditional edge `companyPassesTriage`:
- `pass === true` or triage skipped → `score_lead`
- `pass === false` → `shouldRetryOrStop` (same logic as other retry points)

## State Changes (state.ts)

New field:
```ts
companyTriage: Annotation<{
  pass: boolean;
  reason: string;
  employee_estimate: string;
  sector: string;
} | null>({
  reducer: (_a, b) => b,
  default: () => null,
})
```

## New File

`src/lib/agent/nodes/triage-company.ts` — ~80 lines

## Log Messages

- `"Triagem empresa: buscando dados de {companyName}..."`
- `"Triagem empresa: {companyName} — APROVADA (setor: fintech, ~200 funcionários)"`
- `"Triagem empresa: {companyName} — REPROVADA ({reason}). Pulando lead."`

## What Doesn't Change

- `score_lead` — company_fit remains a scoring dimension (triage is coarse filter, score is fine-grained)
- `validate_profile` — still checks person-level signals only
- `find_lead` — search logic unchanged
- Company-first mode — triage is skipped (companies pre-approved by user)

## Expected Impact

- Eliminates ~70% of wasted time on bad leads in open mode
- Adds ~3-5s per lead for triage (vs ~60-90s saved by skipping full scoring on bad leads)
- Net time savings: ~2 minutes per rejected lead
