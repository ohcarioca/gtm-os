# Backend Rewrite — Surgical Approach

**Date:** 2026-03-18
**Status:** Approved
**Approach:** Rewrite Cirúrgico — replace broken modules, keep LangGraph + UI

## Problem Statement

The current backend has three critical issues:
1. **Google Dork queries are poorly constructed** — generic queries return irrelevant results
2. **LinkedIn MCP is unstable** — auto-login fragile, server restarts unreliable, rate limits in-memory
3. **Lead quality is low** — consequence of bad search + unreliable validation

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Next.js (UI)                      │
│  prospect-form → POST /api/prospect → SSE stream    │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              LangGraph Pipeline                      │
│                                                      │
│  find_lead → validate_profile → score_lead           │
│      → enrich_lead → create_lead → (loop)            │
│                                                      │
│  Each node calls external services via modules:      │
└──┬──────────┬──────────────┬───────────────┬────────┘
   │          │              │               │
   ▼          ▼              ▼               ▼
┌──────┐ ┌────────┐  ┌────────────┐  ┌────────────┐
│Serper│ │Playwr. │  │Firecrawl   │  │Claude CLI  │
│Search│ │LinkedIn│  │self-hosted │  │subprocess  │
│ API  │ │Browser │  │(Docker)    │  │(raciocínio)│
└──────┘ │persist.│  └────────────┘  └────────────┘
         └────────┘
              │
         ┌────▼────┐
         │Supabase │
         │Postgres │
         └─────────┘
```

## What Changes

| Component | Current | New |
|---|---|---|
| Orchestration | LangGraph | LangGraph (keep) |
| LLM | Claude API (Haiku/Sonnet) | Claude Code CLI subprocess |
| LinkedIn Search | MCP `search_people` | Playwright direct on LinkedIn |
| LinkedIn Profile | MCP `get_person_profile` | Playwright direct scrape |
| LinkedIn Session | MCP auto-login (fragile) | Persistent browser (`userDataDir`) |
| Web Search/Dorks | Serper with bad dorks | Serper with dorks built via Claude CLI |
| Enrichment | Serper (3 calls per lead) | Firecrawl self-hosted (scrape company site) |
| Database | Supabase | Supabase (keep) |
| Frontend | Next.js + SSE | Untouched |

## What Stays

- LangGraph pipeline structure (graph.ts, state.ts)
- SSE streaming API contract (`/api/prospect`)
- Supabase schema + RLS
- All frontend pages and components
- Agent state shape and log format

## Module Details

### 1. `claude-cli.ts` — Claude Code CLI Wrapper

Replaces all Claude API calls (Haiku/Sonnet) with Claude Code CLI subprocess.

**Responsibilities:**
- Spawn `claude` CLI process with prompt via stdin, capture stdout
- Handle timeouts (30s default)
- Parse structured output (JSON) from CLI responses
- Provide typed wrapper functions: `buildDorkQueries()`, `parseLinkedInHTML()`, `scoreLead()`, `generateMessage()`

**Why CLI over API:**
- Zero LLM cost (uses Claude Code/Max subscription)
- Same model quality (Sonnet/Haiku available via CLI)
- Internal platform — latency tradeoff acceptable (2-5s vs 0.5-1s)

**Interface:**
```typescript
async function callClaude(prompt: string, options?: { timeout?: number, model?: string }): Promise<string>
async function callClaudeJSON<T>(prompt: string, schema: ZodSchema<T>): Promise<T>
```

### 2. `linkedin-playwright.ts` — Direct LinkedIn Scraping

Replaces `linkedin-mcp.ts`. Direct Playwright control over persistent Chromium browser.

**Responsibilities:**
- Manage persistent browser instance with `userDataDir` (session survives restarts)
- `searchPeople(keywords, location)` — navigate LinkedIn search, extract results
- `getProfile(linkedinUrl)` — scrape profile page (name, role, company, connections, activity, contact info)
- Rate limiting: persistent to DB (survives restarts), 50 profiles/day, 5-10s delays
- Auth detection: if login wall detected, emit event for frontend modal

**Browser Strategy:**
- Single Chromium instance with persistent user data directory
- Launch on first LinkedIn call, keep alive for duration of pipeline run
- Close after pipeline completes (or on idle timeout)
- If session expired → throw `LinkedInAuthError` → frontend shows re-login modal

**Data Extraction:**
- Use Playwright selectors for structured data (name, role, connections count)
- Fall back to Claude CLI for complex parsing only when selectors fail
- Reduces LLM calls vs current approach (parse everything with Claude)

### 3. `firecrawl-enrich.ts` — Company Enrichment via Firecrawl

Replaces `serper-enrich.ts`. Uses self-hosted Firecrawl to scrape company websites.

**Responsibilities:**
- `enrichCompany(websiteUrl)` — scrape company site, extract structured data
- Firecrawl converts HTML → clean markdown
- Claude CLI analyzes markdown → extracts: size, sector, products, tech stack, hiring status, contact info

**Self-hosted Setup:**
- Docker Compose: Firecrawl + Redis + Playwright
- Zero cost, no rate limits
- Endpoint: `http://localhost:3002/v1/scrape`

**Fallback:** If company website not found, use Serper search as today.

### 4. Improved Dork Query Builder

Replaces hardcoded dork patterns. Claude CLI builds context-aware queries.

**Current problem:**
```
site:linkedin.com/in "CTO" "fintech" "São Paulo"
→ Too rigid, misses variations, returns garbage
```

**New approach:**
- Feed Claude CLI: segment context (roles, sector, search terms, ICP), region, previously found leads
- Claude generates 5-8 varied dork queries with different strategies:
  - Exact role match: `site:linkedin.com/in "Chief Technology Officer" "fintech" "São Paulo"`
  - Role variations: `site:linkedin.com/in "CTO" OR "VP Engineering" "payments" "SP"`
  - Company-targeted: `site:linkedin.com/in "Nubank" "engineering lead"`
  - Broader discovery: `site:linkedin.com/in "technology director" "financial services" Brazil`
- Queries adapt based on what's been found (avoid repetition)

### 5. Improved Rate Limiting

Replace in-memory rate limits with DB-persisted limits.

**Current problem:** Rate limits reset on server restart.

**New approach:**
- Store daily LinkedIn usage in Supabase: `linkedin_usage(user_id, date, scrapes_count)`
- Check before each LinkedIn call
- Simple upsert: `INSERT ... ON CONFLICT (user_id, date) DO UPDATE SET scrapes_count = scrapes_count + 1`

### 6. Improved Retry Logic

**Current problem:** Retries conflate "no results" with "errors". After 5 retries of any kind, agent stops.

**New approach:**
- Separate counters: `searchRetries` (no results found) vs `errorRetries` (API/network failures)
- `searchRetries >= 8` → stop (exhausted search space)
- `errorRetries >= 3` → stop (something is broken)
- Each node reports WHY it's retrying (no_results | auth_error | network_error | parse_error)

## Pipeline Flow (Updated)

```
find_lead:
  1. Claude CLI builds dork queries (context-aware)
  2. Serper executes queries
  3. Extract candidates from results
  4. LinkedIn Search via Playwright (refine/confirm)
  5. Dedup against DB (leads + rejected_leads)
  6. Return best candidate

validate_profile:
  1. Check daily LinkedIn limit (DB-persisted)
  2. Playwright scrapes LinkedIn profile
  3. Extract: photo, connections, role, activity, contact info
  4. Playwright selectors first, Claude CLI fallback for complex parsing
  5. Validate: photo + activity + role_match

score_lead:
  1. Claude CLI scores on 4 dimensions (company_fit, role_fit, seniority, activity)
  2. Includes segment context + company profile + ICP
  3. Returns score 0-100 with justification

enrich_lead:
  1. Find company website (from LinkedIn or Serper)
  2. Firecrawl self-hosted scrapes website → markdown
  3. Claude CLI extracts structured company data
  4. Merge with existing data

create_lead:
  1. Claude CLI generates personalized LinkedIn message (Portuguese, max 300 chars)
  2. Persist company + lead to Supabase
  3. Update agent_run counters
```

## New Files

| File | Replaces | Purpose |
|---|---|---|
| `src/lib/claude-cli.ts` | Claude API calls everywhere | CLI subprocess wrapper |
| `src/lib/linkedin-playwright.ts` | `linkedin-mcp.ts` | Direct Playwright LinkedIn |
| `src/lib/firecrawl-enrich.ts` | `serper-enrich.ts` | Company enrichment via Firecrawl |
| `src/lib/agent/nodes/find-lead.ts` | Same file (rewrite) | Better dorks + two-step search |
| `src/lib/agent/nodes/validate-profile.ts` | Same file (rewrite) | Playwright-based validation |
| `src/lib/agent/nodes/score-lead.ts` | Same file (rewrite) | CLI-based scoring |
| `src/lib/agent/nodes/enrich-lead.ts` | Same file (rewrite) | Firecrawl-based enrichment |
| `src/lib/agent/nodes/create-lead.ts` | Same file (rewrite) | CLI-based message generation |

## Files to Remove

| File | Reason |
|---|---|
| `src/lib/linkedin-mcp.ts` | Replaced by `linkedin-playwright.ts` |
| `src/lib/linkedin-login.ts` | Login handled by persistent browser |
| `src/lib/serper-enrich.ts` | Replaced by `firecrawl-enrich.ts` |
| `src/lib/claude-auth.ts` | No more Claude API calls |
| `scripts/linkedin-login.py` | No more auto-login script |

## Files Unchanged

- `src/lib/google-search.ts` — Serper wrapper stays (dork execution)
- `src/lib/agent/graph.ts` — Same graph structure, updated imports
- `src/lib/agent/state.ts` — Add `searchRetries`/`errorRetries`, keep rest
- `src/app/api/prospect/` — Same SSE contract
- All frontend files

## Infrastructure Requirements

- **Firecrawl self-hosted**: Docker Compose (Firecrawl + Redis + Playwright)
- **Chromium persistent**: Local Chromium with `userDataDir` for LinkedIn sessions
- **Claude Code CLI**: Must be installed and authenticated on the server
- **Supabase migration**: Add `linkedin_usage` table for persistent rate limits

## Cost Analysis

| Item | Current Cost | New Cost |
|---|---|---|
| Claude API (Haiku/Sonnet) | ~$5-20/mo | $0 (CLI/Max subscription) |
| Serper | $50/mo | $50/mo (keep) |
| LinkedIn MCP | Free (self-hosted) | Free (Playwright) |
| Firecrawl | N/A | Free (self-hosted Docker) |
| Supabase | Free tier | Free tier |
| **Total** | **~$55-70/mo** | **~$50/mo** |
