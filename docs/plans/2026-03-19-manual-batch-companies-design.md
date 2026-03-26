# Manual & Batch Company Addition — Design

## Overview

Add two ways to insert companies into `prospect_companies` beyond the AI discovery pipeline:
- **Manual individual** — modal with form fields
- **Batch via CSV/XLSX** — modal with 3-step wizard (upload → column mapping → confirm)

Both insert with `source: 'manual'`, `status: 'approved'`, and trigger Firecrawl enrichment when `website` is provided.

## Decisions

- **Status on insert:** `approved` (user already curated these)
- **Column mapping:** User maps file columns to system fields via selects
- **Fields:** name (required), website, sector, size, region, description
- **Segment:** Optional selector visible in both modals
- **Parsing:** Client-side (papaparse for CSV, sheetjs for XLSX)
- **Enrichment:** Automatic via Firecrawl if website present, non-blocking
- **Limit:** Max 50 companies per upload

## Components

### New
- `add-company-modal.tsx` — Individual company form (name*, website, sector, size, region, description, segment)
- `import-companies-modal.tsx` — 3-step wizard for CSV/XLSX import

### Modified
- `company-list.tsx` — Add "Adicionar Empresa" and "Importar CSV/XLSX" buttons in header
- `companies/actions.ts` — New Server Actions: `createCompany`, `importCompanies`

## Import Flow (3 Steps)

### Step 1: Upload
- Drag & drop or file picker (.csv, .xlsx)
- Parse in browser (papaparse / sheetjs)
- Show preview of first 5 rows + total count
- Error if > 50 rows

### Step 2: Column Mapping
- For each system field, a `<Select>` with file columns + "Skip" option
- `name` is required — blocks advancing if not mapped
- Live preview updates as mapping changes

### Step 3: Confirm
- Final table with mapped data
- Validation: removes rows without name, shows warning count
- Segment selector (optional)
- "Importar X empresas" button

## Server Actions

```typescript
// Individual
createCompany({
  name: string;
  website?: string;
  sector?: string;
  size?: string;
  region?: string;
  description?: string;
  segment_id?: string;
})
// → insert source='manual', status='approved'
// → if website: trigger enrichment

// Batch
importCompanies({
  companies: Array<{ name: string; website?: string; sector?: string; size?: string; region?: string; description?: string }>;
  segment_id?: string;
})
// → bulk insert source='manual', status='approved'
// → for each with website: trigger enrichment
```

## Enrichment

- Uses existing Firecrawl (`firecrawl-enrich.ts`)
- Runs after insert (non-blocking)
- Only for companies with `website` filled
- Updates: description, tech_stack, products, hiring_status

## Dependencies

- `papaparse` — CSV parsing
- `xlsx` (sheetjs community edition) — XLSX parsing

## Database

No migration needed — `prospect_companies` already supports `source: 'manual'`.

## Validation (Zod)

- `createCompanySchema` — name required, optional fields
- `importCompaniesSchema` — array of company objects, max 50 items, segment_id optional
