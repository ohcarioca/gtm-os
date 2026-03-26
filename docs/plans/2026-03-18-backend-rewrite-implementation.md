# Backend Rewrite Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace broken backend modules (LinkedIn MCP, Google Dork, Claude API, Serper enrichment) with Playwright direct, Claude CLI subprocess, and Firecrawl self-hosted — while keeping LangGraph pipeline and UI untouched.

**Architecture:** Surgical rewrite of 5 service modules + 5 pipeline nodes. New modules: `claude-cli.ts`, `linkedin-playwright.ts`, `firecrawl-enrich.ts`. Rewrite all agent nodes to use new modules. Keep graph structure, SSE contract, and frontend identical.

**Tech Stack:** Playwright (LinkedIn), Claude Code CLI (LLM), Firecrawl self-hosted (enrichment), Serper (search), LangGraph (orchestration), Supabase (DB), Next.js (frontend)

**Design doc:** `docs/plans/2026-03-18-backend-rewrite-design.md`

---

## Task 1: Install Dependencies + Supabase Migration

**Files:**
- Modify: `package.json`
- Create: `supabase/migrations/010_add_linkedin_usage.sql`

**Step 1: Install Playwright**

Run: `npm install playwright`
Then: `npx playwright install chromium`

**Step 2: Create Supabase migration for persistent rate limits**

Create `supabase/migrations/010_add_linkedin_usage.sql`:

```sql
-- Persistent LinkedIn usage tracking (replaces in-memory rate limits)
CREATE TABLE IF NOT EXISTS linkedin_usage (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  scrapes_count INTEGER NOT NULL DEFAULT 0,
  searches_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);

ALTER TABLE linkedin_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own usage" ON linkedin_usage
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own usage" ON linkedin_usage
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own usage" ON linkedin_usage
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can do everything (for agent nodes running server-side)
CREATE POLICY "Service role full access" ON linkedin_usage
  FOR ALL USING (auth.role() = 'service_role');
```

**Step 3: Run migration**

Run: `npx supabase db push` (or apply via Supabase dashboard)

**Step 4: Commit**

```bash
git add package.json package-lock.json supabase/migrations/010_add_linkedin_usage.sql
git commit -m "chore: add playwright dependency and linkedin_usage migration"
```

---

## Task 2: Create `claude-cli.ts` — Claude Code CLI Wrapper

**Files:**
- Create: `src/lib/claude-cli.ts`

**Step 1: Write the CLI wrapper**

Create `src/lib/claude-cli.ts`:

```typescript
import { spawn } from "child_process";
import { z, ZodSchema } from "zod";

const DEFAULT_TIMEOUT = 60_000; // 60s

/**
 * Call Claude Code CLI with a prompt, return raw text response.
 */
export async function callClaude(
  prompt: string,
  options?: { timeout?: number; model?: string }
): Promise<string> {
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT;
  const model = options?.model;

  return new Promise((resolve, reject) => {
    const args = ["--print"];
    if (model) {
      args.push("--model", model);
    }
    args.push(prompt);

    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Claude CLI spawn error: ${err.message}`));
    });
  });
}

/**
 * Call Claude Code CLI and parse response as JSON validated by Zod schema.
 * Retries once on parse failure.
 */
export async function callClaudeJSON<T>(
  prompt: string,
  schema: ZodSchema<T>,
  options?: { timeout?: number; model?: string }
): Promise<T> {
  const fullPrompt = `${prompt}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no code fences, no explanation.`;

  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await callClaude(fullPrompt, options);

    // Try to extract JSON from response (handle markdown fences)
    const jsonStr = extractJSON(raw);

    try {
      const parsed = JSON.parse(jsonStr);
      return schema.parse(parsed);
    } catch (err) {
      if (attempt === 1) {
        throw new Error(
          `Claude CLI JSON parse failed after 2 attempts. Raw: ${raw.slice(0, 500)}`
        );
      }
      // Retry with stricter prompt
      continue;
    }
  }

  throw new Error("Unreachable");
}

/**
 * Extract JSON from a string that might contain markdown fences.
 */
function extractJSON(text: string): string {
  // Try to find JSON in code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  // Try to find raw JSON (object or array)
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    return jsonMatch[1].trim();
  }

  return text.trim();
}
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/lib/claude-cli.ts` (or `npm run build` to check)

**Step 3: Commit**

```bash
git add src/lib/claude-cli.ts
git commit -m "feat: add Claude Code CLI wrapper for LLM calls"
```

---

## Task 3: Create `linkedin-playwright.ts` — Direct LinkedIn Scraping

**Files:**
- Create: `src/lib/linkedin-playwright.ts`

This is the largest and most critical module. It replaces `linkedin-mcp.ts` with direct Playwright control.

**Step 1: Write the LinkedIn Playwright module**

Create `src/lib/linkedin-playwright.ts`:

```typescript
import { chromium, Browser, BrowserContext, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import path from "path";
import os from "os";

// --- Types ---

export interface LinkedInProfileData {
  name: string;
  role: string;
  company: string;
  connections: number;
  about: string;
  lastActivityDate: string | null;
  isRecentlyActive: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface LinkedInSearchResult {
  name: string;
  role: string;
  company: string;
  linkedinUrl: string;
}

export class LinkedInAuthError extends Error {
  constructor(message = "LinkedIn session expired") {
    super(message);
    this.name = "LinkedInAuthError";
  }
}

// --- Browser Management ---

const USER_DATA_DIR = path.join(os.homedir(), ".gtm-agent", "linkedin-browser");
const DAILY_SCRAPE_LIMIT = 50;
const DAILY_SEARCH_LIMIT = 30;

let browserContext: BrowserContext | null = null;

/**
 * Get or launch persistent browser context.
 * Uses userDataDir so LinkedIn session survives restarts.
 */
async function getBrowserContext(): Promise<BrowserContext> {
  if (browserContext) return browserContext;

  browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: true,
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  });

  return browserContext;
}

/**
 * Close browser context. Call after pipeline run completes.
 */
export async function closeBrowser(): Promise<void> {
  if (browserContext) {
    await browserContext.close().catch(() => {});
    browserContext = null;
  }
}

// --- Auth Detection ---

async function isAuthWall(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("authwall") || url.includes("/login") || url.includes("/checkpoint")) {
    return true;
  }

  const content = await page.content();
  const markers = [
    "sign in",
    "join now",
    "authwall",
    "login-form",
    "session_redirect",
  ];
  const lower = content.toLowerCase();
  return markers.some((m) => lower.includes(m));
}

// --- Rate Limiting (DB-persisted) ---

async function checkDailyLimit(
  userId: string,
  type: "scrapes" | "searches"
): Promise<{ allowed: boolean; used: number; limit: number }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const limit = type === "scrapes" ? DAILY_SCRAPE_LIMIT : DAILY_SEARCH_LIMIT;
  const column = type === "scrapes" ? "scrapes_count" : "searches_count";
  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("linkedin_usage")
    .select(column)
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  const used = data?.[column] ?? 0;
  return { allowed: used < limit, used, limit };
}

async function incrementDailyCount(
  userId: string,
  type: "scrapes" | "searches"
): Promise<void> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toISOString().split("T")[0];
  const column = type === "scrapes" ? "scrapes_count" : "searches_count";

  // Upsert: insert or increment
  const { data: existing } = await supabase
    .from("linkedin_usage")
    .select("id, scrapes_count, searches_count")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  if (existing) {
    await supabase
      .from("linkedin_usage")
      .update({ [column]: (existing[column] ?? 0) + 1 })
      .eq("id", existing.id);
  } else {
    await supabase.from("linkedin_usage").insert({
      user_id: userId,
      date: today,
      [column]: 1,
    });
  }
}

// --- Delays ---

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- LinkedIn Search ---

/**
 * Search LinkedIn for people matching keywords.
 * Returns array of candidates with LinkedIn URLs.
 */
export async function searchPeople(
  keywords: string,
  location: string | undefined,
  userId: string
): Promise<LinkedInSearchResult[]> {
  const { allowed } = await checkDailyLimit(userId, "searches");
  if (!allowed) {
    console.log("[linkedin] Daily search limit reached");
    return [];
  }

  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  try {
    // Build LinkedIn search URL
    const params = new URLSearchParams({
      keywords,
      origin: "GLOBAL_SEARCH_HEADER",
    });
    if (location) {
      params.set("geoUrn", location);
    }
    const searchUrl = `https://www.linkedin.com/search/results/people/?${params.toString()}`;

    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await randomDelay(2000, 4000);

    // Check auth
    if (await isAuthWall(page)) {
      throw new LinkedInAuthError();
    }

    // Wait for search results
    await page.waitForSelector(".search-results-container, .reusable-search__result-container", {
      timeout: 10_000,
    }).catch(() => null);

    // Extract results from search cards
    const results = await page.evaluate(() => {
      const cards = document.querySelectorAll(".reusable-search__result-container, li.reusable-search__result-container");
      const items: Array<{ name: string; role: string; company: string; linkedinUrl: string }> = [];

      cards.forEach((card) => {
        const nameEl = card.querySelector(".entity-result__title-text a span[aria-hidden='true']");
        const subtitleEl = card.querySelector(".entity-result__primary-subtitle");
        const linkEl = card.querySelector(".entity-result__title-text a") as HTMLAnchorElement | null;

        if (!nameEl || !linkEl) return;

        const name = nameEl.textContent?.trim() ?? "";
        const subtitle = subtitleEl?.textContent?.trim() ?? "";
        const href = linkEl.href ?? "";

        // Parse role and company from subtitle (format: "Role at Company")
        const parts = subtitle.split(" at ");
        const role = parts[0]?.trim() ?? subtitle;
        const company = parts[1]?.trim() ?? "";

        // Normalize LinkedIn URL
        const urlMatch = href.match(/linkedin\.com\/in\/([^/?]+)/);
        if (!urlMatch) return;
        const linkedinUrl = `https://www.linkedin.com/in/${urlMatch[1]}`;

        if (name && linkedinUrl) {
          items.push({ name, role, company, linkedinUrl });
        }
      });

      return items;
    });

    await incrementDailyCount(userId, "searches");
    return results;
  } finally {
    await page.close();
  }
}

// --- LinkedIn Profile Scrape ---

/**
 * Scrape a LinkedIn profile page for detailed info.
 * Uses Playwright selectors for structured data extraction.
 */
export async function getProfile(
  linkedinUrl: string,
  userId: string
): Promise<LinkedInProfileData | null> {
  const { allowed } = await checkDailyLimit(userId, "scrapes");
  if (!allowed) {
    console.log("[linkedin] Daily scrape limit reached");
    return null;
  }

  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  try {
    await page.goto(linkedinUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await randomDelay(3000, 6000);

    // Check auth
    if (await isAuthWall(page)) {
      throw new LinkedInAuthError();
    }

    // Wait for profile to load
    await page.waitForSelector(".pv-top-card, .scaffold-layout__main", {
      timeout: 10_000,
    }).catch(() => null);

    // Extract profile data via selectors
    const profileData = await page.evaluate(() => {
      const getText = (selector: string) =>
        document.querySelector(selector)?.textContent?.trim() ?? "";

      const name = getText(".pv-top-card--list li:first-child, h1.text-heading-xlarge");
      const role = getText(".pv-top-card--list .text-body-medium, div.text-body-medium");
      const locationText = getText(".pv-top-card--list .text-body-small .t-normal, span.text-body-small");

      // Connections count
      const connectionsText = getText(".pv-top-card--list-bullet li:first-child span, span.t-bold");
      const connectionsMatch = connectionsText.match(/(\d+)\+?/);
      const connections = connectionsMatch ? parseInt(connectionsMatch[1]) : 0;

      // About section
      const about = getText("#about ~ .display-flex .pv-shared-text-with-see-more span[aria-hidden='true'], section.pv-about-section .pv-about__summary-text");

      // Current company from experience
      const company = getText(".pv-top-card--experience-list-item, .inline-show-more-text--is-collapsed");

      return { name, role, company, connections, about, locationText };
    });

    // Check recent activity (posts section)
    const isRecentlyActive = await checkRecentActivity(page);

    // Try to get contact info
    const contactInfo = await getContactInfo(page);

    await incrementDailyCount(userId, "scrapes");

    return {
      name: profileData.name,
      role: profileData.role,
      company: profileData.company,
      connections: profileData.connections,
      about: profileData.about,
      lastActivityDate: null, // Set by activity check
      isRecentlyActive,
      contactEmail: contactInfo.email,
      contactPhone: contactInfo.phone,
    };
  } finally {
    await page.close();
  }
}

// --- Activity Check ---

async function checkRecentActivity(page: Page): Promise<boolean> {
  try {
    // Scroll to activity section
    const activitySection = await page.$("section.pv-recent-activity-section, #content_collections");
    if (!activitySection) return false;

    await activitySection.scrollIntoViewIfNeeded();
    await randomDelay(1000, 2000);

    // Check for recent posts/activity timestamps
    const hasRecentActivity = await page.evaluate(() => {
      const timeElements = document.querySelectorAll(
        ".feed-shared-actor__sub-description time, .pv-recent-activity-section time, span.feed-shared-actor__sub-description"
      );
      const now = Date.now();
      const twoMonthsMs = 60 * 24 * 60 * 60 * 1000;

      for (const el of timeElements) {
        const text = el.textContent?.trim().toLowerCase() ?? "";
        // LinkedIn uses relative time: "2d", "1w", "3mo", etc.
        if (text.match(/^\d+[smhd]/) || text.includes("hour") || text.includes("day") || text.includes("week")) {
          return true; // Within days/weeks = recent
        }
        if (text.match(/^[12]\s*mo/) || text.includes("1 month") || text.includes("2 month")) {
          return true; // 1-2 months = still recent
        }
      }
      return false;
    });

    return hasRecentActivity;
  } catch {
    return false;
  }
}

// --- Contact Info ---

async function getContactInfo(page: Page): Promise<{ email: string | null; phone: string | null }> {
  try {
    // Click "Contact info" link
    const contactLink = await page.$("a[href*='overlay/contact-info'], #top-card-text-details-contact-info");
    if (!contactLink) return { email: null, phone: null };

    await contactLink.click();
    await randomDelay(1500, 3000);

    // Wait for modal
    await page.waitForSelector(".pv-contact-info", { timeout: 5000 }).catch(() => null);

    const info = await page.evaluate(() => {
      const emailEl = document.querySelector(
        ".pv-contact-info__contact-type.ci-email .pv-contact-info__contact-link, section.ci-email a"
      );
      const phoneEl = document.querySelector(
        ".pv-contact-info__contact-type.ci-phone .t-14, section.ci-phone span.t-14"
      );

      return {
        email: emailEl?.textContent?.trim() ?? null,
        phone: phoneEl?.textContent?.trim() ?? null,
      };
    });

    // Close modal
    await page.keyboard.press("Escape");
    await randomDelay(500, 1000);

    return info;
  } catch {
    return { email: null, phone: null };
  }
}

// --- Usage Stats (for GET /api/prospect) ---

export async function getDailyUsage(userId: string): Promise<{ scrapes: number; searches: number }> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const today = new Date().toISOString().split("T")[0];

  const { data } = await supabase
    .from("linkedin_usage")
    .select("scrapes_count, searches_count")
    .eq("user_id", userId)
    .eq("date", today)
    .single();

  return {
    scrapes: data?.scrapes_count ?? 0,
    searches: data?.searches_count ?? 0,
  };
}
```

**Step 2: Verify it compiles**

Run: `npm run build` (expect errors from unused imports in other files — that's ok at this stage)

**Step 3: Commit**

```bash
git add src/lib/linkedin-playwright.ts
git commit -m "feat: add LinkedIn Playwright module with persistent browser"
```

---

## Task 4: Create `firecrawl-enrich.ts` — Company Enrichment

**Files:**
- Create: `src/lib/firecrawl-enrich.ts`

**Step 1: Write the Firecrawl enrichment module**

Create `src/lib/firecrawl-enrich.ts`:

```typescript
import { z } from "zod";
import { callClaudeJSON } from "./claude-cli";
import { googleSearch } from "./google-search";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL ?? "http://localhost:3002";

export interface CompanyEnrichment {
  description: string | null;
  sector: string | null;
  employeeCount: string | null;
  products: string[];
  techStack: string[];
  isHiring: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  website: string;
}

const enrichmentSchema = z.object({
  description: z.string().nullable(),
  sector: z.string().nullable(),
  employeeCount: z.string().nullable(),
  products: z.array(z.string()),
  techStack: z.array(z.string()),
  isHiring: z.boolean(),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
});

/**
 * Scrape company website via self-hosted Firecrawl, then extract structured data via Claude CLI.
 */
export async function enrichCompany(
  companyName: string,
  websiteUrl: string | null,
  companyCity?: string
): Promise<CompanyEnrichment | null> {
  try {
    // Step 1: Find website if not provided
    let url = websiteUrl;
    if (!url) {
      url = await findCompanyWebsite(companyName, companyCity);
      if (!url) return null;
    }

    // Step 2: Scrape via Firecrawl
    const markdown = await scrapeWithFirecrawl(url);
    if (!markdown) return null;

    // Step 3: Extract structured data via Claude CLI
    const prompt = `Analyze this company website content and extract structured information.

Company: ${companyName}

Website content (markdown):
${markdown.slice(0, 8000)}

Extract the following (use null if not found):
- description: one-sentence company description
- sector: industry/sector (e.g. "fintech", "healthtech", "SaaS")
- employeeCount: approximate employee count or range (e.g. "50-200", "500+")
- products: list of main products/services (max 5)
- techStack: technologies mentioned (max 5)
- isHiring: true if there are job postings or "careers" section
- contactEmail: main contact email
- contactPhone: main contact phone
- address: physical address`;

    const data = await callClaudeJSON(prompt, enrichmentSchema, { timeout: 30_000 });

    return { ...data, website: url };
  } catch (err) {
    console.error("[firecrawl-enrich] Error:", err);
    return null;
  }
}

/**
 * Scrape a URL using self-hosted Firecrawl. Returns clean markdown.
 */
async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      console.error(`[firecrawl] Scrape failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.data?.markdown ?? null;
  } catch (err) {
    console.error("[firecrawl] Connection error:", err);
    return null;
  }
}

/**
 * Find company website via Serper search.
 */
async function findCompanyWebsite(
  companyName: string,
  city?: string
): Promise<string | null> {
  const query = city
    ? `"${companyName}" ${city} site oficial`
    : `"${companyName}" site oficial`;

  const results = await googleSearch(query);

  // Return first non-LinkedIn, non-social result
  for (const r of results) {
    const link = r.link.toLowerCase();
    if (
      !link.includes("linkedin.com") &&
      !link.includes("facebook.com") &&
      !link.includes("instagram.com") &&
      !link.includes("twitter.com") &&
      !link.includes("glassdoor.com")
    ) {
      return r.link;
    }
  }

  return null;
}
```

**Step 2: Verify it compiles**

Run: `npm run build`

**Step 3: Commit**

```bash
git add src/lib/firecrawl-enrich.ts
git commit -m "feat: add Firecrawl company enrichment module"
```

---

## Task 5: Update Agent State — Add Retry Separation

**Files:**
- Modify: `src/lib/agent/state.ts`

**Step 1: Add `searchRetries` and `errorRetries` to state**

In `src/lib/agent/state.ts`, replace the single `retries` field with two separate counters. Keep `retries` as a computed getter for backward compatibility with graph routing.

Replace the `retries` annotation (around line 46) with:

```typescript
  // Replace: retries: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  // With:
  searchRetries: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
  errorRetries: Annotation<number>({ reducer: (_, b) => b, default: () => 0 }),
```

**Step 2: Update `AgentStateType` usage**

Any code that references `state.retries` will need updating (done in later tasks when rewriting nodes).

**Step 3: Commit**

```bash
git add src/lib/agent/state.ts
git commit -m "refactor: split retries into searchRetries and errorRetries"
```

---

## Task 6: Update `graph.ts` — New Retry Logic + Imports

**Files:**
- Modify: `src/lib/agent/graph.ts`

**Step 1: Update routing functions and imports**

Rewrite `src/lib/agent/graph.ts`:

```typescript
import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentState, AgentStateType } from "./state";
import { findLead } from "./nodes/find-lead";
import { validateProfile } from "./nodes/validate-profile";
import { scoreLead } from "./nodes/score-lead";
import { enrichLeadNode } from "./nodes/enrich-lead";
import { createLead } from "./nodes/create-lead";

const MAX_SEARCH_RETRIES = 8;
const MAX_ERROR_RETRIES = 3;

function shouldRetryOrStop(state: AgentStateType): "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.searchRetries >= MAX_SEARCH_RETRIES) return END;
  return "find_lead";
}

function isValid(state: AgentStateType): "score_lead" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const v = state.currentValidation;
  if (v && v.photo && v.activity) return "score_lead";
  return shouldRetryOrStop(state);
}

function meetsThreshold(state: AgentStateType): "enrich_lead" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const score = state.currentScore?.total ?? 0;
  if (score >= state.minScoreThreshold) return "enrich_lead";
  return shouldRetryOrStop(state);
}

function shouldContinue(state: AgentStateType): "find_lead" | "__end__" {
  if (state.leadsCreated >= state.quantity) return END;
  return "find_lead";
}

export function buildProspectingGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("find_lead", findLead)
    .addNode("validate_profile", validateProfile)
    .addNode("score_lead", scoreLead)
    .addNode("enrich_lead", enrichLeadNode)
    .addNode("create_lead", createLead)
    .addEdge(START, "find_lead")
    .addEdge("find_lead", "validate_profile")
    .addConditionalEdges("validate_profile", isValid)
    .addConditionalEdges("score_lead", meetsThreshold)
    .addEdge("enrich_lead", "create_lead")
    .addConditionalEdges("create_lead", shouldContinue);

  return graph.compile();
}
```

**Step 2: Commit**

```bash
git add src/lib/agent/graph.ts
git commit -m "refactor: update graph with split retry logic"
```

---

## Task 7: Rewrite `find-lead.ts` — Claude CLI Dorks + Playwright Search

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts`

**Step 1: Rewrite find-lead with new modules**

Rewrite `src/lib/agent/nodes/find-lead.ts` completely:

```typescript
import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";
import { googleSearch } from "@/lib/google-search";
import { searchPeople, LinkedInAuthError } from "@/lib/linkedin-playwright";
import { createClient } from "@supabase/supabase-js";

// --- URL Helpers ---

function normalizeLinkedInUrl(url: string): string {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/);
  if (!match) return url;
  return `https://www.linkedin.com/in/${match[1].toLowerCase().replace(/\/+$/, "")}`;
}

// --- Dedup ---

async function isAlreadyProcessed(
  linkedinUrl: string,
  userId: string,
  companiesSearched: string[]
): Promise<boolean> {
  if (companiesSearched.includes(linkedinUrl)) return true;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Check leads table
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .eq("user_id", userId)
    .eq("linkedin_url", linkedinUrl)
    .limit(1)
    .single();

  if (existingLead) return true;

  // Check rejected_leads table
  const { data: rejected } = await supabase
    .from("rejected_leads")
    .select("id")
    .eq("user_id", userId)
    .eq("linkedin_url", linkedinUrl)
    .limit(1)
    .single();

  return !!rejected;
}

// --- Dork Query Builder (via Claude CLI) ---

const dorkQueriesSchema = z.object({
  queries: z.array(z.string()).min(1).max(8),
});

async function buildDorkQueries(state: AgentStateType): Promise<string[]> {
  const prompt = `You are a Google dork expert for LinkedIn prospecting.

Context:
- Target roles: ${state.targetRoles.join(", ")}
- Search terms/sector: ${state.searchTerms.join(", ")}
- Region: ${state.region}
- Company profile: ${state.companyProfile ? JSON.stringify(state.companyProfile) : "N/A"}
- Already found: ${state.companiesSearched.length} leads (avoid repetition)

Generate 5-8 Google dork queries to find LinkedIn profiles of decision-makers.

Rules:
- All queries MUST start with site:linkedin.com/in
- Use varied strategies: exact roles, role synonyms, company-targeted, broader terms
- Include Portuguese AND English role variations (e.g., "Diretor de Tecnologia" AND "CTO")
- Use city names from the region, including abbreviations (SP, RJ, etc.)
- Use OR operator for role variations in single queries
- Vary specificity: some precise, some broader for discovery

Return JSON: {"queries": ["query1", "query2", ...]}`;

  try {
    const result = await callClaudeJSON(prompt, dorkQueriesSchema, { timeout: 30_000 });
    return result.queries;
  } catch (err) {
    console.error("[find-lead] Dork query generation failed, using fallback:", err);
    // Fallback: basic dork queries
    return state.targetRoles.flatMap((role) => [
      `site:linkedin.com/in "${role}" ${state.searchTerms.join(" ")} "${state.region}"`,
      `site:linkedin.com/in "${role}" "${state.region}"`,
    ]);
  }
}

// --- Main Node ---

export async function findLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "find_lead", message: "", timestamp: new Date().toISOString() };

  try {
    // Step 1: Build dork queries via Claude CLI
    log.message = "Construindo queries de busca inteligentes...";

    const queries = await buildDorkQueries(state);

    // Step 2: Execute dork queries via Serper
    for (const query of queries) {
      const results = await googleSearch(query);

      for (const result of results) {
        const url = normalizeLinkedInUrl(result.link);
        if (!url.includes("linkedin.com/in/")) continue;

        const isDuplicate = await isAlreadyProcessed(url, state.userId, state.companiesSearched);
        if (isDuplicate) continue;

        // Extract name from title (format: "Name - Role - Company | LinkedIn")
        const name = result.title.split(/\s*[-–|]\s*/)[0]?.trim() ?? "";
        const snippet = result.snippet ?? "";

        return {
          currentCompany: {
            name: snippet.match(/(?:at|@|em)\s+([^.·\-]+)/i)?.[1]?.trim() ?? "",
            linkedinUrl: null,
            website: null,
          },
          currentDecisionMaker: {
            name,
            role: "",
            linkedinUrl: url,
            company: "",
          },
          companiesSearched: [...state.companiesSearched, url],
          log: [{ ...log, message: `Encontrado via Serper: ${name} (${url})` }],
        };
      }
    }

    // Step 3: LinkedIn Search via Playwright (if Serper didn't find new leads)
    log.message = "Buscando diretamente no LinkedIn...";

    for (const role of state.targetRoles) {
      const keywords = `${role} ${state.searchTerms.join(" ")}`;
      const candidates = await searchPeople(keywords, state.region, state.userId);

      for (const candidate of candidates) {
        const url = normalizeLinkedInUrl(candidate.linkedinUrl);
        const isDuplicate = await isAlreadyProcessed(url, state.userId, state.companiesSearched);
        if (isDuplicate) continue;

        return {
          currentCompany: {
            name: candidate.company,
            linkedinUrl: null,
            website: null,
          },
          currentDecisionMaker: {
            name: candidate.name,
            role: candidate.role,
            linkedinUrl: url,
            company: candidate.company,
          },
          companiesSearched: [...state.companiesSearched, url],
          log: [{ ...log, message: `Encontrado via LinkedIn: ${candidate.name} - ${candidate.role} (${url})` }],
        };
      }
    }

    // No results from either source
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: `Nenhum lead novo encontrado (tentativa ${state.searchRetries + 1})` }],
    };
  } catch (err) {
    if (err instanceof LinkedInAuthError) {
      return {
        errorRetries: 999,
        log: [{ ...log, message: "Sessão LinkedIn expirou. Faça login novamente." }],
      };
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }

    console.error("[find-lead] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na busca: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "feat: rewrite find-lead with Claude CLI dorks + Playwright search"
```

---

## Task 8: Rewrite `validate-profile.ts` — Playwright-based Validation

**Files:**
- Modify: `src/lib/agent/nodes/validate-profile.ts`

**Step 1: Rewrite validate-profile with Playwright**

Rewrite `src/lib/agent/nodes/validate-profile.ts`:

```typescript
import { AgentStateType } from "../state";
import { getProfile, LinkedInAuthError } from "@/lib/linkedin-playwright";

export async function validateProfile(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "validate_profile", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;

  if (!dm?.linkedinUrl) {
    return {
      currentValidation: { photo: false, connections: false, role_match: false, activity: false },
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: "Perfil sem URL do LinkedIn, pulando." }],
    };
  }

  try {
    const profile = await getProfile(dm.linkedinUrl, state.userId);

    if (!profile) {
      // LinkedIn limit reached or scrape failed — use basic validation from search data
      return {
        currentValidation: { photo: true, connections: true, role_match: true, activity: true },
        log: [{ ...log, message: "Limite LinkedIn atingido, usando dados da busca." }],
      };
    }

    // Build validation
    const roleMatchTerms = state.targetRoles.map((r) => r.toLowerCase());
    const profileRole = (profile.role || dm.role || "").toLowerCase();
    const roleMatch = roleMatchTerms.some(
      (term) => profileRole.includes(term) || term.includes(profileRole.split(" ")[0])
    );

    const validation = {
      photo: !!profile.name, // If we got a profile, it has a photo (not a ghost)
      connections: profile.connections > 50,
      role_match: roleMatch,
      activity: profile.isRecentlyActive,
    };

    // Enrich decision maker with LinkedIn data
    const enrichedDm = {
      ...dm,
      name: profile.name || dm.name,
      role: profile.role || dm.role,
      company: profile.company || dm.company,
      connections: profile.connections,
      about: profile.about,
      email: profile.contactEmail || dm.email,
      phone: profile.contactPhone || dm.phone,
      lastActivityDate: profile.lastActivityDate,
    };

    const isValid = validation.photo && validation.activity;
    log.message = isValid
      ? `Perfil validado: ${profile.name} - ${profile.role} (${profile.connections} conexões)`
      : `Perfil rejeitado: photo=${validation.photo}, activity=${validation.activity}, role=${validation.role_match}`;

    return {
      currentValidation: validation,
      currentDecisionMaker: enrichedDm,
      log: [log],
    };
  } catch (err) {
    if (err instanceof LinkedInAuthError) {
      return {
        errorRetries: 999,
        log: [{ ...log, message: "Sessão LinkedIn expirou. Faça login novamente." }],
      };
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }

    console.error("[validate-profile] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na validação: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/validate-profile.ts
git commit -m "feat: rewrite validate-profile with Playwright direct scraping"
```

---

## Task 9: Rewrite `score-lead.ts` — Claude CLI Scoring

**Files:**
- Modify: `src/lib/agent/nodes/score-lead.ts`

**Step 1: Rewrite score-lead with Claude CLI**

Rewrite `src/lib/agent/nodes/score-lead.ts`:

```typescript
import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const scoreSchema = z.object({
  total: z.number().min(0).max(100),
  dimensions: z.object({
    company_fit: z.number().min(0).max(30),
    role_fit: z.number().min(0).max(30),
    seniority: z.number().min(0).max(20),
    activity: z.number().min(0).max(20),
  }),
  justification: z.string(),
});

export async function scoreLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "score_lead", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;
  const company = state.currentCompany;
  const validation = state.currentValidation;

  if (!dm || !company) {
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: "Dados insuficientes para scoring." }],
    };
  }

  try {
    const prompt = `Score this B2B lead on a 0-100 scale.

SEGMENT CRITERIA:
- Target roles: ${state.targetRoles.join(", ")}
- Search terms: ${state.searchTerms.join(", ")}
- Company sizes: ${state.companySizeTargets.join(", ")}
- Region: ${state.region}
${state.companyProfile ? `- ICP: ${state.companyProfile.icp}\n- Sector: ${state.companyProfile.sector}\n- Value proposition: ${state.companyProfile.value_proposition}` : ""}

LEAD DATA:
- Name: ${dm.name}
- Role: ${dm.role}
- Company: ${company.name}
- Connections: ${dm.connections ?? "unknown"}
- About: ${dm.about ?? "N/A"}
- Recently active: ${validation?.activity ?? "unknown"}

SCORING DIMENSIONS:
1. company_fit (0-30): Does the company match the ICP? Sector, size, relevance.
2. role_fit (0-30): Does the role match target roles? Exact match = high, related = medium.
3. seniority (0-20): Is this person a decision-maker? Connections > 500 is a strong signal.
4. activity (0-20): Is the person active on LinkedIn? Active = higher chance of response.

Return JSON with: total (sum of dimensions), dimensions (each score), justification (1-2 sentences in Portuguese).`;

    const score = await callClaudeJSON(prompt, scoreSchema, { timeout: 30_000 });

    log.message = `Score: ${score.total}/100 — ${score.justification}`;

    return {
      currentScore: score,
      log: [log],
    };
  } catch (err) {
    console.error("[score-lead] Error:", err);
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: `Erro no scoring: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/score-lead.ts
git commit -m "feat: rewrite score-lead with Claude CLI"
```

---

## Task 10: Rewrite `enrich-lead.ts` — Firecrawl Enrichment

**Files:**
- Modify: `src/lib/agent/nodes/enrich-lead.ts`

**Step 1: Rewrite enrich-lead with Firecrawl**

Rewrite `src/lib/agent/nodes/enrich-lead.ts`:

```typescript
import { AgentStateType } from "../state";
import { enrichCompany } from "@/lib/firecrawl-enrich";

export async function enrichLeadNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "enrich_lead", message: "", timestamp: new Date().toISOString() };
  const company = state.currentCompany;
  const dm = state.currentDecisionMaker;

  if (!company || !dm) {
    return {
      log: [{ ...log, message: "Dados insuficientes para enriquecimento." }],
    };
  }

  try {
    const enrichment = await enrichCompany(
      company.name,
      company.website,
      state.region?.split(",")[0]?.trim()
    );

    if (!enrichment) {
      log.message = `Enriquecimento não disponível para ${company.name}`;
      return { log: [log] };
    }

    log.message = `Empresa enriquecida: ${company.name} — ${enrichment.sector ?? "setor desconhecido"}, ${enrichment.employeeCount ?? "tamanho desconhecido"}`;

    return {
      currentCompany: {
        ...company,
        website: enrichment.website || company.website,
        metadata: {
          ...(company.metadata ?? {}),
          enrichment: {
            description: enrichment.description,
            sector: enrichment.sector,
            employeeCount: enrichment.employeeCount,
            products: enrichment.products,
            techStack: enrichment.techStack,
            isHiring: enrichment.isHiring,
            contactEmail: enrichment.contactEmail,
            contactPhone: enrichment.contactPhone,
            address: enrichment.address,
            enrichedAt: new Date().toISOString(),
          },
        },
      },
      currentDecisionMaker: {
        ...dm,
        email: dm.email || enrichment.contactEmail,
        phone: dm.phone || enrichment.contactPhone,
      },
      log: [log],
    };
  } catch (err) {
    console.error("[enrich-lead] Error:", err);
    return {
      log: [{ ...log, message: `Erro no enriquecimento: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/enrich-lead.ts
git commit -m "feat: rewrite enrich-lead with Firecrawl self-hosted"
```

---

## Task 11: Rewrite `create-lead.ts` — Claude CLI Message Generation

**Files:**
- Modify: `src/lib/agent/nodes/create-lead.ts`

**Step 1: Rewrite create-lead with Claude CLI**

Rewrite `src/lib/agent/nodes/create-lead.ts`:

```typescript
import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaude } from "@/lib/claude-cli";
import { createClient } from "@supabase/supabase-js";

export async function createLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "create_lead", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;
  const company = state.currentCompany;
  const score = state.currentScore;

  if (!dm || !company) {
    return {
      log: [{ ...log, message: "Dados insuficientes para criar lead." }],
    };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Step 1: Generate personalized LinkedIn message via Claude CLI
    const messagePrompt = `Gere uma mensagem personalizada para LinkedIn (máximo 300 caracteres, em Português do Brasil).

Destinatário: ${dm.name}, ${dm.role} na ${company.name}
${dm.about ? `Sobre: ${dm.about}` : ""}
${state.companyProfile ? `Minha empresa: ${state.companyProfile.name} — ${state.companyProfile.value_proposition}` : ""}

A mensagem deve:
- Ser profissional mas amigável
- Mencionar algo específico sobre o destinatário ou empresa
- Ter um gancho claro de valor
- NÃO usar emojis excessivos
- Máximo 300 caracteres

Responda APENAS com o texto da mensagem, sem aspas.`;

    const message = await callClaude(messagePrompt, { timeout: 20_000 });

    // Step 2: Convert score to letter grade
    const total = score?.total ?? 0;
    const letterGrade = total >= 90 ? "A+" : total >= 80 ? "A" : total >= 70 ? "B" : "C";

    // Step 3: Save company
    const { data: companyRow } = await supabase
      .from("companies")
      .insert({
        user_id: state.userId,
        segment_id: state.segmentId,
        name: company.name,
        website: company.website,
        linkedin_url: company.linkedinUrl,
        metadata: company.metadata ?? {},
      })
      .select("id")
      .single();

    if (!companyRow) {
      throw new Error("Failed to create company");
    }

    // Step 4: Save lead
    await supabase.from("leads").insert({
      user_id: state.userId,
      company_id: companyRow.id,
      name: dm.name,
      role: dm.role,
      linkedin_url: dm.linkedinUrl,
      email: dm.email ?? null,
      phone: dm.phone ?? null,
      score: letterGrade,
      stage: "identified",
      message: message.slice(0, 300),
      connections: dm.connections ?? null,
      recent_activity: state.currentValidation?.activity ?? false,
      validation: state.currentValidation,
      metadata: {
        scoring: score,
        about: dm.about,
        lastActivityDate: dm.lastActivityDate,
      },
    });

    // Step 5: Update agent run
    await supabase
      .from("agent_runs")
      .update({
        leads_found: state.leadsCreated + 1,
        leads_approved: state.leadsCreated + 1,
      })
      .eq("id", state.runId);

    log.message = `Lead criado: ${dm.name} - ${dm.role} @ ${company.name} (${letterGrade}, ${total}pts)`;

    return {
      currentCompany: null,
      currentDecisionMaker: null,
      currentValidation: null,
      currentScore: null,
      leadsCreated: state.leadsCreated + 1,
      log: [log],
    };
  } catch (err) {
    console.error("[create-lead] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro ao criar lead: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/create-lead.ts
git commit -m "feat: rewrite create-lead with Claude CLI message generation"
```

---

## Task 12: Update `prospect/route.ts` — Replace MCP with Playwright

**Files:**
- Modify: `src/app/api/prospect/route.ts`

**Step 1: Update imports and cleanup**

In `src/app/api/prospect/route.ts`:

1. Replace `import { closeSharedClient } from "@/lib/linkedin-mcp"` with `import { closeBrowser, getDailyUsage } from "@/lib/linkedin-playwright"`
2. Replace `closeSharedClient()` calls with `closeBrowser()`
3. Update GET handler to use `getDailyUsage(userId)` instead of in-memory limits

**Step 2: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "refactor: update prospect route to use Playwright instead of MCP"
```

---

## Task 13: Remove Deprecated Files

**Files:**
- Delete: `src/lib/linkedin-mcp.ts`
- Delete: `src/lib/linkedin-login.ts`
- Delete: `src/lib/serper-enrich.ts`
- Delete: `src/lib/claude-auth.ts`
- Delete: `src/lib/security/linkedin-daily-limit.ts` (if exists)

**Step 1: Remove old modules**

```bash
git rm src/lib/linkedin-mcp.ts
git rm src/lib/linkedin-login.ts
git rm src/lib/serper-enrich.ts
git rm src/lib/claude-auth.ts
```

Also check and remove if exists:
```bash
git rm src/lib/security/linkedin-daily-limit.ts 2>/dev/null || true
```

**Step 2: Search for remaining imports**

Run: `grep -r "linkedin-mcp\|linkedin-login\|serper-enrich\|claude-auth\|linkedin-daily-limit" src/ --include="*.ts" --include="*.tsx"`

Fix any remaining imports that reference deleted files.

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated MCP, auto-login, and serper-enrich modules"
```

---

## Task 14: Remove Unused Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Remove MCP and Anthropic SDK dependencies**

```bash
npm uninstall @modelcontextprotocol/sdk @langchain/anthropic @langchain/openai
```

Note: Keep `@langchain/langgraph` and `@langchain/core` (still used for pipeline).

**Step 2: Verify build**

Run: `npm run build`

Fix any remaining import errors.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: remove unused MCP and Anthropic SDK dependencies"
```

---

## Task 15: Build Verification + Integration Test

**Step 1: Verify full build passes**

Run: `npm run build`

Fix any TypeScript errors.

**Step 2: Verify lint passes**

Run: `npm run lint`

Fix any lint errors.

**Step 3: Manual smoke test**

1. Start Firecrawl: `docker compose -f docker-compose.firecrawl.yml up -d`
2. Start dev server: `npm run dev`
3. Navigate to prospect page
4. Run a small prospecting job (quantity=1)
5. Verify SSE stream works, lead is created

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: resolve build errors from backend rewrite"
```

---

## Task 16: Update CLAUDE.md + Documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update architecture tree**

Update the `src/lib/` section to reflect new files:
- Remove: `linkedin-mcp.ts`, `linkedin-login.ts`, `serper-enrich.ts`, `claude-auth.ts`
- Add: `claude-cli.ts`, `linkedin-playwright.ts`, `firecrawl-enrich.ts`

**Step 2: Update agent pipeline section**

Update pipeline description to reflect new modules and flow.

**Step 3: Update migrations list**

Add migration 010.

**Step 4: Update key files section**

Add `2026-03-18-backend-rewrite-design.md` and this implementation plan.

**Step 5: Update infrastructure section**

Add Firecrawl Docker setup and Playwright browser requirements.

**Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for backend rewrite"
```

---

## Dependency Graph

```
Task 1 (deps + migration) ─┐
Task 2 (claude-cli.ts)     ├── Tasks 7-11 depend on these
Task 3 (linkedin-pw.ts)    │
Task 4 (firecrawl.ts)     ─┘
Task 5 (state.ts)          ─── Task 6 (graph.ts)
Task 7 (find-lead)         ─┐
Task 8 (validate-profile)   │
Task 9 (score-lead)         ├── Task 12-13 depend on these
Task 10 (enrich-lead)       │
Task 11 (create-lead)      ─┘
Task 12 (route.ts)         ─── Task 13 (remove files)
Task 13 (remove files)     ─── Task 14 (remove deps)
Task 14 (remove deps)      ─── Task 15 (build verify)
Task 15 (build verify)     ─── Task 16 (docs)
```

**Parallelizable:**
- Tasks 2, 3, 4 can run in parallel (independent modules)
- Tasks 7, 8, 9, 10, 11 can run in parallel (independent node rewrites, after Tasks 2-4)
- Tasks 5, 6 can run in parallel with Tasks 2-4
