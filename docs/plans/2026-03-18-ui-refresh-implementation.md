# UI/UX Refresh — Implementation Plan

**Date:** 2026-03-18
**Design:** [2026-03-18-ui-refresh-design.md](./2026-03-18-ui-refresh-design.md)

## Implementation Steps

### Step 1: Theme Foundation (globals.css + tailwind.config.ts)
**Files:** `src/app/globals.css`, `tailwind.config.ts`

Update CSS variables to Indigo + Slate palette:
- Replace `--primary` with indigo-600 HSL values
- Replace `--secondary` with slate values
- Update `--accent` to indigo
- Update `--background` to slate-50
- Update all `--sidebar-*` variables for dark sidebar
- Keep border-radius at 0.5rem
- Add `--radius-xl: 0.75rem` for cards

### Step 2: Dark Sidebar
**Files:** `src/components/sidebar.tsx`, `src/app/(app)/layout.tsx`

Rebuild sidebar:
- Dark background (slate-900)
- Logo/title area: indigo icon + white text
- Nav items: slate-400 default, indigo-400 active with indigo bg/10 + left border
- Hover: slate-300 text
- User section at bottom: email from Supabase user + sign out button
- Pass user email from layout.tsx to Sidebar as prop
- Update layout.tsx main bg to `bg-slate-50`

### Step 3: Dashboard Refresh
**Files:** `src/app/(app)/dashboard/page.tsx`, `src/components/metrics-cards.tsx`

- Redesign KPI cards: add icon (top-left, muted), large number, trend indicator (↑↓ with color)
- Add Pipeline Summary bar: colored horizontal bar proportional to stage counts, legend below
- Improve "Leads por Score" section with better badges
- Add "Leads Recentes" simple list (last 5 leads with time ago)
- Use `rounded-xl shadow-sm` card style throughout

### Step 4: Pipeline Kanban Polish
**Files:** `src/components/pipeline-kanban.tsx`, `src/components/lead-card.tsx`

- Column headers: colored dot + title + count badge
- Lead cards: show name, role · company, score badge, contact icons (email/phone if available), time ago
- Enrich button visible on hover
- LinkedIn icon link if URL exists
- Better hover state (shadow elevation)
- `rounded-xl` cards

### Step 5: Contacts Grid/Table Toggle
**Files:** `src/app/(app)/contacts/page.tsx`, `src/components/contacts-table.tsx`

- Add view toggle buttons (grid/table icons) in header
- Create grid view: 4-col card grid with colored initial circles, name, email, phone, role, score
- Initial circle color: deterministic from name hash (cycle through indigo, emerald, amber, rose, cyan)
- Improve table view: add avatar initials inline, better badges
- Add sort dropdown (Nome A-Z, Score, Data)
- Persist view preference in localStorage

### Step 6: Settings Cleanup
**Files:** `src/app/(app)/settings/page.tsx`

- Remove separate cards, use section dividers
- 2-column layout for short fields (nome + setor on same row)
- Cleaner form styling with indigo primary buttons
- Keep functionality identical

### Step 7: Login + Minor Pages
**Files:** `src/app/login/page.tsx`, `src/app/(app)/prospect/client.tsx`, `src/components/run-list.tsx`, `src/components/segments-table.tsx`

- Login: indigo button, slate-50 bg, cleaner card
- Prospect feed: replace emoji icons with Lucide icons, better card styling
- Runs: better status badges, card styling
- Segments: better badge display for roles/terms

### Step 8: Global Polish
**All component files**

- Replace `rounded-lg` with `rounded-xl` on all cards
- Replace `bg-gray-*` with `bg-slate-*` throughout
- Replace `text-gray-*` with `text-slate-*` throughout
- Replace `bg-blue-*` active states with `bg-indigo-*`
- Ensure consistent shadow-sm on cards
- Update empty states with centered layout + CTA

## Parallelization Strategy

Independent steps that can run in parallel:
- **Group A** (foundation): Step 1 (theme) — must go first
- **Group B** (after Step 1): Steps 2, 6, 7 can run in parallel
- **Group C** (after Step 1): Steps 3, 4, 5 can run in parallel
- **Group D** (after all): Step 8 (global polish)

Recommended: Step 1 first, then Steps 2-7 in parallel via subagents, then Step 8 as final pass.
