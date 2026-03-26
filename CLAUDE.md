# GTM OS — Project Guidelines

## Project Overview

GTM OS (Go-to-Market Operating System) — AI-powered B2B prospecting with LangGraph pipelines. Finds companies, identifies decision-makers, validates LinkedIn profiles, creates scored leads.

## Tech Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Agent:** LangGraph.js + Claude Code CLI (subprocess)
- **Search:** Serper (Google Search)
- **LinkedIn:** Playwright (persistent browser, direct scraping)
- **Enrichment:** Firecrawl self-hosted (company website scraping)
- **Database:** Supabase (Postgres + Auth + RLS)
- **Validation:** Zod

## Architecture

```
src/
├── app/                    # Next.js App Router pages
│   ├── (app)/              # Protected routes
│   │   ├── dashboard/      # Main dashboard (actions.ts, page.tsx)
│   │   ├── companies/      # Company discovery & management (actions.ts, client.tsx, page.tsx)
│   │   ├── contacts/       # Contacts management (actions.ts, page.tsx)
│   │   ├── pipeline/       # Kanban pipeline view
│   │   ├── prospect/       # Prospecting form (client.tsx, page.tsx)
│   │   ├── runs/           # Agent run history
│   │   ├── settings/       # Settings + LinkedIn login (actions.ts, page.tsx)
│   │   │   └── integrations/ # Integrations page (actions.ts, client.tsx, page.tsx)
│   │   └── layout.tsx      # App shell layout
│   ├── api/
│   │   ├── prospect/       # SSE streaming for agent runs
│   │   ├── companies/discover/ # SSE streaming for company discovery
│   │   ├── chat/parse/     # Text parsing endpoint
│   │   ├── enrich/         # Company enrichment endpoint
│   │   ├── leads/from-linkedin/ # SSE streaming for LinkedIn lead creation
│   │   └── linkedin/       # LinkedIn integration
│   │       ├── login/      # Open browser for manual login
│   │       └── status/     # Check LinkedIn session status
│   ├── login/              # Public auth page
│   └── auth/callback/      # Supabase OAuth callback
├── components/             # React components (shadcn/ui based)
│   ├── ui/                 # shadcn/ui primitives
│   ├── app-shell.tsx       # Layout shell with sidebar
│   ├── dashboard-content.tsx
│   ├── sidebar.tsx         # Navigation sidebar
│   ├── contacts-table.tsx  # Contacts CRUD table
│   ├── linkedin-leads-modal.tsx  # LinkedIn URL → scrape → score → create leads
│   ├── pipeline-kanban.tsx # Lead pipeline board
│   ├── prospect-form.tsx   # Prospecting form (method + scope radio groups)
│   ├── agent-feed.tsx      # Real-time agent log feed
│   ├── run-list.tsx        # Agent run history list
│   ├── run-detail.tsx      # Individual run details
│   ├── lead-card.tsx       # Lead display card
│   ├── lead-detail-modal.tsx
│   ├── add-lead-modal.tsx
│   ├── edit-lead-modal.tsx
│   ├── company-discovery-form.tsx # Company discovery search form
│   ├── company-list.tsx       # Company list with approve/reject
│   ├── add-company-modal.tsx  # Manual single company addition
│   ├── import-companies-modal.tsx # CSV/XLSX batch company import wizard
│   ├── chat-dashboard.tsx    # Chat dashboard with state machine UI
│   ├── confirm-modal.tsx
│   └── linkedin-login-modal.tsx  # LinkedIn re-login modal (triggered by agent)
├── hooks/
│   └── use-toast.ts        # Toast notification hook
├── lib/
│   ├── supabase/           # Supabase client/server/middleware
│   ├── agent/              # LangGraph pipelines
│   │   ├── nodes/
│   │   │   ├── find-lead.ts
│   │   │   ├── search-company.ts
│   │   │   ├── find-decision-maker.ts
│   │   │   ├── validate-profile.ts
│   │   │   ├── score-and-enrich.ts  # Merged score+enrich node
│   │   │   └── create-lead.ts
│   │   ├── company-discovery/ # Company discovery pipeline
│   │   │   ├── nodes/
│   │   │   │   ├── build-queries.ts
│   │   │   │   ├── search-companies.ts
│   │   │   │   ├── triage-snippets.ts  # Haiku snippet triage
│   │   │   │   ├── scrape-company.ts
│   │   │   │   ├── analyze-company.ts
│   │   │   │   └── save-company.ts
│   │   │   ├── state.ts
│   │   │   └── graph.ts
│   │   ├── step-config.ts   # Shared step icon/color config
│   │   ├── state.ts        # Agent state definition
│   │   └── graph.ts        # Graph assembly
│   ├── types/database.ts   # TypeScript types (Supabase schema)
│   ├── validations/schemas.ts  # Zod schemas
│   ├── security/rate-limit.ts  # API rate limiting
│   ├── env.ts              # Env var validation at startup
│   ├── encryption.ts       # AES-256-GCM with random salt per credential
│   ├── claude-cli.ts       # Claude Code CLI subprocess wrapper
│   ├── linkedin-playwright.ts # Direct LinkedIn scraping via Playwright
│   ├── firecrawl-enrich.ts # Company enrichment via Firecrawl
│   ├── google-search.ts    # Serper API wrapper
│   └── utils.ts            # Shared utilities (cn, etc.)
└── middleware.ts            # Auth middleware
```

## Code Principles

### Simplicity First
- Write the simplest code that works. No premature abstractions.
- One file, one responsibility. If a file exceeds 200 lines, consider splitting.
- Prefer flat over nested. Avoid deep nesting (max 3 levels).
- No utility files "just in case." Create helpers only when used 3+ times.
- Prefer explicit over clever. Readable code > short code.

### Security — Non-Negotiable
- **ALL tables have RLS enabled.** No exceptions. Every query goes through RLS.
- **ALL API inputs validated with Zod.** No raw `request.body` usage.
- **ALL secrets in env vars.** Never hardcoded. Never in client components.
- **LinkedIn credentials encrypted with AES-256-GCM** before storage.
- **CSP headers on all responses.** No inline scripts in production.
- **Rate limiting on all API routes.** Especially `/api/prospect`.
- **No `dangerouslySetInnerHTML`.** Ever.
- **No `eval()` or `Function()`.** Ever.
- **Sanitize all user inputs** before rendering or querying.

### TypeScript
- Strict mode always. No `any` types — use `unknown` and narrow.
- Define types in `src/lib/types/`. Import from there.
- Use Zod schemas as single source of truth for validation. Infer types with `z.infer<>`.
- Prefer interfaces for objects, types for unions/intersections.

### React / Next.js
- Server Components by default. Add `"use client"` only when needed (interactivity, hooks).
- Use Server Actions for mutations. API routes only for streaming (SSE).
- No `useEffect` for data fetching — fetch in Server Components.
- Colocate components with their pages when page-specific.
- Shared components go in `src/components/`.

### Database
- Always include `user_id` in inserts for RLS.
- Use parameterized queries (Supabase client handles this).
- Never expose `service_role` key to client.
- Migrations in `supabase/migrations/` with sequential numbering.

### Agent Pipeline
- Each LangGraph node is a pure function: `(state) => Partial<state>`.
- Nodes don't call each other. The graph handles orchestration.
- Prospecting pipeline: `find_lead` → `validate_profile` → `score_and_enrich` → `create_lead` → loop. Leads always based on approved companies (no ICP/open scope in lead pipeline). Parameters (target_roles, search_terms, min_score_threshold) passed inline from the prospect form.
- `triage_company` removed — companies are pre-approved through the discovery pipeline.
- `score_and_enrich` merges scoring + enrichment in a single Sonnet call, reuses `company_markdown` from discovery.
- Template dork queries (no LLM) for company-first lead search.
- When company has `linkedin_url`, searches company people page (`/company/{slug}/people/?keywords={role}`) first, falls back to generic LinkedIn search. Skips Google dork for companies with LinkedIn URL.
- Rejected leads (validation_failed, low_score) are saved to DB for cross-run dedup. `find-lead` checks `rejected_leads` before processing.
- Company discovery pipeline: `build_queries` → `search_companies` → `triage_snippets` → `scrape_company` → `analyze_company` → `save_company` → loop.
- `triage_snippets` uses Haiku to filter non-company URLs from Google results before Firecrawl.
- `find_lead` uses approved companies for targeted queries.
- Prospect form has two dimensions: method (full=Google+LinkedIn+Firecrawl, linkedin_direct=LinkedIn+Firecrawl) and scope (companies=approved list, icp=ICP types+region).
- Streaming uses `streamMode: "updates"` to avoid duplicate log entries.
- LLM calls use Claude Code CLI subprocess (`claude --print`) — zero API cost.
- Model assignment: Haiku for extraction tasks (dork queries, search parsing, enrichment, discovery queries), Sonnet for reasoning tasks (triage, scoring+message, profile analysis, company analysis). No calls use Opus.
- LinkedIn scraping via Playwright with persistent browser (`~/.gtm-agent/linkedin-browser/`).
- Company enrichment via self-hosted Firecrawl (Docker, `http://localhost:3002`).
- Dork queries built by Claude CLI (context-aware, varied strategies).
- Two retry counters: `searchRetries` (no results, max 8) vs `errorRetries` (errors, max 3).
- LinkedIn rate limits persisted to DB (`linkedin_usage` table), not in-memory.
- Log every step to `agent_runs.log` for observability.
- Always handle API failures gracefully — retry or skip, never crash.

### Styling
- Tailwind CSS only. No CSS modules, no styled-components.
- Use shadcn/ui components. Don't reinvent buttons, inputs, modals.
- Design: clean, minimal, neutral tones with blue accents.
- Mobile-responsive is nice-to-have for MVP, desktop-first.

### Git
- Small, focused commits. One feature per commit.
- Commit messages: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Never commit `.env`, credentials, or secrets.

## Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run lint         # ESLint
```

## LinkedIn (Playwright)

LinkedIn scraping uses Playwright with a persistent Chromium browser. Session data stored at `~/.gtm-agent/linkedin-browser/`.

```bash
# First-time login: open browser manually to log in
npx playwright open --user-data-dir="$HOME/.gtm-agent/linkedin-browser" https://www.linkedin.com/login
```

- Session persists across restarts (stored in `userDataDir`)
- If session expires during prospecting → `LinkedInAuthError` → frontend modal for re-login
- Rate limits: 50 scrapes/day, 30 searches/day (persisted in `linkedin_usage` DB table)

## Firecrawl (Company Enrichment)

Self-hosted Firecrawl for scraping company websites.

```bash
# Start Firecrawl (Docker)
docker compose -f docker-compose.firecrawl.yml up -d
# Default: http://localhost:3002
```

- Converts websites to clean markdown for Claude CLI analysis
- Extracts: description, sector, employee count, products, tech stack, hiring status, contact info
- Env var: `FIRECRAWL_URL` (default `http://localhost:3002`)

## Database Migrations

Migrations in `supabase/migrations/` (18 total):
1. `001_initial_schema.sql` — Base schema (leads, segments, agent_runs, linkedin_credentials)
2. `002_add_company_size_targets.sql` — Company size targeting
3. `003_add_lead_contact_fields.sql` — Lead contact info fields
4. `004_add_company_profiles.sql` — Company profiles table
5. `005_add_leads_metadata.sql` — Lead metadata fields
6. `006_add_leads_linkedin_unique_index.sql` — LinkedIn URL dedup index
7. `007_add_cancelled_status.sql` — Cancelled status for agent_runs
8. `008_add_segment_score_threshold.sql` — Min score threshold per segment
9. `009_add_rejected_leads.sql` — Rejected leads table for dedup
10. `010_add_linkedin_usage.sql` — Persistent LinkedIn rate limiting
11. `011_add_prospect_companies.sql` — Prospect companies table for company-first discovery
12. `012_remove_segment_dependency.sql` — Make segment_id nullable (segments removed from UI)
13. `013_add_rejected_dedup.sql` — Rejected leads and companies tables for cross-run dedup
14. `014_add_icp_company_types.sql` — ICP company types array for company_profiles
15. `015_add_default_roles_regions.sql` — Default target roles and regions for company_profiles
16. `016_add_company_markdown.sql` — Company markdown for reuse in lead scoring
17. `017_add_api_keys.sql` — Encrypted API keys storage (Serper, etc.)
18. `018_add_company_linkedin_url.sql` — LinkedIn URL column for prospect_companies

## Key Files

### Design & Plans
- `docs/plans/2026-03-17-gtm-agents-mvp-design.md` — Approved MVP design
- `docs/plans/2026-03-17-gtm-agents-mvp-implementation.md` — MVP implementation plan
- `docs/plans/2026-03-17-dedicated-pages-design.md` — Contacts/Segments/Pipeline pages
- `docs/plans/2026-03-17-company-profile-and-enrichment-design.md` — Company enrichment feature
- `docs/plans/2026-03-17-linkedin-mcp-dedup-design.md` — LinkedIn dedup logic
- `docs/plans/2026-03-17-linkedin-auto-login.md` — Auto LinkedIn login
- `docs/plans/2026-03-18-ui-refresh-design.md` — UI refresh design
- `docs/plans/2026-03-18-ui-refresh-implementation.md` — UI refresh implementation
- `docs/plans/2026-03-18-lead-scoring-design.md` — Lead scoring & qualification design
- `docs/plans/2026-03-18-linkedin-auth-modal.md` — LinkedIn auth modal (manual re-login during prospecting)
- `docs/plans/2026-03-18-rejected-leads-dedup-design.md` — Rejected leads dedup (save & skip rejected leads)
- `docs/plans/2026-03-18-linkedin-search-first-design.md` — LinkedIn Search First (replace Google dork with LinkedIn MCP search)
- `docs/plans/2026-03-18-linkedin-search-first-implementation.md` — LinkedIn Search First implementation plan
- `docs/plans/2026-03-18-backend-rewrite-design.md` — Backend rewrite surgical approach design
- `docs/plans/2026-03-18-backend-rewrite-implementation.md` — Backend rewrite implementation plan (16 tasks)
- `docs/plans/2026-03-19-company-first-prospecting-design.md` — Company-first prospecting design
- `docs/plans/2026-03-19-company-first-prospecting-implementation.md` — Company-first prospecting implementation plan (10 tasks)
- `docs/plans/2026-03-19-manual-batch-companies-design.md` — Manual & batch company addition design
- `docs/plans/2026-03-19-manual-batch-companies-implementation.md` — Manual & batch company addition implementation plan (8 tasks)
- `docs/plans/2026-03-19-prospecting-redesign-design.md` — Prospecting redesign with two modes (companies/open)
- `docs/plans/2026-03-19-prospecting-redesign-implementation.md` — Prospecting redesign implementation plan (6 tasks)
- `docs/plans/2026-03-19-remove-segments-implementation.md` — Remove segments, inline prospect params (9 tasks)
- `docs/plans/2026-03-24-llm-efficiency-design.md` — LLM efficiency: model assignment + call consolidation
- `docs/plans/2026-03-24-llm-efficiency-implementation.md` — LLM efficiency implementation plan (5 tasks)
- `docs/plans/2026-03-25-icp-company-types-design.md` — ICP company types for open prospecting
- `docs/plans/2026-03-25-icp-company-types-implementation.md` — ICP company types implementation plan
- `docs/plans/2026-03-25-prospect-form-simplification-design.md` — Prospect form simplification (method/scope radio groups)
- `docs/plans/2026-03-25-prospect-form-simplification-implementation.md` — Prospect form simplification implementation plan (4 tasks)
- `docs/plans/2026-03-25-search-separation-design.md` — Search separation & optimization design
- `docs/plans/2026-03-25-search-separation-implementation.md` — Search separation implementation plan (10 tasks)
- `docs/plans/2026-03-25-integrations-page-design.md` — Integrations page (LinkedIn login + Serper API key)
- `docs/plans/2026-03-25-integrations-page-implementation.md` — Integrations page implementation plan (7 tasks)
- `docs/plans/2026-03-25-code-quality-design.md` — Code quality improvements design (performance, security, cleanup)
- `docs/plans/2026-03-25-code-quality-implementation.md` — Code quality implementation plan (14 tasks)
- `docs/plans/2026-03-25-linkedin-lead-creation-design.md` — Create leads from LinkedIn URLs (scrape + score + preview)
- `docs/plans/2026-03-25-linkedin-lead-creation-implementation.md` — LinkedIn lead creation implementation plan (7 tasks)
- `docs/plans/2026-03-25-company-people-search-design.md` — Company people page search priority design
- `docs/plans/2026-03-25-company-people-search-implementation.md` — Company people page search implementation plan (5 tasks)
- `docs/plans/2026-03-25-company-linkedin-url-design.md` — Extract company LinkedIn URL during scraping
- `docs/plans/2026-03-25-company-linkedin-url-implementation.md` — Company LinkedIn URL implementation plan (6 tasks)

### Core
- `src/lib/agent/graph.ts` — LangGraph pipeline assembly
- `src/lib/agent/nodes/` — Agent steps (find-lead, validate-profile, score-and-enrich, create-lead)
- `src/lib/claude-cli.ts` — Claude Code CLI subprocess wrapper
- `src/lib/linkedin-playwright.ts` — Direct LinkedIn scraping via Playwright
- `src/lib/firecrawl-enrich.ts` — Company enrichment via self-hosted Firecrawl
- `src/lib/google-search.ts` — Serper API wrapper
- `src/lib/types/database.ts` — Supabase database types

## Keeping Documentation Updated

### CLAUDE.md (this file)
Update this file when:
- New pages, API routes, or components are added — update the Architecture tree.
- New database migrations are created — add to the Migrations list.
- New design/plan documents are created — add to Key Files.
- Agent pipeline nodes change — update the Pipeline section.
- Tech stack changes (new dependencies, tools) — update Tech Stack.
- New code principles emerge — add to Code Principles.

### Memory (auto-memory system)
Update memory files when:
- Learning new user preferences or corrections → `feedback_*.md`
- Project goals, deadlines, or context change → `project_*.md`
- New external references (tools, dashboards, repos) are discovered → `reference_*.md`
- User role or knowledge evolves → `user_*.md`
- Always check existing memories before creating new ones to avoid duplicates.
- Remove or update memories that are no longer accurate.
