# Prospect Form Simplification Design

## Problem

The current prospect form has two tabs (Por Empresas / Aberto) with duplicated fields, a confusing "LinkedIn Only" toggle that references technical details (Playwright), and inline ICP type management that belongs in Settings. The two modes create unnecessary cognitive load.

## Design

### Single Form, Two Dimensions

Replace tabs with two radio-group selectors:

**1. Método de busca** (radio group, horizontal)
- **Busca completa** (default): Google Search (Serper) → LinkedIn (Playwright) → Firecrawl
- **LinkedIn direto**: LinkedIn (Playwright) → Firecrawl (skips Google dork queries)

**2. Escopo** (radio group, horizontal)
- **Empresas aprovadas**: Shows company list with checkboxes + sector filter + select all
- **Tipo ICP**: Shows ICP company type chips (toggle on/off) + region field

**3. Fixed fields** (always visible)
- Cargos-alvo (required, comma-separated)
- Score mínimo (number, default 70)
- Quantidade de leads (number, default 5)
- Button: "Iniciar Prospecção"

### Conditional sections

- When scope = "Empresas aprovadas": show sector filter dropdown + company checkbox list (same as current)
- When scope = "Tipo ICP": show ICP type chips (read-only, toggle on/off) + region input (required)

### What's removed
- Tabs (Por Empresas / Aberto)
- "LinkedIn Only" toggle with Playwright description
- Inline "add ICP type" input (stays in Settings only)
- Duplicated fields across tabs

### What stays
- Company list with checkboxes, sector filter, select all
- ICP type chips (toggle on/off, no inline add)
- Cargos-alvo, score mínimo, quantidade

## API Changes

### POST `/api/prospect` payload

```ts
// Before
{
  mode: "companies" | "open",
  linkedin_only: boolean,
  // ...fields
}

// After
{
  method: "full" | "linkedin_direct",
  scope: "companies" | "icp",
  company_ids?: string[],        // only when scope=companies
  region?: string,               // only when scope=icp
  company_types?: string[],      // only when scope=icp
  target_roles: string[],
  quantity: number,
  min_score_threshold: number,
}
```

### Zod schema update

Update `prospectRequestSchema` in `src/lib/validations/schemas.ts` to match new payload shape.

### Pipeline mapping

No structural changes to the LangGraph graph. The API route maps:
- `method: "linkedin_direct"` → `linkedinOnly: true` in agent state
- `scope: "companies"` → populates `targetCompanies` from selected IDs
- `scope: "icp"` → `targetCompanies` empty, passes `region` and `companyTypes`

## Files to change

1. `src/components/prospect-form.tsx` — rewrite form layout
2. `src/lib/validations/schemas.ts` — update Zod schema
3. `src/app/api/prospect/route.ts` — adapt to new payload shape
