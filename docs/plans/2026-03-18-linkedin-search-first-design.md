# LinkedIn Search First — Design

## Status: Approved

## Problem

`find-lead` uses Google dork queries (`site:linkedin.com/in "role" terms "city"`) to find prospects. This produces irrelevant results because:
- Google indexes are stale and incomplete
- Name/company extraction from Google snippets is fragile
- Many candidates pass find-lead but get rejected in validate/score

## Solution

Replace Google dork with LinkedIn MCP `search_people` as the primary source in `find-lead`. Google dork becomes a fallback.

## Flow

```
1. Build keywords (role + searchTerms + sector)
2. Call search_people(keywords, location) via LinkedIn MCP
3. LLM parses raw result → [{name, role, company, linkedinUrl}]
4. Dedup against existing leads + companiesSearched + rejected_leads
5. Return first valid candidate
6. If LinkedIn returns nothing → fallback to Google dork (current behavior)
```

## File Changes

### `src/lib/linkedin-mcp.ts` — New `searchLinkedInPeople` function
- Calls `search_people` tool via MCP client (reuses `getSharedClient()`)
- Same auth error detection logic
- Returns raw text from LinkedIn search results

### `src/lib/agent/nodes/find-lead.ts` — Main rewrite
- New `searchViaLinkedIn()`:
  1. Builds keywords: `targetRoles[0] + searchTerms.join(" ")`
  2. Calls `searchLinkedInPeople(keywords, region)`
  3. Uses Claude Haiku to parse raw text into `[{name, role, company, linkedinUrl}]`
  4. Dedup and return first valid candidate
- Rename current logic to `searchViaGoogle()` (fallback)
- `findLead()` tries LinkedIn first, falls back to Google on any failure

### No changes to:
- `src/lib/agent/state.ts`
- `src/lib/agent/graph.ts`
- `src/lib/agent/nodes/validate-profile.ts` (structure unchanged)
- `src/lib/agent/nodes/score-lead.ts`
- `src/lib/agent/nodes/enrich-lead.ts`
- `src/lib/agent/nodes/create-lead.ts`
- Frontend / SSE streaming

## Keyword Construction

```typescript
// targetRoles=["CEO"], searchTerms=["fintech"], region="São Paulo"
// → keywords: "CEO fintech", location: "São Paulo"

// targetRoles=["Diretor Financeiro", "CFO"], searchTerms=["varejo"], region="São Paulo"
// → query 1: "Diretor Financeiro varejo", location: "São Paulo"
// → query 2 (fallback): "CFO varejo", location: "São Paulo"
```

One query per role, tried in order. Simple: `role + searchTerms.join(" ")`.

## Rate Limiting

- `search_people` costs 1 LinkedIn call per query (Patchright navigates search page)
- Same 10-20s delay already used in validate
- Each lead now costs ~2 LinkedIn calls (1 search + 1 profile) vs 1 before
- Daily limit in `linkedin-daily-limit.ts` must count searches too

## Error Handling

All LinkedIn failures fall back to Google dork. Never blocks:

| Error | Action |
|-------|--------|
| MCP connection error | Fallback to Google dork |
| Auth error (LinkedInAuthError) | Propagate (opens re-login modal) |
| LinkedIn rate limit | Fallback to Google dork |
| Zero LinkedIn results | Fallback to Google dork |
| LLM parse error | Fallback to Google dork |

## LLM for Parsing Search Results

- Model: Claude Haiku (cheap, fast)
- Input: raw text from `search_people` (LinkedIn search page content)
- Output: JSON array `[{name, role, company, linkedinUrl}]`
- Truncate input to 4000 chars (same as profile parsing)
