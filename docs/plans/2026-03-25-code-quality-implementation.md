# Code Quality Improvements — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve code robustness, performance, and cleanliness through surgical, isolated changes across 4 layers.

**Architecture:** Each task is independent and isolated to one file/layer. No cross-dependencies between tasks. Each can be committed and reverted independently.

**Tech Stack:** TypeScript, Next.js, Supabase, Playwright, Zod, crypto

---

## Task 1: Batch load processed URLs in find-lead.ts

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts:12-43`

**Step 1: Replace `isAlreadyProcessed` with batch loading**

Replace the per-candidate `isAlreadyProcessed` function (lines 12-43) with a batch loader that runs once at the start of the node:

```typescript
async function loadProcessedUrls(userId: string): Promise<Set<string>> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [{ data: leads }, { data: rejected }] = await Promise.all([
    supabase.from("leads").select("linkedin_url").eq("user_id", userId),
    supabase.from("rejected_leads").select("linkedin_url").eq("user_id", userId),
  ]);

  const urls = new Set<string>();
  for (const l of leads ?? []) if (l.linkedin_url) urls.add(l.linkedin_url);
  for (const r of rejected ?? []) if (r.linkedin_url) urls.add(r.linkedin_url);
  return urls;
}
```

**Step 2: Update `findLead` to use batch Set**

At the top of `findLead()` (after line 48), add:

```typescript
const processedUrls = await loadProcessedUrls(state.userId);
```

Then replace all `await isAlreadyProcessed(url, state.userId, state.companiesSearched)` calls (lines 74, 126, 159) with:

```typescript
const isDuplicate = processedUrls.has(url) || state.companiesSearched.includes(url);
```

**Step 3: Delete the old `isAlreadyProcessed` function** (lines 12-43)

**Step 4: Verify build**

Run: `npm run build`
Expected: No type errors

**Step 5: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "perf: batch load processed URLs in find-lead to reduce DB queries"
```

---

## Task 2: Add user_id checks to mutations

**Files:**
- Modify: `src/app/(app)/contacts/actions.ts:89-101`
- Modify: `src/app/(app)/dashboard/actions.ts:7-17`

**Step 1: Fix `deleteLead` in contacts/actions.ts**

Replace line 101:
```typescript
const { error } = await supabase.from("leads").delete().eq("id", id);
```
With:
```typescript
const { data: { user } } = await supabase.auth.getUser();
if (!user) throw new Error("Unauthorized");
const { error } = await supabase.from("leads").delete().eq("id", id).eq("user_id", user.id);
```

**Step 2: Fix `updateLead` in contacts/actions.ts**

Add user_id check after line 92. Replace:
```typescript
  const { error } = await supabase
    .from("leads")
    .update(cleanUpdates)
    .eq("id", id);
```
With:
```typescript
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { error } = await supabase
    .from("leads")
    .update(cleanUpdates)
    .eq("id", id)
    .eq("user_id", user.id);
```

**Step 3: Fix `updateLeadStage` in dashboard/actions.ts**

Replace lines 11-15:
```typescript
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.id);
```
With:
```typescript
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { error } = await supabase
    .from("leads")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);
```

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/app/(app)/contacts/actions.ts src/app/(app)/dashboard/actions.ts
git commit -m "fix: add user_id checks to lead mutations for defense-in-depth"
```

---

## Task 3: Remove serviceSupabase from enrich route

**Files:**
- Modify: `src/app/api/enrich/route.ts:1-93`

**Step 1: Remove service client import and instance**

Delete lines 5-10 (the `createServiceClient` import and `serviceSupabase` const).

**Step 2: Replace `serviceSupabase` calls with authenticated `supabase`**

Replace line 55 `await serviceSupabase` with `await supabase` (company update).
Replace line 83 `await serviceSupabase` with `await supabase` (lead update).

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/app/api/enrich/route.ts
git commit -m "fix: use authenticated client instead of service role in enrich route"
```

---

## Task 4: Add try-catch to JSON.parse in save-company.ts

**Files:**
- Modify: `src/lib/agent/company-discovery/nodes/save-company.ts:42`

**Step 1: Wrap JSON.parse**

The existing code at line 42 is inside a try-catch (lines 41-109), so `JSON.parse` failures are already caught. However, the error message is generic. Add a more specific check:

Replace line 42:
```typescript
    const analysis: CompanyAnalysis = JSON.parse(state.currentMarkdown);
```
With:
```typescript
    let analysis: CompanyAnalysis;
    try {
      analysis = JSON.parse(state.currentMarkdown);
    } catch {
      return {
        currentUrl: null,
        currentMarkdown: null,
        errorRetries: state.errorRetries + 1,
        log: [{ ...log, message: `JSON inválido da análise de ${extractDomain(state.currentUrl)} — pulando` }],
      };
    }
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/agent/company-discovery/nodes/save-company.ts
git commit -m "fix: handle malformed JSON in save-company with specific error message"
```

---

## Task 5: Add timeout to Firecrawl fetch in scrape-company.ts

**Files:**
- Modify: `src/lib/agent/company-discovery/nodes/scrape-company.ts:30`

**Step 1: Add AbortSignal timeout**

Replace line 30:
```typescript
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
```
With:
```typescript
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      signal: AbortSignal.timeout(30_000),
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/agent/company-discovery/nodes/scrape-company.ts
git commit -m "fix: add 30s timeout to Firecrawl fetch to prevent hanging"
```

---

## Task 6: Sanitize Claude CLI error messages

**Files:**
- Modify: `src/lib/claude-cli.ts:116`

**Step 1: Sanitize error output**

Replace line 116:
```typescript
        reject(new Error(`Claude CLI exited with code ${code}: ${errInfo.slice(0, 500)}`));
```
With:
```typescript
        console.error(`[claude-cli] Exit code ${code}: ${errInfo.slice(0, 500)}`);
        reject(new Error(`Claude CLI exited with code ${code}`));
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/claude-cli.ts
git commit -m "fix: sanitize Claude CLI error messages to prevent leaking stderr"
```

---

## Task 7: Add exponential backoff to CLI retries

**Files:**
- Modify: `src/lib/claude-cli.ts:38`

**Step 1: Replace linear delay with exponential backoff + jitter**

Replace line 38:
```typescript
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
```
With:
```typescript
      const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1) + Math.random() * 1000;
      await new Promise((r) => setTimeout(r, delay));
```

This gives: ~3s, ~7s (6+jitter) instead of 3s, 6s.

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/claude-cli.ts
git commit -m "fix: use exponential backoff with jitter for CLI retries"
```

---

## Task 8: Add company name dedup in save-company.ts

**Files:**
- Modify: `src/lib/agent/company-discovery/nodes/save-company.ts:49-56`

**Step 1: Add name-based dedup check after domain check**

After the existing domain dedup check (line 56), add a name-based check:

```typescript
    // Also check by normalized name
    if (!existing) {
      const { data: nameMatch } = await supabase
        .from("prospect_companies")
        .select("id")
        .eq("user_id", state.userId)
        .ilike("name", analysis.name.trim())
        .limit(1)
        .single();

      if (nameMatch) {
        return {
          currentUrl: null,
          currentMarkdown: null,
          log: [{ ...log, message: `${analysis.name} já existe (por nome) — pulando` }],
        };
      }
    }
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/agent/company-discovery/nodes/save-company.ts
git commit -m "fix: dedup companies by name in addition to domain"
```

---

## Task 9: Add random salt to encryption

**Files:**
- Modify: `src/lib/encryption.ts:1-31`

**Step 1: Update encryption to use random salt**

Replace the entire file:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

const ALGORITHM = "aes-256-gcm";

function deriveKey(secret: string, salt: Buffer): Buffer {
  return scryptSync(secret, salt, 32);
}

function getSecret(): string {
  const secret = process.env.LINKEDIN_ENCRYPTION_KEY;
  if (!secret) throw new Error("LINKEDIN_ENCRYPTION_KEY not set");
  return secret;
}

export function encrypt(text: string): string {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const key = deriveKey(getSecret(), salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${salt.toString("hex")}:${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decrypt(data: string): string {
  const parts = data.split(":");
  const secret = getSecret();

  if (parts.length === 3) {
    // Legacy format: iv:tag:encrypted (fixed salt)
    const [ivHex, tagHex, encryptedHex] = parts;
    const key = scryptSync(secret, "salt", 32);
    const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  }

  // New format: salt:iv:tag:encrypted (random salt)
  const [saltHex, ivHex, tagHex, encryptedHex] = parts;
  const key = deriveKey(secret, Buffer.from(saltHex, "hex"));
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/encryption.ts
git commit -m "fix: use random salt per credential in encryption, keep legacy compat"
```

---

## Task 10: Add timeout to Google Search fetch

**Files:**
- Modify: `src/lib/google-search.ts:42`

**Step 1: Add AbortSignal timeout**

Replace line 42:
```typescript
  const response = await fetch("https://google.serper.dev/search", {
```
With:
```typescript
  const response = await fetch("https://google.serper.dev/search", {
    signal: AbortSignal.timeout(15_000),
```

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/google-search.ts
git commit -m "fix: add 15s timeout to Google Search fetch"
```

---

## Task 11: Add auth wall retry in LinkedIn

**Files:**
- Modify: `src/lib/linkedin-playwright.ts:96-118`

**Step 1: Wrap `isAuthWall` usage with retry logic**

The `isAuthWall` function itself stays the same. Instead, create a helper that retries navigation:

Add after line 118:

```typescript
async function navigateWithAuthRetry(page: Page, url: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2000 + Math.random() * 1000);

    if (!(await isAuthWall(page))) return;

    if (attempt === 0) {
      // First auth wall detection — retry once (could be latency false positive)
      await page.waitForTimeout(3000);
      continue;
    }
  }
  throw new LinkedInAuthError();
}
```

Then replace all `page.goto(url, ...)` + `isAuthWall(page)` patterns in `getProfile` and `searchPeople` with calls to `navigateWithAuthRetry(page, url)`.

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/linkedin-playwright.ts
git commit -m "fix: retry navigation before declaring LinkedIn auth wall"
```

---

## Task 12: Extract step config to shared module

**Files:**
- Create: `src/lib/agent/step-config.ts`
- Modify: `src/components/agent-feed.tsx:23-37`
- Modify: `src/components/chat-dashboard.tsx:89-102`

**Step 1: Create shared step config**

```typescript
import {
  Search, User, CheckCircle, Target, ClipboardList,
  AlertTriangle, Globe, FileText, Building2, Zap,
} from "lucide-react";

export const stepConfig: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  search_company: { icon: Search, bg: "bg-indigo-100", text: "text-indigo-600" },
  find_decision_maker: { icon: User, bg: "bg-amber-100", text: "text-amber-600" },
  validate_profile: { icon: CheckCircle, bg: "bg-emerald-100", text: "text-emerald-600" },
  score_lead: { icon: Target, bg: "bg-cyan-100", text: "text-cyan-600" },
  create_lead: { icon: ClipboardList, bg: "bg-purple-100", text: "text-purple-600" },
  linkedin_auth_required: { icon: AlertTriangle, bg: "bg-red-100", text: "text-red-600" },
  build_queries: { icon: Search, bg: "bg-blue-100", text: "text-blue-600" },
  search_companies: { icon: Globe, bg: "bg-indigo-100", text: "text-indigo-600" },
  scrape_company: { icon: FileText, bg: "bg-orange-100", text: "text-orange-600" },
  analyze_company: { icon: Target, bg: "bg-cyan-100", text: "text-cyan-600" },
  save_company: { icon: Building2, bg: "bg-green-100", text: "text-green-600" },
  find_lead: { icon: Search, bg: "bg-indigo-100", text: "text-indigo-600" },
  google_search: { icon: Globe, bg: "bg-blue-100", text: "text-blue-600" },
  triage_snippets: { icon: Target, bg: "bg-amber-100", text: "text-amber-600" },
};

export const defaultStepConfig = { icon: Zap, bg: "bg-slate-100", text: "text-slate-600" };
```

**Step 2: Update agent-feed.tsx**

Replace lines 23-37 with:
```typescript
import { stepConfig, defaultStepConfig } from "@/lib/agent/step-config";
```

Remove the individual icon imports that are no longer needed (Search, User, CheckCircle, etc.) — keep only icons used elsewhere in the component (Square).

**Step 3: Update chat-dashboard.tsx**

Replace lines 89-102 with:
```typescript
import { stepConfig, defaultStepConfig } from "@/lib/agent/step-config";
```

Remove duplicate icon imports.

**Step 4: Verify build**

Run: `npm run build`

**Step 5: Commit**

```bash
git add src/lib/agent/step-config.ts src/components/agent-feed.tsx src/components/chat-dashboard.tsx
git commit -m "refactor: extract step config to shared module, remove duplication"
```

---

## Task 13: Add error toasts to silent catch blocks

**Files:**
- Modify: `src/components/prospect-form.tsx:76-79`

**Step 1: Add toast import and error feedback**

The prospect-form catch at line 76 silently sets empty roles. Add a toast:

```typescript
.catch((err: unknown) => {
  setDefaultRoles([]);
  setSelectedRoles(new Set());
  console.error("[prospect-form] Failed to load roles:", err);
});
```

Note: This catch is for initial data loading (default roles), not a user action. A toast here would be noisy. Keep console.error for observability. Toast should only be added to user-initiated action failures.

Review all components for user-action catches that are silent and add toasts where the user triggered the action.

**Step 2: Verify build**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/components/prospect-form.tsx
git commit -m "fix: add error logging to silent catch blocks"
```

---

## Task 14: Create env validation module

**Files:**
- Create: `src/lib/env.ts`

**Step 1: Create the validation module**

```typescript
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  // Supabase
  supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),

  // Encryption
  encryptionKey: required("LINKEDIN_ENCRYPTION_KEY"),

  // Firecrawl
  firecrawlUrl: optional("FIRECRAWL_URL", "http://localhost:3002"),
} as const;
```

Note: This file validates on first import. Files that use these env vars can import from here instead of using `process.env` directly. Migration of existing files to use `env.X` is a separate future task — this just provides the validation entry point.

**Step 2: Add import to a server entry point**

Add to `src/app/layout.tsx` or `src/middleware.ts`:
```typescript
import "@/lib/env"; // validate env vars at startup
```

**Step 3: Verify build**

Run: `npm run build`

**Step 4: Commit**

```bash
git add src/lib/env.ts src/middleware.ts
git commit -m "feat: add env var validation at startup"
```
