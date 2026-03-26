# LinkedIn Lead Creation — Design

## Summary

Add a "Adicionar via LinkedIn" feature to the Contacts page. Users paste one or more LinkedIn profile URLs, the system scrapes profiles in parallel, scores them automatically, and presents a preview table for review before saving.

## Decisions

| Decision | Choice |
|----------|--------|
| Location | Contacts page, new button |
| Flow | Scrape → preview table → save |
| Scoring | Automatic (Claude score-and-enrich) |
| Multiple links | Dynamic input with "+" button |
| Preview | Editable table, parallel scrape |
| Company matching | Auto-link if exists, create new if not |
| Architecture | API Route with SSE |

## User Flow

1. User clicks "Adicionar via LinkedIn" on Contacts page
2. Modal opens with LinkedIn URL input + "+" button to add more
3. User pastes 1+ LinkedIn URLs
4. Clicks "Buscar" → triggers SSE request to `/api/leads/from-linkedin`
5. Backend processes in parallel:
   - Scrape each LinkedIn profile via Playwright (`getProfile`)
   - Score each via Claude (`score-and-enrich` logic)
   - Stream results back as each completes
6. Frontend shows editable table with extracted data (loading state per row)
7. User reviews, edits fields, removes unwanted leads
8. Clicks "Salvar" → server action creates leads + companies in DB

## Architecture

### New Components

- **`linkedin-leads-modal.tsx`** — Modal with:
  - Dynamic URL inputs (add/remove)
  - URL validation (must be linkedin.com/in/ pattern)
  - Preview table with columns: Name, Role, Company, Score, Email, Phone, Status
  - Edit inline capability per row
  - Remove row capability
  - Save all button

### New API Route

- **`/api/leads/from-linkedin/route.ts`** — SSE endpoint
  - Accepts: `{ urls: string[], userId: string }`
  - For each URL (parallel, limited concurrency of 3):
    1. Check if lead already exists (by linkedin_url in leads + rejected_leads)
    2. Scrape profile via `getProfile(url, userId, targetRoles)`
    3. Score via Claude CLI (reuse score-and-enrich prompt logic)
    4. Stream result back: `{ url, status, data: { name, role, company, score, ... } }`
  - Error per URL: `{ url, status: "error", error: "auth_wall" | "rate_limit" | "not_found" | "unknown" }`

### Updated Server Action

- **`contacts/actions.ts`** — New `createLeadsFromLinkedIn` action
  - Accepts array of lead data (pre-validated from preview)
  - For each lead:
    1. Find or create company (by name match in `companies` table)
    2. Auto-link to `prospect_companies` if exists
    3. Insert lead with all scraped + scored data
  - Returns created lead IDs

## Data Flow

```
User pastes URLs
    → POST /api/leads/from-linkedin (SSE)
    → For each URL (parallel, max 3 concurrent):
        → Check dedup (leads + rejected_leads tables)
        → getProfile() (Playwright scrape)
        → Score with Claude CLI (Sonnet)
        → Stream result to frontend
    → Frontend builds preview table
    → User reviews & edits
    → createLeadsFromLinkedIn server action
    → Find/create companies
    → Insert leads
    → Refresh contacts table
```

## Error Handling

| Error | Behavior |
|-------|----------|
| LinkedIn auth wall | Show error on affected row, suggest re-login in Settings |
| Rate limit exceeded | Show remaining scrapes count, disable further processing |
| Profile not found / private | Mark row as error with message |
| Duplicate lead (already exists) | Mark row as "já existe", allow skipping |
| Claude CLI failure | Retry once, then save without score |
| Network error | Mark row as error, allow retry |

## Validation

- URL format: must match `linkedin.com/in/` pattern
- Minimum 1 URL, maximum 10 URLs per batch
- Zod schema for API request validation
- Zod schema for save action validation

## Rate Limiting

- Respects existing LinkedIn rate limits (100 scrapes/day from `linkedin_usage` table)
- Checks available quota before processing
- If quota insufficient for all URLs, processes what it can and reports the rest

## Security

- All DB operations through RLS (user_id)
- API route validates auth session
- URLs sanitized before use
- Rate limiting enforced server-side
