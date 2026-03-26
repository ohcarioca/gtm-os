# Company Profile & Lead Enrichment — Design Document

**Date:** 2026-03-17
**Status:** Approved

## Overview

Two independent features:
1. **Company Profile ("Minha Empresa")** — User registers their own company info (name, sector, value proposition, ICP) in Settings. The agent uses this to improve search queries and personalize LinkedIn messages.
2. **Lead Enrichment** — Enrich leads and their companies with data from Serper (Google Search + Google Maps). Runs automatically in the pipeline and manually via button.

---

## Feature 1: Company Profile

### Database

New table `company_profiles` (one row per user):

| Column | Type | Description |
|--------|------|-------------|
| id | uuid PK (gen_random_uuid()) | |
| user_id | uuid FK → auth.users (UNIQUE) | One profile per user |
| name | text NOT NULL | Company name (e.g., "Debtify") |
| sector | text NOT NULL | Sector (e.g., "Cobrança digital") |
| value_proposition | text NOT NULL | Value proposition |
| icp | text NOT NULL | Ideal Customer Profile description |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

RLS: `user_id = auth.uid()` for all operations.

### UI

In the Settings page (`/settings`), above the LinkedIn credentials section:
- Section title: "Minha Empresa"
- 4 fields: Nome, Setor, Proposta de Valor, ICP
- "Salvar" button → Server Action `saveCompanyProfile`
- Green indicator when saved (same pattern as LinkedIn creds)

### Pipeline Impact

1. **search_company node**: Injects sector + ICP keywords into search queries for more precise results.
2. **create_lead node**: Claude prompt receives company name, value proposition, and ICP to generate personalized LinkedIn messages referencing the user's product/service.

---

## Feature 2: Lead Enrichment

### Data Sources

**Google Search** (`"CompanyName" site telefone email contato`):
- Contact email, phone
- Company description/summary
- Social media links

**Google Maps** (company name + city):
- Full address
- Phone number
- Rating + review count
- Business hours
- Business category

**Contact Search** (`"FullName" "Company" email telefone`):
- Personal email, phone

### Database Changes

**Migration**: Add `metadata jsonb DEFAULT '{}' NOT NULL` to `leads` table.

**Company metadata** (existing JSONB field):
```json
{
  "address": "Rua X, 123 - São Paulo",
  "phone": "+55 11 9999-0000",
  "rating": 4.5,
  "reviews_count": 32,
  "category": "Tecnologia",
  "business_hours": "Seg-Sex 9h-18h",
  "description": "Empresa de cobrança digital...",
  "enriched_at": "2026-03-17T10:00:00Z"
}
```

**Lead**: Populate existing `phone`/`email` fields + `metadata` JSONB for extra data.

### Pipeline — New Node `enrich_lead`

Position: `validate_profile → enrich_lead → create_lead`

The node makes 3 Serper calls:
1. Google Search for the company
2. Google Maps for the company
3. Google Search for the contact

Uses Claude to extract structured data from raw search results (intelligent parsing).

### API Route — Manual Enrichment

`POST /api/enrich` — receives `{ lead_id }`:
- Fetches lead + company from DB
- Runs same enrichment logic as pipeline node
- Updates company.metadata + lead.phone/email/metadata
- Returns updated data

### UI

In contacts table and pipeline kanban:
- "Enriquecer" button/icon on each lead
- Loading state during enrichment
- Enriched data visible in lead detail modal
- Badge indicating enrichment status (enriched vs not)

---

## Technical Notes

- Serper API key already configured (`SERPER_API_KEY`)
- All new tables/columns follow existing RLS patterns
- Enrichment logic shared between pipeline node and API route (single utility function)
- Rate limiting: respect Serper limits (batch calls, not parallel)
- Claude used for structured extraction from search results (not raw regex)
