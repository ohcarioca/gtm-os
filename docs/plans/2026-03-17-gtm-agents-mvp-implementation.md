# GTM Agents MVP — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an end-to-end GTM prospecting platform with AI agents that find companies, identify decision-makers, validate LinkedIn profiles, and create scored leads.

**Architecture:** Next.js 14 App Router frontend with Supabase backend (Postgres + Auth + RLS). LangGraph.js orchestrates a 4-step agent pipeline (Google Search → Google Dork → LinkedIn Validate → Create Lead). LinkedIn scraping via stickerdaniel/linkedin-mcp-server. Real-time progress via SSE.

**Tech Stack:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui, LangGraph.js, Claude API, SerpAPI, Supabase, Zod

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.js`
- Create: `.env.local.example`, `.env.local`, `.gitignore`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`

**Step 1: Initialize Next.js project**

Run:
```bash
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm
```
Expected: Project scaffolded with App Router structure.

**Step 2: Install core dependencies**

Run:
```bash
npm install @supabase/supabase-js @supabase/ssr @langchain/core @langchain/anthropic @langchain/langgraph zod lucide-react @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities
```

**Step 3: Install shadcn/ui**

Run:
```bash
npx shadcn@latest init -d
npx shadcn@latest add button card input label select table badge dialog dropdown-menu tabs toast separator sheet scroll-area
```

**Step 4: Create .env.local.example**

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Claude API
ANTHROPIC_API_KEY=

# SerpAPI
SERPAPI_API_KEY=

# LinkedIn Credentials Encryption
LINKEDIN_ENCRYPTION_KEY=

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Step 5: Create .gitignore additions**

Ensure `.env.local`, `.env`, `node_modules/`, `.next/` are in `.gitignore`.

**Step 6: Commit**

```bash
git add -A
git commit -m "feat: scaffold Next.js project with core dependencies"
```

---

## Task 2: Supabase Setup & Database Schema

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Create: `supabase/migrations/001_initial_schema.sql`

**Step 1: Create Supabase client utilities**

`src/lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

`src/lib/supabase/server.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}
```

`src/lib/supabase/middleware.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (
    !user &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
```

**Step 2: Create middleware.ts**

`src/middleware.ts`:
```typescript
import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

**Step 3: Create database migration**

`supabase/migrations/001_initial_schema.sql`:
```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Segments table
CREATE TABLE segments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  target_roles TEXT[] NOT NULL DEFAULT '{}',
  search_terms TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Companies table
CREATE TABLE companies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  city TEXT,
  state TEXT,
  size TEXT CHECK (size IN ('small', 'medium', 'large')),
  website TEXT,
  linkedin_url TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads table
CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  linkedin_url TEXT,
  photo_url TEXT,
  connections INT,
  recent_activity TEXT,
  stage TEXT NOT NULL DEFAULT 'identified'
    CHECK (stage IN ('identified', 'connected', 'in_conversation', 'converted', 'lost')),
  score TEXT CHECK (score IN ('A+', 'A', 'B', 'C')),
  bant JSONB DEFAULT '{}',
  message TEXT,
  validation JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agent runs table
CREATE TABLE agent_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  quantity INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  leads_found INT DEFAULT 0,
  leads_approved INT DEFAULT 0,
  log JSONB[] DEFAULT '{}',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- LinkedIn credentials table (encrypted)
CREATE TABLE linkedin_credentials (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  encrypted_email TEXT NOT NULL,
  encrypted_password TEXT NOT NULL,
  session_cookies JSONB,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER linkedin_credentials_updated_at
  BEFORE UPDATE ON linkedin_credentials
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Row Level Security
ALTER TABLE segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE linkedin_credentials ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can manage own segments"
  ON segments FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own companies"
  ON companies FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own leads"
  ON leads FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own agent_runs"
  ON agent_runs FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage own linkedin_credentials"
  ON linkedin_credentials FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_leads_stage ON leads(stage);
CREATE INDEX idx_leads_company ON leads(company_id);
CREATE INDEX idx_leads_user_stage ON leads(user_id, stage);
CREATE INDEX idx_companies_segment ON companies(segment_id);
CREATE INDEX idx_agent_runs_status ON agent_runs(status);
CREATE INDEX idx_agent_runs_user ON agent_runs(user_id);
```

**Step 4: Run migration in Supabase dashboard or CLI**

Run: Apply migration via Supabase Dashboard → SQL Editor, or:
```bash
npx supabase db push
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add Supabase client setup and database schema with RLS"
```

---

## Task 3: TypeScript Types & Zod Schemas

**Files:**
- Create: `src/lib/types/database.ts`
- Create: `src/lib/validations/schemas.ts`

**Step 1: Create database types**

`src/lib/types/database.ts`:
```typescript
export type Stage = "identified" | "connected" | "in_conversation" | "converted" | "lost";
export type Score = "A+" | "A" | "B" | "C";
export type CompanySize = "small" | "medium" | "large";
export type RunStatus = "running" | "completed" | "failed";

export interface Segment {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  target_roles: string[];
  search_terms: string[];
  created_at: string;
}

export interface Company {
  id: string;
  user_id: string;
  segment_id: string;
  name: string;
  city: string | null;
  state: string | null;
  size: CompanySize | null;
  website: string | null;
  linkedin_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  role: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  connections: number | null;
  recent_activity: string | null;
  stage: Stage;
  score: Score | null;
  bant: { budget?: string; authority?: string; need?: string; timing?: string };
  message: string | null;
  validation: { photo?: boolean; connections?: boolean; role_match?: boolean; activity?: boolean };
  created_at: string;
  updated_at: string;
  company?: Company;
}

export interface AgentRun {
  id: string;
  user_id: string;
  segment_id: string;
  region: string;
  quantity: number;
  status: RunStatus;
  leads_found: number;
  leads_approved: number;
  log: AgentLogEntry[];
  started_at: string;
  finished_at: string | null;
  segment?: Segment;
}

export interface AgentLogEntry {
  step: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface LinkedInCredentials {
  id: string;
  user_id: string;
  encrypted_email: string;
  encrypted_password: string;
  session_cookies: Record<string, unknown> | null;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}
```

**Step 2: Create Zod validation schemas**

`src/lib/validations/schemas.ts`:
```typescript
import { z } from "zod";

export const stageEnum = z.enum(["identified", "connected", "in_conversation", "converted", "lost"]);
export const scoreEnum = z.enum(["A+", "A", "B", "C"]);
export const companySizeEnum = z.enum(["small", "medium", "large"]);

export const createSegmentSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  target_roles: z.array(z.string().min(1)).min(1),
  search_terms: z.array(z.string().min(1)).min(1),
});

export const updateLeadStageSchema = z.object({
  id: z.string().uuid(),
  stage: stageEnum,
});

export const prospectRequestSchema = z.object({
  segment_id: z.string().uuid(),
  region: z.string().min(1).max(100),
  quantity: z.number().int().min(1).max(20),
});

export const linkedinCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type CreateSegmentInput = z.infer<typeof createSegmentSchema>;
export type UpdateLeadStageInput = z.infer<typeof updateLeadStageSchema>;
export type ProspectRequestInput = z.infer<typeof prospectRequestSchema>;
export type LinkedInCredentialsInput = z.infer<typeof linkedinCredentialsSchema>;
```

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add TypeScript types and Zod validation schemas"
```

---

## Task 4: Auth — Login Page & Auth Callback

**Files:**
- Create: `src/app/login/page.tsx`
- Create: `src/app/auth/callback/route.ts`
- Modify: `src/app/layout.tsx`

**Step 1: Create login page**

`src/app/login/page.tsx`:
```typescript
"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">GTM Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && <p className="text-sm text-red-500">{error}</p>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Entrando..." : "Entrar"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Create auth callback**

`src/app/auth/callback/route.ts`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
```

**Step 3: Verify login flow works**

Run: `npm run dev`
Navigate to `http://localhost:3000` → should redirect to `/login`.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add login page and auth callback with Supabase Auth"
```

---

## Task 5: App Layout — Sidebar & Shell

**Files:**
- Create: `src/app/(app)/layout.tsx`
- Create: `src/components/sidebar.tsx`
- Create: `src/app/(app)/dashboard/page.tsx` (placeholder)

**Step 1: Create sidebar component**

`src/components/sidebar.tsx`:
```typescript
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Search, Settings, Activity } from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { name: "Prospectar", href: "/prospect", icon: Search },
  { name: "Execuções", href: "/runs", icon: Activity },
  { name: "Configurações", href: "/settings", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-screen w-64 flex-col border-r bg-white">
      <div className="flex h-16 items-center border-b px-6">
        <h1 className="text-xl font-bold">GTM Agents</h1>
      </div>
      <nav className="flex-1 space-y-1 p-4">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              pathname === item.href
                ? "bg-blue-50 text-blue-700"
                : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.name}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
```

**Step 2: Create app layout**

`src/app/(app)/layout.tsx`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex-1 overflow-auto bg-gray-50 p-6">
        {children}
      </main>
    </div>
  );
}
```

**Step 3: Create dashboard placeholder**

`src/app/(app)/dashboard/page.tsx`:
```typescript
export default function DashboardPage() {
  return (
    <div>
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <p className="text-gray-500 mt-2">Pipeline e contatos aparecerão aqui.</p>
    </div>
  );
}
```

**Step 4: Verify layout renders**

Run: `npm run dev`, login, verify sidebar + dashboard placeholder render.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add app shell with sidebar navigation and protected layout"
```

---

## Task 6: Dashboard — Pipeline Kanban

**Files:**
- Create: `src/components/pipeline-kanban.tsx`
- Create: `src/components/lead-card.tsx`
- Create: `src/app/(app)/dashboard/actions.ts`
- Modify: `src/app/(app)/dashboard/page.tsx`

**Step 1: Create lead card component**

`src/components/lead-card.tsx`:
```typescript
"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Lead } from "@/lib/types/database";

interface LeadCardProps {
  lead: Lead;
  onClick: (lead: Lead) => void;
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: lead.id,
    data: { lead },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const scoreColors: Record<string, string> = {
    "A+": "bg-green-100 text-green-800",
    A: "bg-blue-100 text-blue-800",
    B: "bg-yellow-100 text-yellow-800",
    C: "bg-gray-100 text-gray-800",
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="cursor-grab active:cursor-grabbing mb-2"
      onClick={() => onClick(lead)}
    >
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <p className="font-medium text-sm truncate">{lead.name}</p>
          {lead.score && (
            <Badge variant="secondary" className={scoreColors[lead.score]}>
              {lead.score}
            </Badge>
          )}
        </div>
        <p className="text-xs text-gray-500 truncate mt-1">{lead.role}</p>
        <p className="text-xs text-gray-400 truncate">{lead.company?.name}</p>
      </CardContent>
    </Card>
  );
}
```

**Step 2: Create pipeline kanban**

`src/components/pipeline-kanban.tsx`:
```typescript
"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LeadCard } from "@/components/lead-card";
import { updateLeadStage } from "@/app/(app)/dashboard/actions";
import type { Lead, Stage } from "@/lib/types/database";

const STAGES: { id: Stage; label: string; color: string }[] = [
  { id: "identified", label: "Identificado", color: "border-t-blue-500" },
  { id: "connected", label: "Conectado", color: "border-t-yellow-500" },
  { id: "in_conversation", label: "Em Conversa", color: "border-t-purple-500" },
  { id: "converted", label: "Convertido", color: "border-t-green-500" },
  { id: "lost", label: "Perdido", color: "border-t-red-500" },
];

interface PipelineKanbanProps {
  leads: Lead[];
}

export function PipelineKanban({ leads: initialLeads }: PipelineKanbanProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const leadId = active.id as string;
    const newStage = over.id as Stage;

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === newStage) return;

    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage: newStage } : l))
    );

    updateLeadStage(leadId, newStage);
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <div className="grid grid-cols-5 gap-4">
        {STAGES.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage === stage.id);
          return (
            <div
              key={stage.id}
              className={`rounded-lg border border-t-4 ${stage.color} bg-white p-3 min-h-[300px]`}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{stage.label}</h3>
                <span className="text-xs text-gray-400">{stageLeads.length}</span>
              </div>
              <SortableContext
                id={stage.id}
                items={stageLeads.map((l) => l.id)}
                strategy={verticalListSortingStrategy}
              >
                {stageLeads.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onClick={() => {}} />
                ))}
              </SortableContext>
            </div>
          );
        })}
      </div>
      <DragOverlay>
        {activeId ? (
          <LeadCard
            lead={leads.find((l) => l.id === activeId)!}
            onClick={() => {}}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
```

**Step 3: Create server action for stage update**

`src/app/(app)/dashboard/actions.ts`:
```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { updateLeadStageSchema } from "@/lib/validations/schemas";
import type { Stage } from "@/lib/types/database";

export async function updateLeadStage(id: string, stage: Stage) {
  const parsed = updateLeadStageSchema.safeParse({ id, stage });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.id);

  if (error) throw new Error(error.message);
}
```

**Step 4: Update dashboard page**

`src/app/(app)/dashboard/page.tsx`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { PipelineKanban } from "@/components/pipeline-kanban";
import type { Lead } from "@/lib/types/database";

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Dashboard</h2>
      <PipelineKanban leads={(leads as Lead[]) ?? []} />
    </div>
  );
}
```

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add pipeline kanban with drag-and-drop stage management"
```

---

## Task 7: Dashboard — Contacts Table

**Files:**
- Create: `src/components/contacts-table.tsx`
- Create: `src/components/lead-detail-modal.tsx`
- Modify: `src/app/(app)/dashboard/page.tsx`

**Step 1: Create contacts table**

`src/components/contacts-table.tsx`:
```typescript
"use client";

import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { LeadDetailModal } from "@/components/lead-detail-modal";
import type { Lead, Segment } from "@/lib/types/database";

interface ContactsTableProps {
  leads: Lead[];
  segments: Segment[];
}

const stageLabels: Record<string, string> = {
  identified: "Identificado",
  connected: "Conectado",
  in_conversation: "Em Conversa",
  converted: "Convertido",
  lost: "Perdido",
};

export function ContactsTable({ leads, segments }: ContactsTableProps) {
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const filtered = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(search.toLowerCase()) ||
      lead.company?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStage = stageFilter === "all" || lead.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Input
          placeholder="Buscar por nome ou empresa..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar estágio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="identified">Identificado</SelectItem>
            <SelectItem value="connected">Conectado</SelectItem>
            <SelectItem value="in_conversation">Em Conversa</SelectItem>
            <SelectItem value="converted">Convertido</SelectItem>
            <SelectItem value="lost">Perdido</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="rounded-lg border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Empresa</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Estágio</TableHead>
              <TableHead>Data</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((lead) => (
              <TableRow
                key={lead.id}
                className="cursor-pointer hover:bg-gray-50"
                onClick={() => setSelectedLead(lead)}
              >
                <TableCell className="font-medium">{lead.name}</TableCell>
                <TableCell>{lead.company?.name}</TableCell>
                <TableCell>{lead.role}</TableCell>
                <TableCell>
                  {lead.score && <Badge variant="secondary">{lead.score}</Badge>}
                </TableCell>
                <TableCell>{stageLabels[lead.stage]}</TableCell>
                <TableCell className="text-gray-500">
                  {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-gray-400 py-8">
                  Nenhum lead encontrado
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {selectedLead && (
        <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </div>
  );
}
```

**Step 2: Create lead detail modal**

`src/components/lead-detail-modal.tsx`:
```typescript
"use client";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Lead } from "@/lib/types/database";

interface LeadDetailModalProps {
  lead: Lead;
  onClose: () => void;
}

export function LeadDetailModal({ lead, onClose }: LeadDetailModalProps) {
  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {lead.name}
            {lead.score && <Badge>{lead.score}</Badge>}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-500">{lead.role} — {lead.company?.name}</p>
            {lead.linkedin_url && (
              <a
                href={lead.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline"
              >
                Ver LinkedIn
              </a>
            )}
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2">Validação</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span>Foto: {lead.validation?.photo ? "✅" : "❌"}</span>
              <span>Conexões: {lead.connections ?? "—"}</span>
              <span>Cargo: {lead.validation?.role_match ? "✅" : "❌"}</span>
              <span>Atividade: {lead.validation?.activity ? "✅" : "❌"}</span>
            </div>
          </div>
          {lead.message && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2">Mensagem LinkedIn</h4>
                <p className="text-sm bg-gray-50 rounded p-3">{lead.message}</p>
              </div>
            </>
          )}
          {lead.bant && Object.keys(lead.bant).length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2">BANT</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span>Budget: {lead.bant.budget ?? "—"}</span>
                  <span>Authority: {lead.bant.authority ?? "—"}</span>
                  <span>Need: {lead.bant.need ?? "—"}</span>
                  <span>Timing: {lead.bant.timing ?? "—"}</span>
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 3: Update dashboard to include table**

Modify `src/app/(app)/dashboard/page.tsx` to also fetch segments and render `<ContactsTable />` below the kanban.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add contacts table with filters and lead detail modal"
```

---

## Task 8: Settings — Segments CRUD & LinkedIn Credentials

**Files:**
- Create: `src/app/(app)/settings/page.tsx`
- Create: `src/app/(app)/settings/actions.ts`
- Create: `src/lib/encryption.ts`

**Step 1: Create encryption utility**

`src/lib/encryption.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const secret = process.env.LINKEDIN_ENCRYPTION_KEY;
  if (!secret) throw new Error("LINKEDIN_ENCRYPTION_KEY not set");
  return scryptSync(secret, "salt", 32);
}

export function encrypt(text: string): string {
  const iv = randomBytes(16);
  const key = getKey();
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(data: string): string {
  const [ivHex, tagHex, encryptedHex] = data.split(":");
  const key = getKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
```

**Step 2: Create server actions for settings**

`src/app/(app)/settings/actions.ts`:
```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { createSegmentSchema, linkedinCredentialsSchema } from "@/lib/validations/schemas";
import { revalidatePath } from "next/cache";

export async function createSegment(formData: FormData) {
  const parsed = createSegmentSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description"),
    target_roles: (formData.get("target_roles") as string).split(",").map((s) => s.trim()),
    search_terms: (formData.get("search_terms") as string).split(",").map((s) => s.trim()),
  });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase.from("segments").insert({
    ...parsed.data,
    user_id: user.id,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function deleteSegment(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("segments").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function saveLinkedInCredentials(formData: FormData) {
  const parsed = linkedinCredentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase.from("linkedin_credentials").upsert({
    user_id: user.id,
    encrypted_email: encrypt(parsed.data.email),
    encrypted_password: encrypt(parsed.data.password),
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
```

**Step 3: Create settings page**

`src/app/(app)/settings/page.tsx` — form for segments CRUD + LinkedIn credentials form. Both use server actions.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add settings page with segments CRUD and encrypted LinkedIn credentials"
```

---

## Task 9: LangGraph Agent — Core Pipeline

**Files:**
- Create: `src/lib/agent/graph.ts`
- Create: `src/lib/agent/nodes/search-company.ts`
- Create: `src/lib/agent/nodes/find-decision-maker.ts`
- Create: `src/lib/agent/nodes/validate-profile.ts`
- Create: `src/lib/agent/nodes/create-lead.ts`
- Create: `src/lib/agent/state.ts`

**Step 1: Define agent state**

`src/lib/agent/state.ts`:
```typescript
import { Annotation } from "@langchain/langgraph";

export const AgentState = Annotation.Root({
  segmentId: Annotation<string>(),
  region: Annotation<string>(),
  quantity: Annotation<number>(),
  targetRoles: Annotation<string[]>(),
  searchTerms: Annotation<string[]>(),
  runId: Annotation<string>(),
  userId: Annotation<string>(),
  currentCompany: Annotation<Record<string, unknown> | null>(),
  currentDecisionMaker: Annotation<Record<string, unknown> | null>(),
  currentValidation: Annotation<Record<string, boolean> | null>(),
  leadsCreated: Annotation<number>({ reducer: (a, b) => b, default: () => 0 }),
  retries: Annotation<number>({ reducer: (a, b) => b, default: () => 0 }),
  companiesSearched: Annotation<string[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  log: Annotation<Array<{ step: string; message: string; timestamp: string }>>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
```

**Step 2: Create search-company node**

`src/lib/agent/nodes/search-company.ts`:
```typescript
import type { AgentStateType } from "../state";

export async function searchCompany(state: AgentStateType): Promise<Partial<AgentStateType>> {
  const query = `${state.searchTerms.join(" ")} ${state.region} empresas`;

  const response = await fetch(
    `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&api_key=${process.env.SERPAPI_API_KEY}&gl=br&hl=pt`
  );
  const data = await response.json();

  const results = data.organic_results ?? [];
  const company = results.find(
    (r: Record<string, string>) => !state.companiesSearched.includes(r.title)
  );

  if (!company) {
    return {
      currentCompany: null,
      log: [{ step: "search_company", message: "No new companies found", timestamp: new Date().toISOString() }],
    };
  }

  return {
    currentCompany: { name: company.title, website: company.link, snippet: company.snippet },
    companiesSearched: [company.title],
    log: [{ step: "search_company", message: `Found: ${company.title}`, timestamp: new Date().toISOString() }],
  };
}
```

**Step 3: Create find-decision-maker node**

`src/lib/agent/nodes/find-decision-maker.ts` — Google Dork via SerpAPI: `site:linkedin.com/in "[company]" + roles`. Parses LinkedIn URL from results.

**Step 4: Create validate-profile node**

`src/lib/agent/nodes/validate-profile.ts` — Calls LinkedIn MCP server to fetch profile data. Returns validation object `{photo, connections, role_match, activity}`.

**Step 5: Create create-lead node**

`src/lib/agent/nodes/create-lead.ts` — Uses Claude to generate LinkedIn message + BANT score. Saves company + lead to Supabase.

**Step 6: Assemble the graph**

`src/lib/agent/graph.ts`:
```typescript
import { StateGraph, END } from "@langchain/langgraph";
import { AgentState } from "./state";
import { searchCompany } from "./nodes/search-company";
import { findDecisionMaker } from "./nodes/find-decision-maker";
import { validateProfile } from "./nodes/validate-profile";
import { createLead } from "./nodes/create-lead";

function shouldRetry(state: typeof AgentState.State): "search_company" | typeof END {
  if (state.retries >= 3) return END;
  return "search_company";
}

function isValid(state: typeof AgentState.State): "create_lead" | "search_company" {
  if (state.currentValidation?.photo && state.currentValidation?.activity) {
    return "create_lead";
  }
  return "search_company";
}

function shouldContinue(state: typeof AgentState.State): "search_company" | typeof END {
  if (state.leadsCreated >= state.quantity) return END;
  return "search_company";
}

export function buildProspectingGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("search_company", searchCompany)
    .addNode("find_decision_maker", findDecisionMaker)
    .addNode("validate_profile", validateProfile)
    .addNode("create_lead", createLead)
    .addEdge("__start__", "search_company")
    .addEdge("search_company", "find_decision_maker")
    .addEdge("find_decision_maker", "validate_profile")
    .addConditionalEdges("validate_profile", isValid)
    .addConditionalEdges("create_lead", shouldContinue);

  return graph.compile();
}
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: add LangGraph agent pipeline with 4-step prospecting flow"
```

---

## Task 10: Prospect Page — UI & SSE Streaming

**Files:**
- Create: `src/app/(app)/prospect/page.tsx`
- Create: `src/app/api/prospect/route.ts`
- Create: `src/components/prospect-form.tsx`
- Create: `src/components/agent-feed.tsx`

**Step 1: Create API route with SSE**

`src/app/api/prospect/route.ts`:
```typescript
import { createClient } from "@/lib/supabase/server";
import { prospectRequestSchema } from "@/lib/validations/schemas";
import { buildProspectingGraph } from "@/lib/agent/graph";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const parsed = prospectRequestSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  const { data: segment } = await supabase
    .from("segments")
    .select("*")
    .eq("id", parsed.data.segment_id)
    .single();
  if (!segment) return new Response("Segment not found", { status: 404 });

  // Create agent run
  const { data: run } = await supabase.from("agent_runs").insert({
    user_id: user.id,
    segment_id: parsed.data.segment_id,
    region: parsed.data.region,
    quantity: parsed.data.quantity,
    status: "running",
  }).select().single();

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const graph = buildProspectingGraph();

      const eventStream = await graph.stream({
        segmentId: parsed.data.segment_id,
        region: parsed.data.region,
        quantity: parsed.data.quantity,
        targetRoles: segment.target_roles,
        searchTerms: segment.search_terms,
        runId: run!.id,
        userId: user.id,
      });

      for await (const event of eventStream) {
        const data = JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      }

      // Mark run completed
      await supabase.from("agent_runs").update({
        status: "completed",
        finished_at: new Date().toISOString(),
      }).eq("id", run!.id);

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

**Step 2: Create prospect form component**

`src/components/prospect-form.tsx` — Dropdown for segment, text input for region, number input for quantity, submit button.

**Step 3: Create agent feed component**

`src/components/agent-feed.tsx` — Reads SSE stream, renders log entries in real-time with status indicators.

**Step 4: Create prospect page**

`src/app/(app)/prospect/page.tsx` — Composes form + feed. Fetches segments from Supabase for the dropdown.

**Step 5: Commit**

```bash
git add -A
git commit -m "feat: add prospect page with SSE streaming agent progress"
```

---

## Task 11: Runs Page

**Files:**
- Create: `src/app/(app)/runs/page.tsx`
- Create: `src/components/run-list.tsx`
- Create: `src/components/run-detail.tsx`

**Step 1: Create runs page**

Fetches `agent_runs` with segment name, displays list with status badges (running/completed/failed), progress (3/5 leads), timestamps. Click expands log detail.

**Step 2: Commit**

```bash
git add -A
git commit -m "feat: add runs page with agent execution history and log viewer"
```

---

## Task 12: Security Hardening

**Files:**
- Create: `src/lib/security/headers.ts`
- Create: `src/lib/security/rate-limit.ts`
- Modify: `next.config.ts`
- Modify: `src/middleware.ts`

**Step 1: Add security headers to next.config.ts**

```typescript
const securityHeaders = [
  { key: "X-DNS-Prefetch-Control", value: "on" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https://*.supabase.co",
  },
];
```

**Step 2: Add rate limiting to API routes**

Simple in-memory rate limiter for `/api/prospect` — max 5 requests per minute per user.

**Step 3: Commit**

```bash
git add -A
git commit -m "feat: add security headers, CSP, and API rate limiting"
```

---

## Task 13: Final Integration & Testing

**Files:**
- Modify: various files for integration fixes
- Create: `src/app/(app)/page.tsx` (redirect to dashboard)

**Step 1: Add root redirect**

`src/app/(app)/page.tsx` → redirect to `/dashboard`.

**Step 2: Manual E2E test**

1. Login with Supabase user
2. Create a segment in Settings
3. Save LinkedIn credentials in Settings
4. Run prospect with segment + region + quantity
5. Verify leads appear in Dashboard kanban and table
6. Drag lead between stages
7. Check run appears in Runs page

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete MVP integration and final adjustments"
```

---

## Dependency Summary

```json
{
  "dependencies": {
    "next": "^14",
    "@supabase/supabase-js": "^2",
    "@supabase/ssr": "^0",
    "@langchain/core": "^0.3",
    "@langchain/anthropic": "^0.3",
    "@langchain/langgraph": "^0.2",
    "zod": "^3",
    "lucide-react": "^0.4",
    "@dnd-kit/core": "^6",
    "@dnd-kit/sortable": "^8",
    "@dnd-kit/utilities": "^5"
  }
}
```
