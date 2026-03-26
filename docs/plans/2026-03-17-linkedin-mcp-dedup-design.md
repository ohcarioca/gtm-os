# LinkedIn MCP Integration & Lead Deduplication — Design Document

**Date:** 2026-03-17
**Status:** Approved

## Overview

Two improvements to the prospecting pipeline:
1. **LinkedIn MCP Server Integration** — Replace the validate-profile stub with real LinkedIn data via stickerdaniel/linkedin-mcp-server. Validates activity recency (max 2 months) and extracts real profile data.
2. **Lead Deduplication** — Prevent duplicate leads by checking linkedin_url in find-decision-maker before proceeding.

---

## Feature 1: LinkedIn MCP Integration

### Setup

- LinkedIn MCP server runs as a separate HTTP service: `uvx linkedin-scraper-mcp --transport streamable-http --port 8080`
- Auth: manual browser login once (`uvx linkedin-scraper-mcp --login`), session persists in `~/.linkedin-mcp/profile/`
- Env var: `LINKEDIN_MCP_URL=http://127.0.0.1:8080/mcp`

### MCP Client

New file `src/lib/linkedin-mcp.ts`:
- Connects to MCP server via `StreamableHTTPClientTransport` from `@modelcontextprotocol/sdk`
- Exposes `getLinkedInProfile(linkedinUsername)` that calls `get_person_profile` with sections `posts,contact_info`
- Uses Claude to parse raw text into structured data: connections, role, last_post_date, contact info

### Pipeline Changes

**`validate-profile.ts`** — Replace stub with real validation:
1. Extract username from LinkedIn URL (`/in/username/`)
2. Call `getLinkedInProfile(username)`
3. Claude extracts structured data from raw text
4. Validation checks:
   - `photo`: profile exists with data
   - `connections`: extracted count
   - `role_match`: role matches targetRoles
   - `activity`: last post date ≤ 2 months ago
5. If activity is stale (>2 months or no posts), profile fails validation → skip to next company
6. Store `recent_activity` and `connections` on state for create-lead to save

### Fallback

If MCP server is offline or errors, fallback to current stub behavior. Log records fallback usage.

---

## Feature 2: Lead Deduplication

### In `find-decision-maker.ts`

After finding LinkedIn profiles via Google Dork:
1. Normalize linkedin_url (remove query params, trailing slash, ensure lowercase)
2. Query Supabase: check if `leads.linkedin_url = normalized_url AND user_id = userId`
3. If exists → log "Duplicate lead: {name}, skipping" → try next Google result
4. If all results are duplicates → log "No new decision makers" → retry search_company

### Database

New unique partial index: `CREATE UNIQUE INDEX idx_leads_linkedin_url_user ON leads(user_id, linkedin_url) WHERE linkedin_url IS NOT NULL`

---

## Technical Notes

- MCP SDK (`@modelcontextprotocol/sdk`) already installed in node_modules
- Rate limits: 5-10 profiles/min, 2s delay between pages (handled by MCP server)
- MCP returns raw innerText, not structured JSON — Claude must parse
- Pipeline should request minimal sections (posts + contact_info) to reduce scraping time
- Deduplication check uses service_role key (same as create-lead) to query across all user leads
