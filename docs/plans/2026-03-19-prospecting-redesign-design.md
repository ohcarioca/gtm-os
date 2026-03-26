# Prospecting Redesign — Two Modes Design

## Overview

Redesign the prospecting form to support two modes via tabs:
- **"Por Empresas"** — prospect within approved companies (company-first)
- **"Aberto"** — open dork query prospecting (current behavior)

## Decisions

- **UI pattern:** Tabs inside the ProspectForm card (same pattern as CompanyList)
- **Company selection:** Checkbox list with "Select all" checked by default
- **Mode "Por Empresas":** segment + company checkboxes + quantity (no region — search uses company name)
- **Mode "Aberto":** segment + region + quantity (current behavior unchanged)
- **Randomization:** Shuffle targetCompanies array before passing to graph (Fisher-Yates) to avoid always starting with the same companies
- **Fetch companies:** Server Action to get approved companies by segment

## UI — ProspectForm with Tabs

```
Card "Nova Prospecção"
├── Tabs
│   ├── Tab "Por Empresas"
│   │   ├── Segmento selector (+ Novo Segmento)
│   │   ├── Company list (checkboxes, loaded on segment change)
│   │   │   ├── "Selecionar todas" checkbox (default: checked)
│   │   │   └── Per-company checkbox (name + icp_score badge)
│   │   ├── Quantidade de leads
│   │   └── Botão "Iniciar Prospecção"
│   │
│   └── Tab "Aberto"
│       ├── Segmento selector (+ Novo Segmento)
│       ├── Região
│       ├── Quantidade de leads
│       └── Botão "Iniciar Prospecção"
```

- When segment changes in "Por Empresas" tab, fetch approved companies for that segment
- If no approved companies exist, show message "Nenhuma empresa aprovada neste segmento"
- Company checkboxes show: name, icp_score badge
- Submit button disabled if no companies selected (companies mode) or no region (open mode)

## API Changes

### Request body

**Mode "companies":**
```json
{ "segment_id": "uuid", "quantity": 5, "mode": "companies", "company_ids": ["uuid1", "uuid2"] }
```

**Mode "open":**
```json
{ "segment_id": "uuid", "region": "São Paulo", "quantity": 5, "mode": "open" }
```

### Backend behavior

- `mode: "companies"` → fetch companies by IDs, shuffle order, pass as `targetCompanies`, region empty
- `mode: "open"` → current behavior, `targetCompanies` empty

## Randomization

Fisher-Yates shuffle on `targetCompanies` array in `route.ts` before passing to the LangGraph pipeline. Ensures different company order each run.

## Zod Schema

Update `prospectRequestSchema` to discriminated union:

```typescript
const prospectRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("companies"),
    segment_id: z.string().uuid(),
    quantity: z.number().int().min(1).max(20),
    company_ids: z.array(z.string().uuid()).min(1).max(50),
  }),
  z.object({
    mode: z.literal("open"),
    segment_id: z.string().uuid(),
    region: z.string().min(1).max(100),
    quantity: z.number().int().min(1).max(20),
  }),
]);
```

## Server Action

New action in `companies/actions.ts`:

```typescript
export async function getApprovedCompanies(segmentId: string): Promise<ProspectCompany[]>
```

## Files Changed

- `src/components/prospect-form.tsx` — add tabs, company checkboxes, two submit modes
- `src/lib/validations/schemas.ts` — update prospectRequestSchema to discriminated union
- `src/app/api/prospect/route.ts` — handle two modes, shuffle companies
- `src/app/(app)/companies/actions.ts` — add getApprovedCompanies action

## No Pipeline Changes

The LangGraph pipeline (`find-lead.ts`, `graph.ts`, `state.ts`) already supports `targetCompanies` with company-first logic and fallback to open queries. No changes needed.
