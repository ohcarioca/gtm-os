# Design: Company People Search Priority

**Date:** 2026-03-25
**Status:** Approved

## Problem

When prospecting for leads, the `find-lead` node searches broadly via Google dork or LinkedIn global search. Even when we know the company's LinkedIn URL, we don't use the company's people page — which is the most precise source for finding employees by role.

## Solution

When a company has `linkedin_url`, search directly on `/company/{slug}/people/?keywords={role}` as first priority. Falls back to generic LinkedIn search if no results. Skips Google dork entirely.

## Changes

### 1. State — add `linkedinUrl` to `targetCompanies`

```ts
// state.ts
targetCompanies: Annotation<Array<{
  id: string;
  name: string;
  website: string | null;
  linkedinUrl: string | null;  // NEW
}>>
```

### 2. API route — load `linkedin_url` from companies

```ts
// api/prospect/route.ts
.select("id, name, website, linkedin_url")
// map: linkedinUrl: c.linkedin_url
```

### 3. New function `searchCompanyPeople` in `linkedin-playwright.ts`

- Receives: `companyLinkedinUrl`, `keywords` (role), `userId`
- Extracts slug from URL (e.g., `blue365` from `linkedin.com/company/blue365`)
- Navigates to: `https://www.linkedin.com/company/{slug}/people/?keywords={role}`
- Extracts profile URLs (`a[href*="linkedin.com/in/"]`) + innerText
- Parses with Haiku (same pattern as `searchPeople`)
- Counts as 1 search in rate limit (normal search counter)
- Returns `LinkedInSearchResult[]`

### 4. `find-lead.ts` — new search priority

| Company has `linkedin_url`? | Mode | Priority |
|---|---|---|
| Yes | Full | 1. Company people → 2. LinkedIn search generic |
| Yes | LinkedIn Only | 1. Company people → 2. LinkedIn search generic |
| No | Full | 1. Google dork → 2. LinkedIn search generic (unchanged) |
| No | LinkedIn Only | 1. LinkedIn search generic (unchanged) |

### 5. `currentCompany.linkedinUrl` populated

Already exists in the state type. Populate with actual value instead of hardcoded `null`.

## Fallback Strategy

If company people page returns no results for a role:
- Falls back to generic LinkedIn search (`searchPeople`)
- Does NOT fall back to Google dork
- If both return nothing, advances to next company+role combination

## What doesn't change

- Rate limit structure (uses existing search counter)
- Profile scraping/validation flow
- Score and enrich flow
- Google dork path for companies without LinkedIn URL
