# Design: Extract Company LinkedIn URL During Scraping

**Date:** 2026-03-25
**Status:** Approved

## Problem

When scraping company websites (both in company discovery and enrichment), we don't extract or save the company's LinkedIn page URL. This information is usually present in the website's footer/header and is valuable for prospecting.

## Solution

Extract the company LinkedIn URL from the website markdown that the LLM already analyzes. No extra API calls or searches needed — just add `linkedin_url` to the existing LLM prompts.

## Approach

**Extract from website markdown (LLM analysis)** — the simplest option. The LLM already reads the full markdown of the company website. Most company sites include their LinkedIn page link in the footer, header, or "about us" section. We just need to ask the LLM to extract it.

### Why not other approaches?
- Google search results: would require keeping LinkedIn results that are currently filtered out, adding complexity
- Dedicated LinkedIn search: extra API call, unnecessary cost

## Changes

### 1. Database Migration (`018_add_company_linkedin_url.sql`)
- Add `linkedin_url TEXT NULL` to `prospect_companies` table

### 2. Company Discovery Pipeline — `analyze-company.ts`
- Add `linkedin_url: z.string().nullable().optional()` to `analysisSchema`
- Add to LLM prompt: "extract the company LinkedIn page URL if present (e.g. linkedin.com/company/...)"
- Pass `linkedin_url` in the analysis JSON output

### 3. Company Discovery Pipeline — `save-company.ts`
- Read `linkedin_url` from the analysis JSON
- Include `linkedin_url` in the Supabase insert

### 4. Enrichment — `firecrawl-enrich.ts`
- Add `linkedinUrl: string | null` to `CompanyEnrichment` interface
- Add `linkedinUrl: z.string().nullable()` to `enrichmentSchema`
- Add to LLM prompt: "linkedinUrl: company LinkedIn page URL (e.g. https://linkedin.com/company/...)"
- Return `linkedinUrl` in the enrichment result

### 5. Types — `database.ts`
- Add `linkedin_url: string | null` to `ProspectCompany` interface

## What doesn't change
- No new pipeline nodes
- No extra Google searches
- No extra API calls
- No frontend changes (future scope)
