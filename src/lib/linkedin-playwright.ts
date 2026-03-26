import { chromium, BrowserContext, Page } from "playwright";
import { createClient } from "@supabase/supabase-js";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";
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
  currentExperience: string | null;
  experienceMatchesICP: boolean;
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

export class LinkedInLimitError extends Error {
  constructor(type: "searches" | "scrapes", used: number, limit: number) {
    super(`Limite diário LinkedIn atingido: ${used}/${limit} ${type === "searches" ? "buscas" : "perfis"}`);
    this.name = "LinkedInLimitError";
  }
}

// --- Browser Management ---

const USER_DATA_DIR = path.join(os.homedir(), ".gtm-agent", "linkedin-browser");
const DAILY_SCRAPE_LIMIT = 100;
const DAILY_SEARCH_LIMIT = 100;

let browserContext: BrowserContext | null = null;

async function getBrowserContext(): Promise<BrowserContext> {
  if (browserContext) {
    // Verify existing context is still alive
    try {
      browserContext.pages();
      return browserContext;
    } catch {
      // Context died — reset and re-launch
      browserContext = null;
    }
  }

  try {
    browserContext = await chromium.launchPersistentContext(USER_DATA_DIR, {
      headless: false,
      viewport: { width: 1280, height: 800 },
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
  } catch (err) {
    browserContext = null;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("has been closed") || msg.includes("exitCode=21")) {
      throw new Error(
        `LinkedIn browser failed — another Chromium is using ${USER_DATA_DIR}. ` +
        `Close it first (check npx playwright open or another browser instance).`
      );
    }
    throw err;
  }

  return browserContext;
}

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

  // Content check: require strong auth wall signals, not generic strings.
  // "sign in" / "join now" appear on normal logged-in pages (footer, banners, noscript).
  // A real auth wall has session_redirect or login-form, or both "sign in" AND "join now" together.
  const content = await page.content();
  const lower = content.toLowerCase();

  if (lower.includes("session_redirect") || lower.includes("login-form")) {
    return true;
  }

  // Both "sign in" and "join now" together = auth wall (single one alone is a false positive)
  if (lower.includes("sign in") && lower.includes("join now") && lower.includes("authwall")) {
    return true;
  }

  return false;
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

  const record = data as Record<string, number> | null;
  const used = record?.[column] ?? 0;
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

export async function searchPeople(
  keywords: string,
  location: string | undefined,
  userId: string
): Promise<LinkedInSearchResult[]> {
  const { allowed, used, limit } = await checkDailyLimit(userId, "searches");
  if (!allowed) {
    throw new LinkedInLimitError("searches", used, limit);
  }

  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  try {
    const BRAZIL_GEO_URN = '["106057199"]';
    const params = new URLSearchParams({
      keywords,
      origin: "GLOBAL_SEARCH_HEADER",
      geoUrn: location || BRAZIL_GEO_URN,
    });
    const searchUrl = `https://www.linkedin.com/search/results/people/?${params.toString()}`;

    try {
      await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : "";
      if (msg.includes("ERR_ABORTED")) {
        await randomDelay(2000, 4000);
        await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else {
        throw navErr;
      }
    }
    await randomDelay(2000, 4000);

    if (await isAuthWall(page)) {
      // Retry once — latency can cause false positive
      await new Promise((r) => setTimeout(r, 3000));
      await page.reload({ waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 2000));
      if (await isAuthWall(page)) {
        throw new LinkedInAuthError();
      }
    }

    // Wait for profile links to appear (resilient to CSS class changes)
    await page.waitForSelector('a[href*="linkedin.com/in/"]', {
      timeout: 10_000,
    }).catch(() => null);

    // Extract profile URLs (stable selector, immune to CSS obfuscation)
    const profileUrls = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="linkedin.com/in/"]');
      const seen = new Set<string>();
      const urls: string[] = [];
      links.forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        const match = href.match(/linkedin\.com\/in\/([^/?]+)/);
        if (!match) return;
        const normalized = `https://www.linkedin.com/in/${match[1]}`;
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      });
      return urls;
    });

    if (profileUrls.length === 0) {
      await incrementDailyCount(userId, "searches");
      return [];
    }

    // Get visible page text for LLM parsing (no CSS dependency)
    const pageText = await page.evaluate(() =>
      (document.body?.innerText ?? "").slice(0, 4000)
    );

    // LLM parses the search results from visible text + URLs
    const searchResultsSchema = z.array(z.object({
      name: z.string(),
      role: z.string(),
      company: z.string(),
      linkedinUrl: z.string(),
    }));

    const parsePrompt = `Extract LinkedIn search results from this page text.

Available profile URLs found on page:
${profileUrls.map((u) => `- ${u}`).join("\n")}

Page text:
${pageText}

For each person found in the search results, match them to one of the profile URLs above and extract:
- name: full name
- role: their headline/title
- company: current company (from "at CompanyName" or "Atual:" or similar)
- linkedinUrl: matching URL from the list above

Rules:
- Only include people who have a matching profile URL
- Skip ads, "Sales Navigator" promos, and non-person results
- If role contains "at CompanyName", split into role and company
- Return max 10 results

Return JSON array: [{"name": "...", "role": "...", "company": "...", "linkedinUrl": "..."}]`;

    let results: LinkedInSearchResult[];
    try {
      results = await callClaudeJSON(parsePrompt, searchResultsSchema, { timeout: 30_000, model: "haiku" });
    } catch (err) {
      console.error("[linkedin] LLM search parse failed:", err);
      results = [];
    }

    await incrementDailyCount(userId, "searches");
    return results;
  } finally {
    await page.close();
  }
}

// --- LinkedIn Company People Search ---

export async function searchCompanyPeople(
  companyLinkedinUrl: string,
  keywords: string,
  userId: string
): Promise<LinkedInSearchResult[]> {
  const { allowed, used, limit } = await checkDailyLimit(userId, "searches");
  if (!allowed) {
    throw new LinkedInLimitError("searches", used, limit);
  }

  // Extract company slug from URL
  const slugMatch = companyLinkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9.\-_]+)/);
  if (!slugMatch) {
    console.error("[linkedin] Invalid company LinkedIn URL:", companyLinkedinUrl);
    return [];
  }
  const slug = slugMatch[1];

  const ctx = await getBrowserContext();
  const page = await ctx.newPage();

  try {
    const peopleUrl = `https://www.linkedin.com/company/${slug}/people/?keywords=${encodeURIComponent(keywords)}`;

    try {
      await page.goto(peopleUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    } catch (navErr) {
      const msg = navErr instanceof Error ? navErr.message : "";
      if (msg.includes("ERR_ABORTED")) {
        await randomDelay(2000, 4000);
        await page.goto(peopleUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      } else {
        throw navErr;
      }
    }
    await randomDelay(2000, 4000);

    if (await isAuthWall(page)) {
      await new Promise((r) => setTimeout(r, 3000));
      await page.reload({ waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 2000));
      if (await isAuthWall(page)) {
        throw new LinkedInAuthError();
      }
    }

    // Wait for profile links to appear
    await page.waitForSelector('a[href*="linkedin.com/in/"]', {
      timeout: 10_000,
    }).catch(() => null);

    // Extract profile URLs
    const profileUrls = await page.evaluate(() => {
      const links = document.querySelectorAll('a[href*="linkedin.com/in/"]');
      const seen = new Set<string>();
      const urls: string[] = [];
      links.forEach((a) => {
        const href = a.getAttribute("href") ?? "";
        const match = href.match(/linkedin\.com\/in\/([^/?]+)/);
        if (!match) return;
        const normalized = `https://www.linkedin.com/in/${match[1]}`;
        if (!seen.has(normalized)) {
          seen.add(normalized);
          urls.push(normalized);
        }
      });
      return urls;
    });

    if (profileUrls.length === 0) {
      await incrementDailyCount(userId, "searches");
      return [];
    }

    // Get visible page text for LLM parsing
    const pageText = await page.evaluate(() =>
      (document.body?.innerText ?? "").slice(0, 4000)
    );

    // LLM parses the results
    const searchResultsSchema = z.array(z.object({
      name: z.string(),
      role: z.string(),
      company: z.string(),
      linkedinUrl: z.string(),
    }));

    const parsePrompt = `Extract people from this LinkedIn company people page.

Available profile URLs found on page:
${profileUrls.map((u) => `- ${u}`).join("\n")}

Page text:
${pageText}

For each person found, match them to one of the profile URLs above and extract:
- name: full name
- role: their headline/title
- company: current company
- linkedinUrl: matching URL from the list above

Rules:
- Only include people who have a matching profile URL
- Skip ads, "Sales Navigator" promos, and non-person results
- If role contains "at CompanyName", split into role and company
- Return max 10 results

Return JSON array: [{"name": "...", "role": "...", "company": "...", "linkedinUrl": "..."}]`;

    let results: LinkedInSearchResult[];
    try {
      results = await callClaudeJSON(parsePrompt, searchResultsSchema, { timeout: 30_000, model: "haiku" });
    } catch (err) {
      console.error("[linkedin] LLM company people parse failed:", err);
      results = [];
    }

    await incrementDailyCount(userId, "searches");
    return results;
  } finally {
    await page.close();
  }
}

// --- LinkedIn Profile Scrape ---

export async function getProfile(
  linkedinUrl: string,
  userId: string,
  targetRoles?: string[]
): Promise<LinkedInProfileData | null> {
  const { allowed, used, limit } = await checkDailyLimit(userId, "scrapes");
  if (!allowed) {
    throw new LinkedInLimitError("scrapes", used, limit);
  }

  const ctx = await getBrowserContext();
  const page = await ctx.newPage();
  const baseUrl = linkedinUrl.replace(/\/$/, "");

  try {
    // --- Step 1: Main profile page ---
    await safeGoto(page, linkedinUrl);
    await randomDelay(3000, 5000);

    if (await isAuthWall(page)) {
      // Retry once — latency can cause false positive
      await new Promise((r) => setTimeout(r, 3000));
      await page.reload({ waitUntil: "domcontentloaded" });
      await new Promise((r) => setTimeout(r, 2000));
      if (await isAuthWall(page)) {
        throw new LinkedInAuthError();
      }
    }

    await new Promise((r) => setTimeout(r, 3000));

    const profileText = await page.evaluate(() =>
      (document.body?.innerText ?? "").slice(0, 4000)
    );
    const title = await page.title();

    // --- Step 2: Experience page ---
    await safeGoto(page, `${baseUrl}/details/experience/`);
    await randomDelay(2000, 4000);

    const experienceText = await page.evaluate(() =>
      (document.body?.innerText ?? "").slice(0, 3000)
    );

    // --- Step 3: Recent activity ---
    await safeGoto(page, `${baseUrl}/recent-activity/all/`);
    await randomDelay(2000, 4000);

    const activityText = await page.evaluate(() =>
      (document.body?.innerText ?? "").slice(0, 2000)
    );

    // --- Step 4: Reactions (fallback if no posts found) ---
    let reactionsText = "";
    const hasNoActivity = !activityText.includes("1w") && !activityText.includes("2w") &&
      !activityText.includes("1d") && !activityText.includes("2d") &&
      !activityText.includes("3d") && !activityText.includes("1mo") &&
      !activityText.match(/\d+[hdw]\b/);

    if (hasNoActivity) {
      await safeGoto(page, `${baseUrl}/recent-activity/reactions/`);
      await randomDelay(2000, 4000);

      reactionsText = await page.evaluate(() =>
        (document.body?.innerText ?? "").slice(0, 2000)
      );
    }

    // --- Step 5: Contact info overlay ---
    const contactInfo = await getContactInfo(page, baseUrl);

    // --- Step 6: Parse everything with Claude CLI ---
    const profileSchema = z.object({
      name: z.string(),
      role: z.string(),
      company: z.string(),
      connections: z.number(),
      about: z.string(),
      currentExperience: z.string().nullable(),
      experienceMatchesICP: z.boolean(),
      isRecentlyActive: z.boolean(),
      lastActivityDate: z.string().nullable(),
    });

    const rolesContext = targetRoles?.length
      ? `Target ICP roles: ${targetRoles.join(", ")}`
      : "No specific target roles";

    const parsePrompt = `Analyze this LinkedIn profile from multiple page extractions.

${rolesContext}

--- MAIN PROFILE PAGE ---
Title: ${title}
URL: ${linkedinUrl}
${profileText}

--- EXPERIENCE PAGE (${baseUrl}/details/experience/) ---
${experienceText}

--- RECENT ACTIVITY (${baseUrl}/recent-activity/all/) ---
${activityText}
${reactionsText ? `\n--- REACTIONS (${baseUrl}/recent-activity/reactions/) ---\n${reactionsText}` : ""}

Extract and analyze:
- name: full name
- role: headline/title
- company: current company
- connections: number (500+ = 500, etc.)
- about: About summary (max 200 chars, "" if not found)
- currentExperience: current job title + company from experience page (e.g. "CTO at TechCorp since 2023"). null if not found.
- experienceMatchesICP: true if current role matches the target ICP roles listed above. Check the EXPERIENCE page — does their current position align with the target roles?
- isRecentlyActive: true ONLY if there is evidence of activity within the last 2 months. Look for time indicators like "1w", "2w", "1mo", "3d", "5h", "yesterday" in the activity/reactions pages. If no recent timestamps found, return false.
- lastActivityDate: approximate date of most recent activity (e.g. "2026-03-15"), null if unknown

Return JSON.`;

    let profileData: z.infer<typeof profileSchema>;
    try {
      profileData = await callClaudeJSON(parsePrompt, profileSchema, { timeout: 45_000, model: "sonnet" });
    } catch {
      const nameFromTitle = title.replace(/\s*\|.*$/, "").replace(/\s*[-–].*$/, "").trim();
      profileData = {
        name: nameFromTitle,
        role: "",
        company: "",
        connections: 0,
        about: "",
        currentExperience: null,
        experienceMatchesICP: false,
        isRecentlyActive: false,
        lastActivityDate: null,
      };
    }

    await incrementDailyCount(userId, "scrapes");

    return {
      name: profileData.name,
      role: profileData.role,
      company: profileData.company,
      connections: profileData.connections,
      about: profileData.about,
      lastActivityDate: profileData.lastActivityDate,
      isRecentlyActive: profileData.isRecentlyActive,
      contactEmail: contactInfo.email,
      contactPhone: contactInfo.phone,
      currentExperience: profileData.currentExperience,
      experienceMatchesICP: profileData.experienceMatchesICP,
    };
  } finally {
    await page.close();
  }
}

// --- Safe Navigation ---

async function safeGoto(page: Page, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: "load", timeout: 20_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("ERR_ABORTED")) {
      await randomDelay(2000, 3000);
      await page.goto(url, { waitUntil: "load", timeout: 20_000 });
    } else {
      throw err;
    }
  }
}

// --- Contact Info ---

async function getContactInfo(page: Page, baseUrl?: string): Promise<{ email: string | null; phone: string | null }> {
  try {
    const profileUrl = baseUrl || page.url().replace(/\/$/, "").replace(/\/details\/.*$/, "").replace(/\/recent-activity\/.*$/, "");
    await page.goto(`${profileUrl}/overlay/contact-info/`, {
      waitUntil: "load",
      timeout: 15_000,
    });
    await new Promise((r) => setTimeout(r, 2000));

    // Extract text and find email/phone patterns
    const text = await page.evaluate(() => document.body?.innerText ?? "");

    const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    const phoneMatch = text.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{2,3}\)?[\s.-]?\d{3,5}[\s.-]?\d{3,4}/);

    // Go back to profile
    await page.goBack({ waitUntil: "load", timeout: 10_000 }).catch(() => null);

    return {
      email: emailMatch?.[0] ?? null,
      phone: phoneMatch?.[0] ?? null,
    };
  } catch {
    return { email: null, phone: null };
  }
}

// --- Usage Stats ---

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
