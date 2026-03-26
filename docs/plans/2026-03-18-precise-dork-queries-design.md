# Precise Dork Queries Design

## Problem

Current `buildQueries()` in `find-lead.ts` generates Google dork queries that return irrelevant LinkedIn profiles:

1. **Region as a single long string** — `"Campinas, Sorocaba, Ribeirão Preto..."` is noise to Google
2. **Roles not bound to industry** — `"CEO" telecom` matches anyone mentioning "telecom" anywhere
3. **No company-type filtering** — returns developers, strategists, unrelated roles
4. **Broadest strategy (OR'd roles)** generates the most irrelevant results

## Solution

Rewrite `buildQueries()` with a single high-precision strategy expanded per city.

### Query Formula

**Primary (terms-based):**
```
site:linkedin.com/in "{role}" {term1} {term2} {termN} "{city}"
```

**Fallback (sector-based):**
```
site:linkedin.com/in "{role}" {sector} "{city}"
```

### Region Parsing

Split the region string by `,` and ` e ` to extract individual cities, then trim whitespace.

Example: `"Campinas, Sorocaba, Ribeirão Preto, São José dos Campos e São José do Rio Preto"`
Becomes: `["Campinas", "Sorocaba", "Ribeirão Preto", "São José dos Campos", "São José do Rio Preto"]`

### Query Generation Order

1. For each role, for each city: role + all search terms + city (most precise)
2. For each role, for each city: role + sector + city (broader fallback)

### Example Output (ISP/Telecom segment)

```
site:linkedin.com/in "CEO" provedor fibra telecom internet "Campinas"
site:linkedin.com/in "CEO" provedor fibra telecom internet "Sorocaba"
site:linkedin.com/in "CEO" provedor fibra telecom internet "Ribeirão Preto"
site:linkedin.com/in "CEO" provedor fibra telecom internet "São José dos Campos"
site:linkedin.com/in "CEO" provedor fibra telecom internet "São José do Rio Preto"
site:linkedin.com/in "Diretor Comercial" provedor fibra telecom internet "Campinas"
... (continues for all roles × cities)
site:linkedin.com/in "CEO" telecomunicações "Campinas"
... (sector fallbacks)
```

### Volume

- Primary: roles × cities queries (e.g., 3 × 5 = 15)
- Fallback: roles × cities queries (e.g., 3 × 5 = 15)
- Total maximum: 30 queries before exhausting retries

### Removed

- Strategy 3 (broadest — all roles OR'd without search terms) — removed entirely

### Files Changed

- `src/lib/agent/nodes/find-lead.ts` — rewrite `buildQueries()`
