# LinkedIn Search First — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace Google dork with LinkedIn MCP `search_people` as primary lead source, keeping Google as fallback.

**Architecture:** New `searchLinkedInPeople()` in `linkedin-mcp.ts` calls the MCP `search_people` tool. `find-lead.ts` is rewritten to try LinkedIn first, parse results with Haiku, dedup, and fall back to Google dork on any failure.

**Tech Stack:** LinkedIn MCP (search_people tool), Claude Haiku (result parsing), existing Serper API (fallback)

---

### Task 1: Add `searchLinkedInPeople` to LinkedIn MCP client

**Files:**
- Modify: `src/lib/linkedin-mcp.ts`

**Step 1: Add the function after `getLinkedInProfile`**

```typescript
export async function searchLinkedInPeople(
  keywords: string,
  location?: string
): Promise<string | null> {
  const mcpUrl = process.env.LINKEDIN_MCP_URL;
  if (!mcpUrl) {
    console.warn("[LinkedIn MCP] LINKEDIN_MCP_URL not set, skipping search");
    return null;
  }

  try {
    const client = await getSharedClient();

    const args: Record<string, string> = { keywords };
    if (location) args.location = location;

    const result = await client.callTool({
      name: "search_people",
      arguments: args,
    });

    const rawText = (
      result.content as Array<{ type: string; text: string }>
    )
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    if (!rawText || rawText.toLowerCase().includes("rate limit")) {
      console.warn("[LinkedIn MCP] Search rate limited for:", keywords);
      return null;
    }

    if (isAuthError(rawText)) {
      await closeSharedClient();
      throw new LinkedInAuthError();
    }

    return rawText;
  } catch (error) {
    if (error instanceof LinkedInAuthError) throw error;
    console.error("[LinkedIn MCP] Search error:", error instanceof Error ? error.message : error);
    await closeSharedClient();
    return null;
  }
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Build succeeds (new function is exported but not yet called)

**Step 3: Commit**

```bash
git add src/lib/linkedin-mcp.ts
git commit -m "feat: add searchLinkedInPeople to LinkedIn MCP client"
```

---

### Task 2: Rewrite `find-lead.ts` — LinkedIn search first, Google fallback

**Files:**
- Modify: `src/lib/agent/nodes/find-lead.ts`

**Step 1: Add imports and LinkedIn search parsing**

Add at the top of the file:

```typescript
import { searchLinkedInPeople, LinkedInAuthError } from "@/lib/linkedin-mcp";
import { ChatAnthropic } from "@langchain/anthropic";
import { getApiKey } from "@/lib/claude-auth";
import { incrementLinkedInDailyCount, checkLinkedInDailyLimit } from "@/lib/security/linkedin-daily-limit";
```

**Step 2: Add the LinkedIn candidate interface and parser**

```typescript
interface LinkedInCandidate {
  name: string;
  role: string | null;
  company: string | null;
  linkedinUrl: string;
}

async function parseSearchResults(rawText: string): Promise<LinkedInCandidate[]> {
  const llm = new ChatAnthropic({
    model: "claude-haiku-4-5-20251001",
    temperature: 0,
    anthropicApiKey: getApiKey(),
  });

  const response = await llm.invoke([
    {
      role: "system",
      content: `Extract people from LinkedIn search results. Return ONLY a JSON array, no markdown.
Each person: {"name": string, "role": string|null, "company": string|null, "linkedinUrl": string}
For linkedinUrl: must be a full URL like "https://www.linkedin.com/in/username".
Only include results that have a valid LinkedIn profile URL.
If no people found, return [].`,
    },
    {
      role: "user",
      content: rawText.slice(0, 4000),
    },
  ]);

  const rawContent = typeof response.content === "string" ? response.content : "";
  const content = rawContent.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?```\s*$/m, "").trim();

  try {
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p: Record<string, unknown>) =>
        typeof p.name === "string" &&
        typeof p.linkedinUrl === "string" &&
        p.linkedinUrl.includes("linkedin.com/in/")
    ).map((p: Record<string, unknown>) => ({
      name: p.name as string,
      role: typeof p.role === "string" ? p.role : null,
      company: typeof p.company === "string" ? p.company : null,
      linkedinUrl: normalizeLinkedInUrl(p.linkedinUrl as string),
    }));
  } catch {
    console.error("[find-lead] Failed to parse LinkedIn search results");
    return [];
  }
}
```

**Step 3: Add the LinkedIn search function**

```typescript
function buildLinkedInQueries(
  targetRoles: string[],
  searchTerms: string[],
  sector: string
): string[] {
  const terms = searchTerms.join(" ");
  const queries: string[] = [];

  for (const role of targetRoles) {
    // Primary: role + search terms
    if (terms) {
      queries.push(`${role} ${terms}`);
    }
    // Fallback: role + sector
    if (sector && sector !== terms) {
      queries.push(`${role} ${sector}`);
    }
    // Last resort: just the role
    if (!terms && !sector) {
      queries.push(role);
    }
  }

  return queries;
}

async function searchViaLinkedIn(
  state: AgentStateType
): Promise<Partial<AgentStateType> | null> {
  // Check daily limit before LinkedIn search
  const dailyLimit = checkLinkedInDailyLimit(state.userId);
  if (!dailyLimit.allowed) return null;

  const sector = state.companyProfile?.sector ?? "";
  const queries = buildLinkedInQueries(state.targetRoles, state.searchTerms, sector);

  // Parse region for location (first city)
  const location = parseCities(state.region)[0] || state.region;

  for (const keywords of queries) {
    // Rate limit delay (10-20s)
    const delayMs = Math.floor(Math.random() * 10000) + 10000;
    await new Promise((resolve) => setTimeout(resolve, delayMs));

    let rawText: string | null;
    try {
      rawText = await searchLinkedInPeople(keywords, location);
    } catch (error) {
      if (error instanceof LinkedInAuthError) throw error;
      continue;
    }

    if (!rawText) continue;

    incrementLinkedInDailyCount(state.userId);

    const candidates = await parseSearchResults(rawText);
    if (candidates.length === 0) continue;

    // Batch dedup
    const allUrls = candidates.map((c) => c.linkedinUrl);
    const existingUrls = await getExistingLinkedInUrls(state.userId, allUrls);

    for (const candidate of candidates) {
      if (existingUrls.has(candidate.linkedinUrl)) continue;
      if (state.companiesSearched.includes(candidate.linkedinUrl)) continue;

      return {
        currentCompany: {
          name: candidate.company ?? state.searchTerms[0] ?? "Unknown",
          website: null,
          snippet: candidate.role ?? "",
        },
        currentDecisionMaker: {
          name: candidate.name,
          linkedinUrl: candidate.linkedinUrl,
          role: candidate.role,
          snippet: candidate.role ?? "",
        },
        companiesSearched: [candidate.linkedinUrl],
        retries: 0,
        log: [
          {
            step: "find_lead",
            message: `LinkedIn search: "${keywords}" em ${location}`,
            timestamp: new Date().toISOString(),
          },
          {
            step: "find_lead",
            message: `Found: ${candidate.name}${candidate.role ? ` — ${candidate.role}` : ""}${candidate.company ? ` @ ${candidate.company}` : ""}`,
            timestamp: new Date().toISOString(),
          },
        ],
      };
    }
  }

  return null; // Signal to try Google fallback
}
```

**Step 4: Rename current Google logic and rewrite `findLead`**

Rename the existing `findLead` function to `searchViaGoogle`, keeping its exact current implementation. Then create new `findLead`:

```typescript
async function searchViaGoogle(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  // ... exact current findLead implementation, unchanged ...
}

export async function findLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  // Try LinkedIn first
  try {
    const linkedInResult = await searchViaLinkedIn(state);
    if (linkedInResult) return linkedInResult;
  } catch (error) {
    if (error instanceof LinkedInAuthError) throw error;
    // Any other error: fall through to Google
    console.warn("[find-lead] LinkedIn search failed, falling back to Google:", error);
  }

  // Fallback to Google dork
  return searchViaGoogle(state);
}
```

**Step 5: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "feat: LinkedIn search first in find-lead, Google dork as fallback"
```

---

### Task 3: Handle LinkedInAuthError in `find-lead` → graph routing

**Files:**
- Modify: `src/lib/agent/graph.ts`

**Step 1: Add auth error handling in graph edge**

The `find-lead` node can now throw `LinkedInAuthError`. The graph needs to catch this so it propagates as a `retries: 999` state (same pattern as validate-profile). Check if LangGraph handles thrown errors — if not, wrap in find-lead itself.

Review: `find-lead` already throws `LinkedInAuthError` from `searchViaLinkedIn`. The `validate-profile` node catches this and sets `retries: 999`. We need the same pattern in `find-lead`.

**Step 2: Wrap the LinkedInAuthError in find-lead**

Update the `findLead` function to catch `LinkedInAuthError` and return the auth-required state:

```typescript
export async function findLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  // Try LinkedIn first
  try {
    const linkedInResult = await searchViaLinkedIn(state);
    if (linkedInResult) return linkedInResult;
  } catch (error) {
    if (error instanceof LinkedInAuthError) {
      return {
        currentCompany: null,
        currentDecisionMaker: null,
        retries: 999,
        log: [{
          step: "linkedin_auth_required",
          message: "Sessão do LinkedIn expirou. Faça login manual para continuar.",
          timestamp: new Date().toISOString(),
        }],
      };
    }
    console.warn("[find-lead] LinkedIn search failed, falling back to Google:", error);
  }

  // Fallback to Google dork
  return searchViaGoogle(state);
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds

**Step 4: Commit**

```bash
git add src/lib/agent/nodes/find-lead.ts
git commit -m "fix: handle LinkedInAuthError in find-lead with auth modal trigger"
```

Note: This can be merged with Task 2's commit since it's the same file. Use judgment.

---

### Task 4: Count LinkedIn searches in daily limit

**Files:**
- Modify: `src/lib/security/linkedin-daily-limit.ts`

**Step 1: No code change needed**

The daily limit module already provides `checkLinkedInDailyLimit` and `incrementLinkedInDailyCount`. Task 2 already imports and calls these in `searchViaLinkedIn`. Each `search_people` call increments the counter, same as `get_person_profile` calls in validate-profile.

The daily limit of 50 now covers both search + profile calls combined. This is correct — both consume LinkedIn session resources.

**Step 2: Verify the daily limit is 50**

Consider: each lead now costs ~2 LinkedIn calls (1 search + 1 profile). With limit=50, max ~25 leads/day. If this is too low, increase `DAILY_LIMIT` to 80. Leave at 50 for now, adjust after testing.

No commit needed for this task.

---

### Task 5: Manual smoke test

**Step 1: Start LinkedIn MCP server**

```bash
python -m uv tool run linkedin-scraper-mcp --transport streamable-http --port 8080
```

**Step 2: Start dev server**

```bash
npm run dev
```

**Step 3: Run a prospecting session**

1. Go to `/prospect`
2. Select a segment with known parameters (e.g., CEO, fintech, São Paulo)
3. Request 2 leads
4. Watch the agent feed — verify:
   - Logs show `LinkedIn search: "CEO fintech" em São Paulo` (not Google dork)
   - Candidates have real names, roles, companies
   - If LinkedIn fails, logs show fallback to Google dork
   - Leads are created successfully

**Step 4: Test fallback**

1. Stop the LinkedIn MCP server
2. Run another prospecting session
3. Verify it falls back to Google dork queries and still creates leads

**Step 5: Commit any fixes**

---

### Task 6: Final build check and lint

**Step 1: Run lint**

```bash
npm run lint
```

**Step 2: Run build**

```bash
npm run build
```

**Step 3: Fix any issues and commit**

```bash
git add -A
git commit -m "chore: lint and build fixes for LinkedIn search first"
```
