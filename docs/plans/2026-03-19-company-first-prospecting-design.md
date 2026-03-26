# Company-First Prospecting — Design

**Date:** 2026-03-19
**Status:** Approved
**Problem:** Leads from Serper are low quality — wrong roles and wrong companies for the ICP.
**Solution:** Discover and validate companies BEFORE searching for decision-makers within them.

## Architecture

```
COMPANY DISCOVERY (new page /companies)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Form (sector, region, size, keywords, free text)
  → Serper (Google search for companies)
  → Firecrawl (scrape company websites)
  → Claude CLI (analyze ICP fit, extract structured data)
  → Save to `prospect_companies` table (status: new)
  → List with approve/reject actions

PROSPECTING (existing /prospect page)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Existing form + approved company selector
  → find_lead searches decision-makers WITHIN selected companies
  → Normal pipeline (validate → score → enrich → create)
```

## Database: `prospect_companies` table

New table (NOT `company_profiles` — that stores the user's own company/ICP).

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK |
| user_id | uuid | FK to auth.users (RLS) |
| segment_id | uuid | FK to segments |
| name | text | Company name |
| website | text | Company website URL |
| sector | text | Industry/sector |
| size | text | Employee count range |
| region | text | Geographic region |
| description | text | Summary extracted by Claude CLI |
| tech_stack | text | Technologies used |
| products | text | Main products/services |
| hiring_status | text | Hiring activity |
| icp_score | integer | 0-100 ICP fit score |
| icp_justification | text | Score explanation |
| status | text | new, approved, rejected |
| source | text | serper, manual |
| created_at | timestamptz | Creation timestamp |

RLS: users can only see/modify their own rows.

## Company Discovery Page (`/companies`)

### Search Form
- **Sector** (text input)
- **Region** (text input)
- **Size** (multi-select: 1-10, 11-50, 51-200, 201-500, 500+)
- **Keywords** (tags input, e.g., "SaaS", "série A", "fintech")
- **Free text** (textarea, e.g., "empresas que usam Kubernetes e estão contratando devs")
- **Quantity** (number of companies to find)

### Discovery Pipeline (new LangGraph graph)
1. `build_company_queries` — Claude CLI generates search queries (no `site:linkedin.com`)
2. `search_companies` — Serper executes queries
3. `scrape_company` — Firecrawl extracts website content
4. `analyze_company` — Claude CLI analyzes ICP fit, generates `icp_score` + structured data
5. `save_company` — Saves to `prospect_companies` with status `new`
6. Loop until quantity reached

### Results List
- Table: name, sector, size, icp_score, status
- Per-company actions: approve / reject
- Bulk actions: approve all above X score
- Filters: All | New | Approved | Rejected
- Sort by icp_score (highest first)
- Click to expand details (tech stack, products, score justification)

## Changes to Prospecting (`/prospect` + `find-lead`)

### Form Changes
- New optional field: **company selector** (multi-select of approved `prospect_companies` for the segment)

### `find-lead` Updated Logic

```
1. Has approved companies not yet processed?
   → YES: pick next company
     → Targeted dork: site:linkedin.com/in "CTO" "CompanyName"
     → LinkedIn search: "CTO CompanyName"
     → Return first valid candidate

   → NO: fallback to current system
     → buildDorkQueries() (open queries as today)
     → LinkedIn searchPeople()
     → Return first valid candidate
```

### Agent State — New Fields
- `targetCompanies`: list of approved companies to prospect
- `currentCompanyIndex`: index of company being processed

## Sidebar
- Add "Empresas" entry between "Segments" and "Prospect"
- Flow: Segments → **Empresas** → Prospect → Contacts → Pipeline

## Streaming & UX
- Same SSE pattern as `/api/prospect`
- Real-time log feed: "Buscando empresas..." → "Analisando site..." → "ICP Score: 82/100"
- Results table appears after completion for review

## Out of Scope
- Auto-prospect on company approval (future)
- Apollo.io integration (future)
- Changes to Contacts/Pipeline/Dashboard pages

## Relationship Between Tables
- `company_profiles` = user's own company (ICP definition)
- `prospect_companies` = target companies found by search
- `leads` = people found within prospect_companies
