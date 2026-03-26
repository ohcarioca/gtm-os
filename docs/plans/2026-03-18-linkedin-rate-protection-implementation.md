# LinkedIn Rate Protection — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce LinkedIn account blocking risk by reusing MCP connections per run and enforcing a daily scrape limit (50/day) with a visible alert on the prospect page.

**Architecture:** Two changes: (1) Refactor `linkedin-mcp.ts` to support a shared client that stays open across multiple calls within a run, passed via agent state. (2) Add a daily LinkedIn scrape counter (in-memory, server-side) that blocks further scrapes after 50/day and returns a warning via the `/api/prospect` response + UI alert banner.

**Tech Stack:** MCP SDK (StreamableHTTPClientTransport), Next.js API routes, React state

---

### Task 1: Refactor `linkedin-mcp.ts` — support shared MCP client

**Files:**
- Modify: `src/lib/linkedin-mcp.ts`

**Step 1: Add shared client management**

Add a module-level singleton for the MCP client that can be reused across calls. The client connects lazily on first use and stays open until explicitly closed.

At the top of the file (after imports, before `AUTH_ERROR_MARKERS`), add:

```typescript
let sharedClient: Client | null = null;
let sharedTransport: StreamableHTTPClientTransport | null = null;

async function getSharedClient(): Promise<Client> {
  const mcpUrl = process.env.LINKEDIN_MCP_URL;
  if (!mcpUrl) throw new Error("LINKEDIN_MCP_URL not set");

  if (sharedClient) {
    return sharedClient;
  }

  sharedTransport = new StreamableHTTPClientTransport(new URL(mcpUrl));
  sharedClient = new Client({ name: "gtm-agent", version: "1.0.0" });
  await sharedClient.connect(sharedTransport);
  return sharedClient;
}

export async function closeSharedClient(): Promise<void> {
  if (sharedClient) {
    try {
      await sharedClient.close();
    } catch { /* ignore */ }
    sharedClient = null;
    sharedTransport = null;
  }
}
```

**Step 2: Refactor `getLinkedInProfile` to use shared client**

Replace the client creation/close logic inside `getLinkedInProfile`. Instead of:
```typescript
let client: Client | null = null;
// ...
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl));
client = new Client({ name: "gtm-agent", version: "1.0.0" });
await client.connect(transport);
```

Use:
```typescript
const client = await getSharedClient();
```

And remove the `finally` block that closes the client. The auth-error retry path should reset the shared client before retrying:

```typescript
if (isAuthError(rawText) && userId) {
  console.warn("[LinkedIn MCP] Auth failure detected, attempting auto-login...");
  await closeSharedClient(); // Reset shared client
  // ... rest of auto-login logic
}
```

**Step 3: Commit**

```bash
git add src/lib/linkedin-mcp.ts
git commit -m "refactor: reuse shared MCP client across LinkedIn calls"
```

---

### Task 2: Close shared client at end of agent run

**Files:**
- Modify: `src/app/api/prospect/route.ts`

**Step 1: Import `closeSharedClient`**

Add at the top:
```typescript
import { closeSharedClient } from "@/lib/linkedin-mcp";
```

**Step 2: Close client in the `finally` block**

In the SSE stream's `finally` block (line 117-121), add `closeSharedClient()` before closing the controller:

```typescript
} finally {
  await closeSharedClient();
  try { controller.close(); } catch { /* already closed */ }
}
```

**Step 3: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "feat: close shared LinkedIn MCP client at end of agent run"
```

---

### Task 3: Create daily LinkedIn scrape counter

**Files:**
- Create: `src/lib/security/linkedin-daily-limit.ts`

**Step 1: Write the counter module**

```typescript
const DAILY_LIMIT = 50;

interface DailyCounter {
  count: number;
  date: string; // YYYY-MM-DD
}

const counters = new Map<string, DailyCounter>();

function today(): string {
  return new Date().toISOString().split("T")[0];
}

export function checkLinkedInDailyLimit(userId: string): {
  allowed: boolean;
  used: number;
  limit: number;
} {
  const d = today();
  const entry = counters.get(userId);

  if (!entry || entry.date !== d) {
    return { allowed: true, used: 0, limit: DAILY_LIMIT };
  }

  return {
    allowed: entry.count < DAILY_LIMIT,
    used: entry.count,
    limit: DAILY_LIMIT,
  };
}

export function incrementLinkedInDailyCount(userId: string): void {
  const d = today();
  const entry = counters.get(userId);

  if (!entry || entry.date !== d) {
    counters.set(userId, { count: 1, date: d });
  } else {
    entry.count++;
  }
}

export function getLinkedInDailyUsage(userId: string): {
  used: number;
  limit: number;
} {
  const d = today();
  const entry = counters.get(userId);
  if (!entry || entry.date !== d) {
    return { used: 0, limit: DAILY_LIMIT };
  }
  return { used: entry.count, limit: DAILY_LIMIT };
}
```

**Step 2: Commit**

```bash
git add src/lib/security/linkedin-daily-limit.ts
git commit -m "feat: add daily LinkedIn scrape counter (50/day limit)"
```

---

### Task 4: Enforce daily limit in `validate-profile.ts`

**Files:**
- Modify: `src/lib/agent/nodes/validate-profile.ts`

**Step 1: Import and use the daily limit**

Add import:
```typescript
import { checkLinkedInDailyLimit, incrementLinkedInDailyCount } from "@/lib/security/linkedin-daily-limit";
```

Before the delay/MCP call (after line 32, before the rate limit delay), add a daily limit check:

```typescript
  // Check daily LinkedIn scrape limit
  const dailyLimit = checkLinkedInDailyLimit(state.userId);
  if (!dailyLimit.allowed) {
    // Fall back to stub validation — daily limit reached
    const hasSnippet = !!(dm.snippet as string)?.length;
    return {
      currentValidation: { photo: true, connections: true, role_match: hasSnippet, activity: true },
      log: [{
        step: "validate_profile",
        message: `Daily LinkedIn limit reached (${dailyLimit.used}/${dailyLimit.limit}) — using fallback for ${dm.name}`,
        timestamp: new Date().toISOString(),
      }],
    };
  }
```

After the successful `getLinkedInProfile` call (after line 40, when `profile` is truthy), increment the counter:

```typescript
  if (profile) {
    incrementLinkedInDailyCount(state.userId);
    // ... rest of existing code
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/validate-profile.ts
git commit -m "feat: enforce daily LinkedIn scrape limit in validate-profile"
```

---

### Task 5: Expose daily usage via API for the prospect page

**Files:**
- Modify: `src/app/api/prospect/route.ts`

**Step 1: Add a GET handler that returns daily usage**

Add a GET export to the same route file:

```typescript
export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { getLinkedInDailyUsage } = await import("@/lib/security/linkedin-daily-limit");
  const usage = getLinkedInDailyUsage(user.id);

  return Response.json(usage);
}
```

**Step 2: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "feat: expose LinkedIn daily usage via GET /api/prospect"
```

---

### Task 6: Show daily limit alert on prospect page

**Files:**
- Modify: `src/app/(app)/prospect/client.tsx`

**Step 1: Fetch and display daily usage**

Add state and effect to fetch usage on mount:

```typescript
import { useState, useCallback, useEffect } from "react";
```

Add inside the component, after the existing state:

```typescript
const [dailyUsage, setDailyUsage] = useState<{ used: number; limit: number } | null>(null);

useEffect(() => {
  fetch("/api/prospect")
    .then((r) => r.ok ? r.json() : null)
    .then(setDailyUsage)
    .catch(() => null);
}, []);
```

Add alert banner in the JSX, before the grid (after the `<h2>`):

```tsx
{dailyUsage && dailyUsage.used >= dailyUsage.limit && (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
    <strong>Limite diario do LinkedIn atingido</strong> ({dailyUsage.used}/{dailyUsage.limit} perfis).
    A prospeccao continuara usando validacao simplificada ate amanha.
  </div>
)}
{dailyUsage && dailyUsage.used >= dailyUsage.limit * 0.8 && dailyUsage.used < dailyUsage.limit && (
  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
    <strong>Atencao:</strong> {dailyUsage.used}/{dailyUsage.limit} perfis LinkedIn consultados hoje.
    Restam {dailyUsage.limit - dailyUsage.used} consultas.
  </div>
)}
```

**Step 2: Commit**

```bash
git add src/app/(app)/prospect/client.tsx
git commit -m "feat: show LinkedIn daily limit alert on prospect page"
```

---

### Task 7: Verification

**Step 1: TypeScript check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Build**

Run: `npm run build`
Expected: Successful build

**Step 4: Fix any issues, commit**
