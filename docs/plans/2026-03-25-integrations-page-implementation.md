# Integrations Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a dedicated integrations page where users manage LinkedIn connection and Serper API key (encrypted, DB-stored).

**Architecture:** New page at `/settings/integrations` with two cards. LinkedIn card opens Playwright browser for manual login and polls status. Serper card stores encrypted API key in new `api_keys` table. `google-search.ts` reads key from DB with .env fallback.

**Tech Stack:** Next.js 14 (App Router), Playwright, AES-256-GCM encryption, Supabase RLS, shadcn/ui

---

### Task 1: Database Migration — `api_keys` table

**Files:**
- Create: `supabase/migrations/017_add_api_keys.sql`

**Step 1: Create migration file**

```sql
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  service TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, service)
);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own API keys"
  ON api_keys FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Service role policy for agent nodes to read keys
CREATE POLICY "Service role full access on api_keys"
  ON api_keys FOR ALL
  USING (true)
  WITH CHECK (true);
```

**Step 2: Run migration against Supabase**

Run the SQL in the Supabase dashboard or via CLI.

**Step 3: Commit**

```bash
git add supabase/migrations/017_add_api_keys.sql
git commit -m "feat: add api_keys table for encrypted service credentials"
```

---

### Task 2: API Routes — LinkedIn open-browser and status

**Files:**
- Modify: `src/app/api/linkedin/login/route.ts` (replace with open-browser logic)
- Create: `src/app/api/linkedin/status/route.ts`

**Step 1: Replace LinkedIn login route with open-browser**

`src/app/api/linkedin/login/route.ts` — Opens a visible Playwright browser for manual login:

```typescript
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { chromium } from "playwright";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

const USER_DATA_DIR = path.join(os.homedir(), ".gtm-agent", "linkedin-browser");

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed } = checkRateLimit(user.id);
  if (!allowed) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  try {
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
      viewport: { width: 1280, height: 800 },
    });

    const page = context.pages()[0] || await context.newPage();
    await page.goto("https://www.linkedin.com/login", { waitUntil: "domcontentloaded" });

    // Browser stays open for user — don't close context
    return Response.json({ success: true, message: "Browser opened for LinkedIn login" });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to open browser";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
```

**Step 2: Create LinkedIn status route**

`src/app/api/linkedin/status/route.ts` — Checks if LinkedIn session is valid:

```typescript
import { createClient } from "@/lib/supabase/server";
import { chromium } from "playwright";
import path from "path";
import os from "os";

export const dynamic = "force-dynamic";

const USER_DATA_DIR = path.join(os.homedir(), ".gtm-agent", "linkedin-browser");

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  try {
    const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: true,
    });

    const page = await context.newPage();
    await page.goto("https://www.linkedin.com/feed", {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const url = page.url();
    const connected = !url.includes("login") && !url.includes("authwall") && !url.includes("session_redirect");

    await context.close();

    return Response.json({ connected });
  } catch {
    return Response.json({ connected: false });
  }
}
```

**Step 3: Commit**

```bash
git add src/app/api/linkedin/login/route.ts src/app/api/linkedin/status/route.ts
git commit -m "feat: LinkedIn open-browser and status check API routes"
```

---

### Task 3: Server Actions — Serper API key CRUD

**Files:**
- Create: `src/app/(app)/settings/integrations/actions.ts`

**Step 1: Create server actions for API key management**

```typescript
"use server";

import { createClient } from "@/lib/supabase/server";
import { encrypt, decrypt } from "@/lib/encryption";
import { z } from "zod";

const apiKeySchema = z.object({
  service: z.literal("serper"),
  key: z.string().min(1).max(200),
});

export async function saveApiKey(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const parsed = apiKeySchema.safeParse({
    service: formData.get("service"),
    key: formData.get("key"),
  });
  if (!parsed.success) throw new Error("Invalid input");

  const encrypted = encrypt(parsed.data.key);

  await supabase
    .from("api_keys")
    .upsert(
      {
        user_id: user.id,
        service: parsed.data.service,
        encrypted_key: encrypted,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,service" }
    );
}

export async function deleteApiKey(service: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  await supabase
    .from("api_keys")
    .delete()
    .eq("user_id", user.id)
    .eq("service", service);
}

export async function getApiKeyStatus(service: string): Promise<{ configured: boolean; lastChars: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data } = await supabase
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", user.id)
    .eq("service", service)
    .single();

  if (!data) return { configured: false, lastChars: "" };

  const decrypted = decrypt(data.encrypted_key);
  const lastChars = decrypted.slice(-4);
  return { configured: true, lastChars };
}
```

**Step 2: Commit**

```bash
git add src/app/(app)/settings/integrations/actions.ts
git commit -m "feat: server actions for encrypted API key management"
```

---

### Task 4: `google-search.ts` — Read Serper key from DB with .env fallback

**Files:**
- Modify: `src/lib/google-search.ts`

**Step 1: Add `getSerperKey` helper and update `googleSearch` signature**

```typescript
import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";

interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
}

async function getSerperKey(userId: string): Promise<string> {
  // Try DB first
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabase
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("service", "serper")
    .single();

  if (data) {
    return decrypt(data.encrypted_key);
  }

  // Fallback to .env
  const envKey = process.env.SERPER_API_KEY;
  if (envKey) return envKey;

  throw new Error("SERPER_API_KEY not configured. Add it in Settings > Integrations.");
}

export async function googleSearch(query: string, userId?: string): Promise<GoogleSearchResult[]> {
  const apiKey = userId ? await getSerperKey(userId) : process.env.SERPER_API_KEY;

  if (!apiKey) {
    throw new Error("SERPER_API_KEY must be set");
  }

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: "br",
      hl: "pt",
      num: 10,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Serper API error: ${data.message ?? response.statusText}`);
  }

  return (data.organic ?? []).map((item: Record<string, string>) => ({
    title: item.title ?? "",
    link: item.link ?? "",
    snippet: item.snippet ?? "",
  }));
}
```

**Step 2: Update all callers to pass `userId`**

These files call `googleSearch()` and have access to `userId` via agent state:

- `src/lib/agent/nodes/find-lead.ts` — has `state.userId`
  - Change: `googleSearch(dorkQuery)` → `googleSearch(dorkQuery, state.userId)`
- `src/lib/agent/nodes/find-decision-maker.ts` — has `state.userId`
  - Change: `googleSearch(query)` → `googleSearch(query, state.userId)`
- `src/lib/agent/company-discovery/nodes/search-companies.ts` — has `state.userId`
  - Change: `googleSearch(query)` → `googleSearch(query, state.userId)`
- `src/lib/firecrawl-enrich.ts` — does NOT have userId readily available
  - Add optional `userId` parameter to `enrichCompany()`, pass through to `googleSearch()`
  - Callers of `enrichCompany` in agent nodes have state.userId — pass it through
- `src/lib/agent/nodes/search-company.ts` — has access to state
  - Change: `googleSearch(query)` → `googleSearch(query, state.userId)`

**Step 3: Commit**

```bash
git add src/lib/google-search.ts src/lib/agent/nodes/find-lead.ts src/lib/agent/nodes/find-decision-maker.ts src/lib/agent/company-discovery/nodes/search-companies.ts src/lib/firecrawl-enrich.ts src/lib/agent/nodes/search-company.ts
git commit -m "feat: read Serper key from DB with .env fallback"
```

---

### Task 5: Integrations Page — UI

**Files:**
- Create: `src/app/(app)/settings/integrations/page.tsx`

**Step 1: Create the integrations page**

Server component that fetches initial status, renders two cards. LinkedIn card is a client component for polling. Serper card uses server actions.

The page should have:

**LinkedIn Card:**
- Green/red status badge (connected/disconnected)
- "Conectar LinkedIn" button → calls `POST /api/linkedin/login`
- After clicking, polls `GET /api/linkedin/status` every 3 seconds
- When connected detected, stops polling and shows green status
- If already connected, button says "Reconectar"

**Serper Card:**
- Status badge (configured/not configured)
- If configured: shows `••••••{last4}` with "Remover" button
- If not configured: text input + "Salvar" button
- Uses server actions `saveApiKey` / `deleteApiKey`

Use shadcn/ui `Card`, `Button`, `Input`, `Badge` components. Follow existing design patterns from settings page.

**Step 2: Commit**

```bash
git add src/app/(app)/settings/integrations/page.tsx
git commit -m "feat: integrations page with LinkedIn and Serper cards"
```

---

### Task 6: Sidebar Navigation — Add Integrations link

**Files:**
- Modify: `src/components/sidebar.tsx`

**Step 1: Add Plug icon import and navigation item**

Add `Plug` to the lucide-react import. Add navigation item after "Perfil ICP":

```typescript
const navigation = [
  { name: "Nova Busca", href: "/dashboard", icon: Plus },
  { name: "Perfil ICP", href: "/settings", icon: UserCog },
  { name: "Integracoes", href: "/settings/integrations", icon: Plug },
  { name: "Empresas", href: "/companies", icon: Building2 },
  { name: "Leads", href: "/contacts", icon: Users },
  { name: "Pipeline", href: "/pipeline", icon: Kanban },
];
```

**Step 2: Commit**

```bash
git add src/components/sidebar.tsx
git commit -m "feat: add Integrations link to sidebar navigation"
```

---

### Task 7: Build Verification and Final Commit

**Step 1: Run build**

```bash
npm run build
```

Expected: Build succeeds with no errors.

**Step 2: Fix any type errors or build issues**

**Step 3: Final commit and push**

```bash
git push
```
