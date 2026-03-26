# Lead Scoring & Qualification — Design

**Date:** 2026-03-18
**Status:** Approved

## Problem

The current agent pipeline has minimal qualification logic. The only real gates are "has photo" (always true) and "active on LinkedIn" (2 months). BANT scoring is effectively useless — almost all leads get score "A". Company size targets defined in segments are ignored. The ICP from company profile is only used for message personalization, not filtering. Result: leads that don't match the company profile pass through unchecked.

## Goal

Ensure leads are extremely aligned with the company profile by adding a Claude LLM-powered scoring step that evaluates both company fit AND person fit, with a configurable minimum threshold per segment.

## Design Decisions

- **Scoring method:** Claude LLM (Haiku) — more nuanced than fixed rules
- **Pipeline position:** New `score_lead` node after `validate_profile`, before `enrich_lead` — avoids wasting enrichment on bad leads
- **Threshold:** Configurable per segment (`min_score_threshold`, default 70)
- **Data sources:** Google Search + Serper + LinkedIn MCP (no new external APIs)
- **Score format:** 0-100 numeric with 4 dimensions, mapped to letter grades for UI compatibility

## Pipeline Change

### Current
```
find_lead → validate_profile → [isValid?] → enrich_lead → create_lead → loop
```

### New
```
find_lead → validate_profile → [isValid?] → score_lead → [meetsThreshold?] → enrich_lead → create_lead → loop
```

## New Node: `score_lead`

### Input

All data collected up to this point:

**Segment context (what the user wants):**
- `target_roles` — target job titles
- `search_terms` — search terms / sector
- `company_size_targets` — desired company sizes
- `region` — target region

**User's company context (who is prospecting):**
- `companyProfile.name` — company name
- `companyProfile.sector` — sector
- `companyProfile.value_proposition` — value proposition
- `companyProfile.icp` — ICP description

**Collected lead data:**
- `currentDecisionMaker` — name, role, connections, about, recent activity, emails, phone
- `currentCompany` — name, Google snippet
- `currentValidation` — photo, connections, role_match, activity

### Output

```typescript
interface LeadScore {
  total: number;           // 0-100
  dimensions: {
    company_fit: { score: number; max: 30; reason: string };
    role_fit:    { score: number; max: 30; reason: string };
    seniority:  { score: number; max: 20; reason: string };
    activity:   { score: number; max: 20; reason: string };
  };
  justification: string;   // One-line summary in Portuguese
}
```

### Scoring Dimensions

| Dimension | Weight | Evaluates |
|---|---|---|
| `company_fit` | 30pts | Sector, size, company type vs ICP |
| `role_fit` | 30pts | Found role vs segment's target_roles |
| `seniority` | 20pts | Seniority level, connections, about description |
| `activity` | 20pts | How recent and frequent LinkedIn activity is |

### Model

Claude Haiku — scoring is a structured task that doesn't need Sonnet/Opus. Keeps latency low (~500ms).

### Response Format

Claude returns JSON:

```json
{
  "total": 82,
  "dimensions": {
    "company_fit": { "score": 20, "max": 30, "reason": "Empresa de SaaS B2B, alinhada com ICP" },
    "role_fit": { "score": 25, "max": 30, "reason": "CFO — cargo alvo direto" },
    "seniority": { "score": 18, "max": 20, "reason": "450+ connections, perfil senior" },
    "activity": { "score": 19, "max": 20, "reason": "Ativo há 3 dias, publica regularmente" }
  },
  "justification": "Lead altamente alinhado: empresa SaaS B2B no setor correto, CFO é decision maker direto com perfil ativo."
}
```

## New Decision: `meetsThreshold`

```
if score.total >= segment.min_score_threshold → enrich_lead
else → log rejection reason, back to find_lead (increment retries)
```

## Database Changes

### Table `segments` — new column

- `min_score_threshold` — `integer`, default `70`, range 0-100
- Editable in segment create/edit UI

### Table `leads` — score storage

- `score` field remains `text` with letter grade (A/B/C/D) for UI compatibility
- Letter grade derived from numeric score:
  - 90-100 → A
  - 75-89 → B
  - 60-74 → C
  - <60 → D (discarded, never created)
- `metadata` gains `scoring` object: `{ total, dimensions, justification, scored_at }`

## UI Changes

### Segments — `min_score_threshold` field

- Slider or numeric input in create/edit segment forms
- Label: "Score mínimo de qualificação"
- Range: 50-100, default: 70
- Tooltip: "Leads com score abaixo deste valor serão descartados automaticamente"

### Lead card / Lead detail modal

- Display numeric score (e.g., "82/100") alongside letter grade
- Display dimensions as mini bars or badges: `Empresa: 20/30 | Cargo: 25/30 | Senioridade: 18/20 | Atividade: 19/20`
- Display Claude's justification as expandable text

### Agent feed / Run detail

- Log when scoring: "Lead scored: João Silva (82/100) — aprovado"
- Log when discarded: "Lead descartado: Maria Santos (58/100) — company_fit baixo: empresa de varejo, fora do ICP"

## Edge Cases

### No company profile configured

- Scoring works but `company_fit` is evaluated only against segment's `search_terms` and `company_size_targets`
- Log warning: "Scoring sem company profile — configure em Settings para resultados mais precisos"

### No `company_size_targets` in segment

- `company_fit` evaluates only sector/company type, ignores size
- Max score for `company_fit` remains 30 (redistributes weight to sector)

### LinkedIn MCP unavailable (stub validation)

- `activity` receives conservative score (10/20)
- `seniority` receives conservative score (10/20)
- No real data available for these dimensions

### Claude scoring call fails

- Retry 1x on failure (timeout, rate limit)
- If fails again: use default score of 65 (below default threshold of 70)
- Effect: lead is discarded as a precaution
- Log: "Scoring falhou — lead descartado por precaução"

### Discarded leads and retries

- Discarded leads increment retries (same as today's behavior)
- If 5 leads in a row are discarded by low score, agent stops
- Prevents infinite loops when segment config is misaligned with reality
