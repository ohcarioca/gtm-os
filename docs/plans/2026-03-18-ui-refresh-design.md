# UI/UX Refresh — Design Document

**Date:** 2026-03-18
**Status:** Approved

## Overview

Modernize the GTM Agents UI following reference design patterns (Debtify-style SaaS). Adopt Indigo + Slate color palette, dark sidebar, richer components, and polished UX across all pages.

## Design Decisions

| Decision | Choice |
|----------|--------|
| Color palette | Indigo + Slate |
| Sidebar style | Dark (slate-900) |
| Contacts view | Toggle grid/table |
| Dashboard | Métricas melhoradas + Pipeline summary |
| Pipeline cards | Richer cards with score, icons, quick actions |
| Settings | Cleaner layout, 2-col where appropriate |
| Login | Minimal, centered, indigo accent |
| Typography | Inter (keep), refined hierarchy |
| Empty states | Text + CTA button |

## 1. Color System

Replace current gray/blue with Indigo + Slate:

```css
:root {
  --primary: 238.7 83.5% 66.7%;        /* indigo-500 #6366F1 */
  --primary-foreground: 0 0% 100%;      /* white */
  --secondary: 215.4 16.3% 46.9%;      /* slate-500 */
  --accent: 243.4 75.4% 58.6%;         /* indigo-600 #4F46E5 */
  --background: 210 40% 98%;           /* slate-50 */
  --card: 0 0% 100%;                   /* white */
  --muted: 210 40% 96.1%;             /* slate-100 */
  --border: 214.3 31.8% 91.4%;        /* slate-200 */
  --sidebar-background: 222.2 47.4% 11.2%;  /* slate-900 */
  --sidebar-foreground: 210 40% 98%;         /* slate-50 */
  --sidebar-primary: 238.7 83.5% 66.7%;     /* indigo-500 */
  --sidebar-accent: 217.2 32.6% 17.5%;      /* slate-800 */
}
```

Semantic colors (unchanged):
- Success: green-500/green-100
- Warning: yellow-500/yellow-100
- Error: red-500/red-100
- Info: blue-500/blue-100

## 2. Sidebar (Dark)

```
┌──────────────────┐
│ ◆ GTM Agents     │  ← indigo icon + white text
│                  │
│ ▸ Dashboard      │  ← slate-400 text, indigo bg when active
│ ▸ Pipeline       │
│ ▸ Contatos       │
│ ▸ Segmentos      │
│ ▸ Prospectar     │
│ ▸ Execuções      │
│ ▸ Configurações  │
│                  │
│ ──────────────── │
│ 👤 User email    │  ← bottom, muted text + logout
└──────────────────┘
```

- Background: slate-900
- Active item: indigo-500/10 bg + indigo-400 text + indigo-400 left border
- Inactive: slate-400 text, hover slate-300
- Icons: 20px, same color as text
- User section at bottom with email + sign out button

## 3. Dashboard

```
┌─────────────────────────────────────────────┐
│ Dashboard                                    │
│ Visão geral da sua prospecção                │
│                                              │
│ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐        │
│ │Total │ │Exec. │ │Conv. │ │Score │        │
│ │Leads │ │      │ │Rate  │ │Médio │        │
│ │  42  │ │  8   │ │ 23%  │ │  B+  │        │
│ │↑12%  │ │↑3    │ │↓2%   │ │      │        │
│ └──────┘ └──────┘ └──────┘ └──────┘        │
│                                              │
│ ┌─── Pipeline Summary ──────────────────┐   │
│ │ ████████████████████████████████████  │   │
│ │ Identificado 12 │ Conectado 8 │ ...  │   │
│ └───────────────────────────────────────┘   │
│                                              │
│ ┌─── Por Score ───┐ ┌─── Recentes ─────┐   │
│ │ A+ 5  A 12     │ │ Lead 1  há 2d    │   │
│ │ B  15  C 10    │ │ Lead 2  há 3d    │   │
│ └─────────────────┘ └──────────────────┘   │
└─────────────────────────────────────────────┘
```

- KPI cards: white bg, subtle shadow, icon top-left (muted), trend arrow bottom
- Pipeline bar: colored segments proportional to count, legend below
- Score breakdown: horizontal bar or badge list
- Recent leads: simple list with time ago

## 4. Pipeline (Kanban)

Column headers:
```
● Identificado  12    ● Conectado  8    ● Em Conversa  6
```
- Colored dot matching stage color
- Count badge (slate-600 bg, white text)

Cards:
```
┌──────────────────────┐
│ João Silva        ⚡  │  ← name + enrich icon
│ CTO · TechCorp      │  ← role · company
│ Score: A+            │  ← badge
│ ✉ 📞  ·  há 3d      │  ← contact icons + time
└──────────────────────┘
```

- White bg, slate-200 border, rounded-lg
- Score badge (colored)
- Contact method icons (email, phone, LinkedIn)
- Time indicator in muted text
- Hover: subtle shadow elevation
- Enrich button (Sparkles icon) visible on hover

## 5. Contacts (Grid + Table Toggle)

Header:
```
Contatos                    [Search...] [Sort ▾] [+ Adicionar] [▦ ▤]
```

Grid mode (cards):
```
┌──────────────┐
│  (JS)        │  ← colored circle with initials
│ João Silva   │
│ ✉ email      │
│ 📞 phone     │
│ CTO · Tech   │  ← role · company truncated
│ Score: A+    │
│ ◇ 2 agentes  │
└──────────────┘
```

Table mode: improved current table with avatar initials inline, better badges.

- Initial circles: deterministic color from name (indigo, emerald, amber, rose, cyan cycle)
- 4-column grid on desktop, 2 on tablet
- Search filters client-side

## 6. Settings

```
┌─────────────────────────────────────────┐
│ Configurações                            │
│                                          │
│ ── Perfil da Empresa ──────────────────  │
│ [Nome da empresa    ] [Setor       ▾]   │
│ [Proposta de valor (textarea)        ]   │
│ [ICP (textarea)                      ]   │
│                         [Salvar]         │
│                                          │
│ ── LinkedIn ───────────────────────────  │
│ [Email LinkedIn     ] [Senha        ]   │
│                [Salvar] [Testar Login]   │
└─────────────────────────────────────────┘
```

- Section dividers with labels (not separate cards)
- Inline 2-column where fields are short
- Single page, no tabs

## 7. Login

```
┌──────────────────┐
│                  │
│   ◆ GTM Agents   │  ← indigo icon
│                  │
│  [Email        ] │
│  [Senha        ] │
│                  │
│  [   Entrar    ] │  ← indigo button
│                  │
└──────────────────┘
```

- Centered card on slate-50 background
- Max-w-sm, clean shadow
- Indigo primary button

## 8. General Patterns

**Cards**: white bg, `shadow-sm`, `rounded-xl`, `border border-slate-200`
**Buttons primary**: `bg-indigo-600 hover:bg-indigo-700 text-white`
**Buttons secondary**: `bg-slate-100 hover:bg-slate-200 text-slate-700`
**Page headers**: `text-2xl font-semibold text-slate-900` + subtitle `text-slate-500`
**Empty states**: centered icon + text + CTA button
**Loading**: Loader2 spin, skeleton placeholders where appropriate
**Border radius**: `rounded-xl` for cards, `rounded-lg` for buttons/inputs

## 9. Scope Exclusions

- No dark mode toggle (keep light only for now)
- No mobile responsive optimization (desktop-first MVP)
- No animations beyond hover transitions
- No chart library (sparklines/gauges deferred)
