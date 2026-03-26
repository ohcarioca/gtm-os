# Dedicated Pages Design — Dashboard, Pipeline, Contacts, Segments

## Overview

Split the monolithic `/dashboard` page into 4 dedicated pages with proper CRUD functionality. Add metrics dashboard, move kanban to `/pipeline`, create full CRUD for contacts and segments.

## Pages

### `/dashboard` — Metrics Summary

Server component fetching leads, runs, and agent logs from Supabase.

**Cards (top row):**
- Total Leads
- Total Runs
- Conversion Rate (converted / total leads)
- SerpAPI Queries (count `search_company` steps in agent_runs.log)

**Leads by Stage:** 5 mini-cards (identified, connected, in_conversation, converted, lost) with counts.

**Leads by Score:** 4 badges (A+, A, B, C) with counts.

**Leads Found vs Approved:** comparative display from agent_runs (leads_found vs leads_approved).

### `/pipeline` — Kanban Board

- Moves existing `PipelineKanban` component here
- Server component fetches leads + segments, passes as props
- Same drag-and-drop with `@dnd-kit`

### `/contacts` — Lead Management (CRUD)

- Moves existing `ContactsTable` here
- **Add Lead** button → `add-lead-modal` with fields:
  - Required: Name, Company, LinkedIn URL
  - Optional: Role, Stage, Score, Phone, Email, Notes
- Click row → `LeadDetailModal` (existing) with edit/delete actions
- **Edit** → `edit-lead-modal` with same fields
- **Delete** → `confirm-modal` before deletion

### `/segments` — Segment Management (CRUD)

- `segments-table` listing: name, description, target_roles, search_terms, company_size_targets
- **Add Segment** button → `add-segment-modal` with existing fields
- Confirmation modal before creating
- **Edit** → `edit-segment-modal`
- **Delete** → `confirm-modal` before deletion

## New Components

| Component | Type | Purpose |
|---|---|---|
| `metrics-cards.tsx` | Client | Dashboard metric cards |
| `add-lead-modal.tsx` | Client | Create lead form modal |
| `edit-lead-modal.tsx` | Client | Edit lead form modal |
| `confirm-modal.tsx` | Client | Generic confirmation dialog (reused) |
| `segments-table.tsx` | Client | Segments list with actions |
| `add-segment-modal.tsx` | Client | Create segment modal |
| `edit-segment-modal.tsx` | Client | Edit segment modal |

## Server Actions

| Action | File | Description |
|---|---|---|
| `createLead()` | `contacts/actions.ts` | Create manual lead (Zod validated, includes user_id) |
| `updateLead()` | `contacts/actions.ts` | Update existing lead |
| `deleteLead()` | `contacts/actions.ts` | Delete lead (RLS enforced) |
| `createSegment()` | `segments/actions.ts` | Moved from settings/actions.ts |
| `updateSegment()` | `segments/actions.ts` | Update existing segment |
| `deleteSegment()` | `segments/actions.ts` | Moved from settings/actions.ts |

## Database Migration (003)

Add columns to `leads` table:
- `phone TEXT`
- `email TEXT`
- `notes TEXT`

## Sidebar Update

7 flat links:
1. Dashboard (LayoutDashboard) → /dashboard
2. Pipeline (Kanban) → /pipeline
3. Contatos (Users) → /contacts
4. Segmentos (Target) → /segments
5. Prospectar (Search) → /prospect
6. Execuções (Activity) → /runs
7. Configurações (Settings) → /settings

## Validation Schemas

- `createLeadSchema`: name (min 1), company_name (min 1), linkedin_url (url), role/stage/score/phone/email/notes optional
- `updateLeadSchema`: all optional except id (uuid)
- `createSegmentSchema`: reuse existing
- `updateSegmentSchema`: existing fields + id required

## Flows

**Add Lead:** Click button → fill form → Zod validates → createLead() → revalidatePath → toast

**Delete Lead/Segment:** Click trash → confirm-modal → server action → revalidatePath → toast

**Create Segment:** Fill form → click save → confirm-modal with summary → createSegment() → revalidatePath → toast

## Principles Applied

- Server Components by default, "use client" only for interactivity
- All inputs Zod-validated
- RLS on all queries (user_id enforced)
- shadcn/ui components, Tailwind only
- Reuse existing components (PipelineKanban, ContactsTable, LeadDetailModal)
