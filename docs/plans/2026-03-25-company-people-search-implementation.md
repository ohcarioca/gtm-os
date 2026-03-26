# Company People Search Priority — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a company has a LinkedIn URL, search for leads on the company's people page (`/company/{slug}/people/?keywords={role}`) as first priority, with fallback to generic LinkedIn search.

**Architecture:** New `searchCompanyPeople` function in `linkedin-playwright.ts` using same pattern as `searchPeople`. `find-lead.ts` checks for company `linkedinUrl` and routes to the new function first. State and API route updated to pass `linkedinUrl` through.

**Tech Stack:** Playwright, Zod, Claude CLI (Haiku), LangGraph

---

### Task 1: Add `linkedinUrl` to `targetCompanies` in state

**Files:**
- Modify: `src/lib/agent/state.ts:70-74`

**Step 1: Update the `targetCompanies` type**

In `src/lib/agent/state.ts`, change the `targetCompanies` annotation to include `linkedinUrl`:

```ts
  targetCompanies: Annotation<Array<{
    id: string;
    name: string;
    website: string | null;
    linkedinUrl: string | null;
  }>>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
```

**Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors (existing ones OK).

**Step 3: Commit**

```bash
git add src/lib/agent/state.ts
git commit -m "feat: add linkedinUrl to targetCompanies state"
```

---

### Task 2: Load and pass `linkedin_url` in API route

**Files:**
- Modify: `src/app/api/prospect/route.ts:52-65`

**Step 1: Update the select query to include `linkedin_url`**

In `src/app/api/prospect/route.ts`, change line 54:

```ts
    .select("id, name, website, linkedin_url")
```

**Step 2: Update the map to include `linkedinUrl`**

Change the map at lines 60-64:

```ts
  const targetCompanies = shuffle(
    (selectedCompanies ?? []).map((c: { id: string; name: string; website: string | null; linkedin_url: string | null }) => ({
      id: c.id,
      name: c.name,
      website: c.website,
      linkedinUrl: c.linkedin_url,
    }))
  );
```

**Step 3: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/app/api/prospect/route.ts
git commit -m "feat: pass company linkedin_url to prospecting pipeline"
```

---

### Task 3: Create `searchCompanyPeople` function

**Files:**
- Modify: `src/lib/linkedin-playwright.ts` (add new exported function after `searchPeople`)

**Step 1: Add the `searchCompanyPeople` function**

Add after the `searchPeople` function (after line 310), before the `getProfile` function:

```ts
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
  const slugMatch = companyLinkedinUrl.match(/linkedin\.com\/company\/([a-zA-Z0-9\-_]+)/);
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
```

**Step 2: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

**Step 3: Commit**

```bash
git add src/lib/linkedin-playwright.ts
git commit -m "feat: add searchCompanyPeople for company people page scraping"
```

---

### Task 4: Update `find-lead.ts` — company people search priority

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts`

**Step 1: Add import for `searchCompanyPeople`**

Update the import on line 3:

```ts
import { searchPeople, searchCompanyPeople, LinkedInAuthError, LinkedInLimitError } from "@/lib/linkedin-playwright";
```

**Step 2: Rewrite the search logic to prioritize company people page**

The new flow for each company+role:

1. If company has `linkedinUrl` → try `searchCompanyPeople` first
2. If no results from company people (or no `linkedinUrl` + linkedinOnly) → try `searchPeople`
3. If no `linkedinUrl` + full mode → try Google dork first, then `searchPeople`

Replace the body of the `try` block (lines 35-181) with the updated logic. The key change is inserting a `searchCompanyPeople` call before the existing search paths when `targetCompany.linkedinUrl` exists:

```ts
    const processedUrls = await loadProcessedUrls(state.userId);

    if (state.currentRoleIndex >= state.targetRoles.length) {
      return {
        currentCompany: null,
        currentDecisionMaker: null,
        searchRetries: state.searchRetries + 1,
        log: [{ ...log, message: "Todas as combinações empresa+cargo esgotadas." }],
      };
    }

    const companyIdx = state.currentCompanyIndex % state.targetCompanies.length;
    const targetCompany = state.targetCompanies[companyIdx];
    const role = state.targetRoles[state.currentRoleIndex];

    // Helper to build return value when a candidate is found
    const buildFoundResult = (
      candidate: { name: string; role: string; linkedinUrl: string },
      source: string,
      extraLogs: Array<{ step: string; message: string; timestamp: string }> = []
    ): Partial<AgentStateType> => {
      const url = normalizeLinkedInUrl(candidate.linkedinUrl);
      const nextCompanyIdx = companyIdx + 1;
      const wrapped = nextCompanyIdx >= state.targetCompanies.length;

      return {
        currentCompany: {
          name: targetCompany.name,
          linkedinUrl: targetCompany.linkedinUrl ?? null,
          website: targetCompany.website,
        },
        currentDecisionMaker: {
          name: candidate.name,
          role: candidate.role,
          linkedinUrl: url,
          company: targetCompany.name,
        },
        currentCompanyIndex: wrapped ? 0 : nextCompanyIdx,
        currentRoleIndex: wrapped ? state.currentRoleIndex + 1 : state.currentRoleIndex,
        companiesSearched: [...state.companiesSearched, url],
        log: [...extraLogs, { ...log, message: `[${source}] Encontrado (${targetCompany.name}, ${role}): ${candidate.name} - ${candidate.role} (${url})` }],
      };
    };

    // Helper to advance to next company+role when no candidate found
    const buildAdvanceResult = (
      extraLogs: Array<{ step: string; message: string; timestamp: string }> = []
    ): Partial<AgentStateType> => {
      const nextCompanyIdx = companyIdx + 1;
      const wrapped = nextCompanyIdx >= state.targetCompanies.length;

      return {
        currentCompany: null,
        currentDecisionMaker: null,
        currentCompanyIndex: wrapped ? 0 : nextCompanyIdx,
        currentRoleIndex: wrapped ? state.currentRoleIndex + 1 : state.currentRoleIndex,
        searchRetries: state.searchRetries + 1,
        log: [...extraLogs, { ...log, message: `Nenhum lead "${role}" em ${targetCompany.name}, avançando...` }],
      };
    };

    // --- Priority 1: Company People Page (when linkedin_url exists) ---
    if (targetCompany.linkedinUrl) {
      log.message = `[Company People] Buscando "${role}" na página de ${targetCompany.name}...`;

      const companyPeopleCandidates = await searchCompanyPeople(
        targetCompany.linkedinUrl,
        role,
        state.userId
      );

      for (const candidate of companyPeopleCandidates) {
        const url = normalizeLinkedInUrl(candidate.linkedinUrl);
        if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
        return buildFoundResult(candidate, "Company People");
      }

      // Fallback: generic LinkedIn search
      const fallbackCandidates = await searchPeople(
        `${role} ${targetCompany.name}`,
        state.linkedinOnly ? undefined : state.region,
        state.userId
      );

      for (const candidate of fallbackCandidates) {
        const url = normalizeLinkedInUrl(candidate.linkedinUrl);
        if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
        return buildFoundResult(candidate, "LinkedIn Fallback");
      }

      return buildAdvanceResult();
    }

    // --- No linkedin_url: existing flow ---

    // LinkedIn Only mode
    if (state.linkedinOnly) {
      log.message = `[LinkedIn Only] Buscando "${role}" na empresa: ${targetCompany.name}...`;

      const candidates = await searchPeople(
        `${role} ${targetCompany.name}`,
        undefined,
        state.userId
      );

      for (const candidate of candidates) {
        const url = normalizeLinkedInUrl(candidate.linkedinUrl);
        if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
        return buildFoundResult(candidate, "LinkedIn Only");
      }

      return buildAdvanceResult();
    }

    // Full mode: Google dork first, then LinkedIn search
    const dorkQuery = `site:linkedin.com/in "${role}" "${targetCompany.name}"`;
    const googleLog = { step: "google_search", message: "", timestamp: new Date().toISOString() };
    const results = await googleSearch(dorkQuery, state.userId);
    const linkedinResults = results.filter((r) => normalizeLinkedInUrl(r.link).includes("linkedin.com/in/"));

    googleLog.message = linkedinResults.length > 0
      ? `[Google] ${linkedinResults.length} perfis encontrados para "${role}" + "${targetCompany.name}"`
      : `[Google] Nenhum perfil encontrado para "${role}" + "${targetCompany.name}", usando LinkedIn Search`;

    for (const result of linkedinResults) {
      const url = normalizeLinkedInUrl(result.link);
      if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
      const name = result.title.split(/\s*[-–|]\s*/)[0]?.trim() ?? "";
      return buildFoundResult({ name, role: "", linkedinUrl: url }, "Google", [googleLog]);
    }

    // LinkedIn search fallback
    const candidates = await searchPeople(
      `${role} ${targetCompany.name}`,
      state.region,
      state.userId
    );

    for (const candidate of candidates) {
      const url = normalizeLinkedInUrl(candidate.linkedinUrl);
      if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
      return buildFoundResult(candidate, "LinkedIn", [googleLog]);
    }

    return buildAdvanceResult([googleLog]);
```

**Step 3: Verify no type errors**

Run: `npx tsc --noEmit 2>&1 | head -20`
Expected: No new errors.

**Step 4: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "feat: prioritize company people page search when linkedin_url exists"
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add the new design doc to Key Files**

Add under the existing LinkedIn lead creation entries:

```markdown
- `docs/plans/2026-03-25-company-people-search-design.md` — Company people page search priority design
- `docs/plans/2026-03-25-company-people-search-implementation.md` — Company people page search implementation plan
```

**Step 2: Update Agent Pipeline section**

Add note about company people search priority to the pipeline description. Add after the "Template dork queries" line:

```markdown
- When company has `linkedin_url`, searches company people page (`/company/{slug}/people/?keywords={role}`) first, falls back to generic LinkedIn search. Skips Google dork for companies with LinkedIn URL.
```

**Step 3: Update migration count (17 → 18) and add entry**

```markdown
18. `018_add_company_linkedin_url.sql` — Add linkedin_url to prospect_companies
```

**Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with company people search feature"
```
