# LinkedIn Only Toggle — Design

**Date:** 2026-03-24
**Status:** Approved

## Problem

The prospecting pipeline currently prioritizes Google dork queries (Serper) to find LinkedIn profiles, using LinkedIn direct search (`searchPeople`) only as a fallback. Users want the option to skip Google entirely and search directly on LinkedIn via Playwright.

## Solution

Add a `linkedinOnly` boolean toggle to the prospecting form and agent state. When enabled:
- `find_lead` skips all Google dork logic and uses `searchPeople()` directly
- `triage_company` does a simplified check (only rejected_companies DB lookup, no Google/Firecrawl/Claude CLI)

When disabled, the current behavior is preserved unchanged.

## Design

### 1. AgentState (`src/lib/agent/state.ts`)

Add `linkedinOnly: boolean` (default `false`) to the state definition.

### 2. Prospect Form (`src/components/prospect-form.tsx`)

Add a Switch component with label "Buscar direto no LinkedIn" above the submit button. Present in both "Por Empresas" and "Aberto" tabs. Sends `linkedin_only: true/false` in the request body.

### 3. find-lead.ts

When `state.linkedinOnly === true`:

**Company mode:** Skip `googleSearch()`. Go directly to `searchPeople(keywords, undefined, userId)` where `keywords = "${role} ${companyName}"`. No region filter.

**Open mode:** Skip `googleSearch()` and `buildDorkQueries()`. Go directly to `searchPeople(keywords, region, userId)` where `keywords = "${role} ${searchTerms}"`.

When `false`: Current behavior unchanged.

### 4. triage-company.ts

When `state.linkedinOnly === true` (and not company-first mode):
- Only check `rejected_companies` in DB
- If not rejected → `pass: true`
- No Google search, no Firecrawl, no Claude CLI call

When `false`: Current behavior unchanged.

### 5. API Route (`src/app/api/prospect/route.ts`)

Accept `linkedin_only` in the Zod body schema. Pass as `linkedinOnly` to the initial graph state.

## Files Changed

| File | Change |
|------|--------|
| `src/lib/agent/state.ts` | +1 field `linkedinOnly` |
| `src/lib/agent/nodes/find-lead.ts` | Conditional branch at start |
| `src/lib/agent/nodes/triage-company.ts` | Early return when linkedinOnly |
| `src/components/prospect-form.tsx` | Switch + body field |
| `src/app/api/prospect/route.ts` | Accept + pass field |

No database migrations. No new components.
