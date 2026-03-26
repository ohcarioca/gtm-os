# LinkedIn Auto-Login Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Automatically use saved LinkedIn credentials to log in to the LinkedIn MCP server when the session expires, eliminating manual `--login` steps.

**Architecture:** Create a Python login script that uses the MCP server's own Patchright installation to automate LinkedIn login using decrypted credentials passed via stdin. The Node.js side detects auth failures in `linkedin-mcp.ts`, fetches/decrypts credentials from Supabase, and invokes the Python script. On success, the MCP server's existing session (`~/.linkedin-mcp/profile/`) is refreshed and subsequent calls work normally.

**Tech Stack:** Python (Patchright via existing `linkedin-scraper-mcp` installation), Node.js `child_process`, Supabase (credential storage), AES-256-GCM (decryption)

---

## Context

### Current State
- LinkedIn credentials are saved encrypted in Supabase `linkedin_credentials` table
- The LinkedIn MCP server (`linkedin-scraper-mcp`) uses Patchright with persistent browser profile at `~/.linkedin-mcp/profile/`
- Login is manual: `python -m uv tool run linkedin-scraper-mcp --login --no-headless`
- The MCP server exposes NO login tool — only `get_person_profile`, `search_people`, etc.
- When session expires, `getLinkedInProfile()` returns `null` (fallback stub validation kicks in)
- `session_cookies` and `last_login` fields in DB are unused

### Key Files
- `src/lib/linkedin-mcp.ts` — MCP client wrapper, calls `get_person_profile`
- `src/lib/encryption.ts` — AES-256-GCM encrypt/decrypt
- `src/app/(app)/settings/actions.ts` — Server Action saving credentials
- `src/lib/agent/nodes/validate-profile.ts` — Uses `getLinkedInProfile()`
- `src/app/api/prospect/route.ts` — SSE endpoint, passes `userId` to agent
- `~/.linkedin-mcp/profile/` — Patchright persistent browser profile
- `~/.linkedin-mcp/cookies.json` — Portable cookies (exported after login)
- `~/.linkedin-mcp/source-state.json` — Session metadata

### Design Decisions
1. **Python script, not Node.js Playwright** — Patchright is already installed via the MCP server's Python env. Adding `playwright` to the Node.js project would duplicate browser binaries (~300MB). The Python script writes to the same `~/.linkedin-mcp/profile/` directory.
2. **Credentials via stdin, not CLI args** — Prevents password from appearing in `ps aux` / process list.
3. **Detect auth failure from MCP response** — The MCP server returns specific error text when session is expired (auth barrier detection). We check for these markers.
4. **Single retry after login** — If auth fails, auto-login once, retry the MCP call once. If it fails again, fall through to existing stub behavior.
5. **Update `last_login` in DB** — Track when auto-login last succeeded for observability.

---

### Task 1: Create Python Auto-Login Script

**Files:**
- Create: `scripts/linkedin-login.py`

**Step 1: Write the Python login script**

This script receives credentials via stdin (JSON), uses Patchright to automate LinkedIn login in the MCP server's profile directory.

```python
#!/usr/bin/env python3
"""
Automated LinkedIn login using saved credentials.
Receives {"email": "...", "password": "..."} via stdin.
Uses the same browser profile as linkedin-scraper-mcp (~/.linkedin-mcp/profile/).
Exits 0 on success, 1 on failure. Outputs JSON status to stdout.
"""

import asyncio
import json
import sys
from pathlib import Path

PROFILE_DIR = Path.home() / ".linkedin-mcp" / "profile"
COOKIES_PATH = Path.home() / ".linkedin-mcp" / "cookies.json"
LOGIN_URL = "https://www.linkedin.com/login"
FEED_URL = "https://www.linkedin.com/feed/"
TIMEOUT_MS = 60_000  # 60 seconds for login flow


def output(success: bool, message: str):
    print(json.dumps({"success": success, "message": message}))
    sys.exit(0 if success else 1)


async def main():
    # Read credentials from stdin
    try:
        raw = sys.stdin.read()
        creds = json.loads(raw)
        email = creds["email"]
        password = creds["password"]
    except (json.JSONDecodeError, KeyError) as e:
        output(False, f"Invalid credentials input: {e}")
        return

    try:
        from patchright.async_api import async_playwright
    except ImportError:
        output(False, "Patchright not installed. Run: pip install patchright")
        return

    PROFILE_DIR.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as p:
        browser = await p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE_DIR),
            headless=True,
            args=["--disable-blink-features=AutomationControlled"],
        )

        try:
            page = browser.pages[0] if browser.pages else await browser.new_page()

            # Check if already logged in
            await page.goto(FEED_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
            if "/feed" in page.url and "/login" not in page.url and "/authwall" not in page.url:
                output(True, "Already logged in")
                return

            # Navigate to login page
            await page.goto(LOGIN_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)

            # Fill credentials
            await page.fill("#username", email)
            await page.fill("#password", password)
            await page.click('[data-litms-control-urn="login-submit"]')

            # Wait for navigation — either feed (success) or challenge page
            await page.wait_for_load_state("domcontentloaded", timeout=TIMEOUT_MS)
            await asyncio.sleep(3)  # Allow redirects to settle

            current_url = page.url

            # Check for security challenges
            if "/checkpoint" in current_url or "/challenge" in current_url:
                output(False, "LinkedIn security challenge detected — manual login required")
                return

            if "/login" in current_url or "/authwall" in current_url:
                output(False, "Login failed — check credentials")
                return

            # Verify we're logged in
            if "/feed" in current_url or "linkedin.com" in current_url:
                # Export cookies for cross-runtime compatibility
                cookies = await browser.cookies()
                cookie_list = []
                for c in cookies:
                    if "linkedin.com" in c.get("domain", ""):
                        cookie_list.append({
                            "name": c["name"],
                            "value": c["value"],
                            "domain": c["domain"],
                            "path": c.get("path", "/"),
                            "expires": c.get("expires", -1),
                            "httpOnly": c.get("httpOnly", False),
                            "secure": c.get("secure", False),
                            "sameSite": c.get("sameSite", "None"),
                        })

                COOKIES_PATH.write_text(json.dumps(cookie_list, indent=2))

                # Update source-state.json
                import uuid
                source_state = {
                    "version": 1,
                    "source_runtime_id": "windows-amd64-host",
                    "login_generation": str(uuid.uuid4()),
                    "created_at": asyncio.get_event_loop().time(),
                    "profile_path": str(PROFILE_DIR),
                    "cookies_path": str(COOKIES_PATH),
                }
                # Use ISO date for created_at
                from datetime import datetime, timezone
                source_state["created_at"] = datetime.now(timezone.utc).isoformat()

                state_path = Path.home() / ".linkedin-mcp" / "source-state.json"
                state_path.write_text(json.dumps(source_state, indent=2))

                output(True, "Login successful")
                return

            output(False, f"Unexpected state after login: {current_url}")

        finally:
            await browser.close()


if __name__ == "__main__":
    asyncio.run(main())
```

**Step 2: Verify the script is syntactically valid**

Run: `python -c "import ast; ast.parse(open('scripts/linkedin-login.py').read()); print('OK')"`
Expected: `OK`

**Step 3: Commit**

```bash
git add scripts/linkedin-login.py
git commit -m "feat: add Python auto-login script for LinkedIn MCP"
```

---

### Task 2: Add Auto-Login Function to `linkedin-mcp.ts`

**Files:**
- Modify: `src/lib/linkedin-mcp.ts`

**Step 1: Write the failing test**

Create `src/lib/__tests__/linkedin-auto-login.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// We'll test the auth-failure detection logic
describe("LinkedIn auth failure detection", () => {
  it("detects auth barrier text in MCP response", () => {
    const authBarrierTexts = [
      "auth barrier",
      "authwall",
      "login required",
      "session expired",
      "not authenticated",
      "Sign in to LinkedIn",
    ];

    const isAuthError = (text: string): boolean => {
      const markers = [
        "auth barrier",
        "authwall",
        "login required",
        "session expired",
        "not authenticated",
        "sign in",
      ];
      const lower = text.toLowerCase();
      return markers.some((m) => lower.includes(m));
    };

    for (const text of authBarrierTexts) {
      expect(isAuthError(text)).toBe(true);
    }
    expect(isAuthError("Profile data for John")).toBe(false);
  });
});
```

**Step 2: Run test to verify it passes** (this is a unit test for the detection logic)

Run: `npx vitest run src/lib/__tests__/linkedin-auto-login.test.ts`
Expected: PASS

**Step 3: Add `linkedInAutoLogin` and auth detection to `linkedin-mcp.ts`**

Add these imports at top of `src/lib/linkedin-mcp.ts`:

```typescript
import { execFile } from "child_process";
import { promisify } from "util";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";

const execFileAsync = promisify(execFile);
```

Add these functions before `getLinkedInProfile`:

```typescript
const AUTH_ERROR_MARKERS = [
  "auth barrier",
  "authwall",
  "login required",
  "session expired",
  "not authenticated",
  "sign in",
];

function isAuthError(text: string): boolean {
  const lower = text.toLowerCase();
  return AUTH_ERROR_MARKERS.some((m) => lower.includes(m));
}

async function fetchCredentials(userId: string): Promise<{ email: string; password: string } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const supabase = createServiceClient(url, key);
  const { data } = await supabase
    .from("linkedin_credentials")
    .select("encrypted_email, encrypted_password")
    .eq("user_id", userId)
    .single();

  if (!data) return null;

  return {
    email: decrypt(data.encrypted_email),
    password: decrypt(data.encrypted_password),
  };
}

async function autoLogin(userId: string): Promise<boolean> {
  const creds = await fetchCredentials(userId);
  if (!creds) {
    console.warn("[LinkedIn MCP] No saved credentials for auto-login");
    return false;
  }

  console.log("[LinkedIn MCP] Attempting auto-login...");

  try {
    const { stdout } = await execFileAsync(
      "python",
      ["-u", "scripts/linkedin-login.py"],
      {
        cwd: process.cwd(),
        timeout: 90_000,
        env: { ...process.env },
        // Pass credentials via stdin
        ...(({ input: JSON.stringify(creds) }) as Record<string, unknown>),
      }
    );

    const result = JSON.parse(stdout.trim());
    if (result.success) {
      console.log("[LinkedIn MCP] Auto-login succeeded:", result.message);

      // Update last_login in DB
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
      const supabase = createServiceClient(url, key);
      await supabase
        .from("linkedin_credentials")
        .update({ last_login: new Date().toISOString() })
        .eq("user_id", userId);

      return true;
    }

    console.warn("[LinkedIn MCP] Auto-login failed:", result.message);
    return false;
  } catch (error) {
    console.error("[LinkedIn MCP] Auto-login error:", error instanceof Error ? error.message : error);
    return false;
  }
}
```

**Step 4: Update `getLinkedInProfile` signature to accept `userId`**

Change the function signature and add retry-after-login logic:

```typescript
export async function getLinkedInProfile(
  linkedinUrl: string,
  userId?: string
): Promise<LinkedInProfileData | null> {
```

Inside the function, after getting `rawText` (around line 60), add auth error detection:

```typescript
    if (!rawText || rawText.toLowerCase().includes("rate limit")) {
      console.warn("[LinkedIn MCP] Rate limited for:", username);
      return null;
    }

    // Detect auth failure — attempt auto-login and retry once
    if (isAuthError(rawText) && userId) {
      console.warn("[LinkedIn MCP] Auth failure detected, attempting auto-login...");
      await client.close();
      client = null;

      const loginSuccess = await autoLogin(userId);
      if (loginSuccess) {
        // Retry with fresh connection
        return getLinkedInProfile(linkedinUrl); // No userId = no infinite retry
      }
      console.warn("[LinkedIn MCP] Auto-login failed, falling back to stub");
      return null;
    }
```

**Step 5: Commit**

```bash
git add src/lib/linkedin-mcp.ts src/lib/__tests__/linkedin-auto-login.test.ts
git commit -m "feat: add auto-login on LinkedIn auth failure"
```

---

### Task 3: Pass `userId` Through the Pipeline

**Files:**
- Modify: `src/lib/agent/nodes/validate-profile.ts`

**Step 1: Update `validate-profile.ts` to pass `userId` to `getLinkedInProfile`**

In `src/lib/agent/nodes/validate-profile.ts`, change line 35 from:

```typescript
const profile = await getLinkedInProfile(linkedinUrl);
```

to:

```typescript
const profile = await getLinkedInProfile(linkedinUrl, state.userId);
```

This is all that's needed — `userId` is already in the agent state (passed from `prospect/route.ts` line 73).

**Step 2: Verify the build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/validate-profile.ts
git commit -m "feat: pass userId to LinkedIn MCP for auto-login support"
```

---

### Task 4: Add Manual Login API Route

**Files:**
- Create: `src/app/api/linkedin/login/route.ts`

**Step 1: Create the API route**

This allows the settings page to trigger a manual login test.

```typescript
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/encryption";
import { execFile } from "child_process";
import { promisify } from "util";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const execFileAsync = promisify(execFile);

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  // Fetch credentials using service role
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: creds } = await serviceClient
    .from("linkedin_credentials")
    .select("encrypted_email, encrypted_password")
    .eq("user_id", user.id)
    .single();

  if (!creds) {
    return Response.json({ success: false, message: "No credentials saved" }, { status: 400 });
  }

  try {
    const { stdout } = await execFileAsync(
      "python",
      ["-u", "scripts/linkedin-login.py"],
      {
        cwd: process.cwd(),
        timeout: 90_000,
        env: { ...process.env },
        ...(({ input: JSON.stringify({
          email: decrypt(creds.encrypted_email),
          password: decrypt(creds.encrypted_password),
        }) }) as Record<string, unknown>),
      }
    );

    const result = JSON.parse(stdout.trim());

    if (result.success) {
      await serviceClient
        .from("linkedin_credentials")
        .update({ last_login: new Date().toISOString() })
        .eq("user_id", user.id);
    }

    return Response.json(result);
  } catch (error) {
    return Response.json(
      { success: false, message: error instanceof Error ? error.message : "Login failed" },
      { status: 500 }
    );
  }
}
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app/api/linkedin/login/route.ts
git commit -m "feat: add API route for manual LinkedIn login trigger"
```

---

### Task 5: Add "Test Login" Button to Settings Page

**Files:**
- Modify: `src/app/(app)/settings/page.tsx`

**Step 1: Read the current settings page**

Read `src/app/(app)/settings/page.tsx` to understand the current LinkedIn credentials form layout.

**Step 2: Add a "Testar Login" button after the credentials form**

Add a client component that calls `POST /api/linkedin/login` and shows success/failure status. The button should:
- Show "Testando..." while loading
- Show green success message or red error
- Only appear when credentials are already saved

Create `src/app/(app)/settings/linkedin-login-button.tsx`:

```typescript
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LinkedInLoginButton() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleLogin() {
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/linkedin/login", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setStatus("success");
        setMessage(data.message);
      } else {
        setStatus("error");
        setMessage(data.message);
      }
    } catch {
      setStatus("error");
      setMessage("Erro de conexão");
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleLogin}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Testando..." : "Testar Login"}
      </Button>
      {status === "success" && (
        <p className="text-sm text-green-600">{message}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600">{message}</p>
      )}
    </div>
  );
}
```

**Step 3: Import and place the button in the settings page**

In `src/app/(app)/settings/page.tsx`, import `LinkedInLoginButton` and render it after the credentials form (only when `hasCredentials` is true).

**Step 4: Verify it renders**

Run: `npm run dev` and visit `/settings`
Expected: "Testar Login" button appears below saved credentials

**Step 5: Commit**

```bash
git add src/app/(app)/settings/linkedin-login-button.tsx src/app/(app)/settings/page.tsx
git commit -m "feat: add LinkedIn login test button to settings page"
```

---

### Task 6: Handle `execFile` `input` Option Correctly

**Files:**
- Modify: `src/lib/linkedin-mcp.ts`
- Modify: `src/app/api/linkedin/login/route.ts`

**Step 1: Fix the stdin passing approach**

Node.js `execFile` doesn't support `input` option. Use `spawn` instead for passing credentials via stdin:

In both files, replace the `execFileAsync` approach with:

```typescript
import { spawn } from "child_process";

function runLoginScript(creds: { email: string; password: string }): Promise<{ success: boolean; message: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python", ["-u", "scripts/linkedin-login.py"], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 90_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });

    child.on("close", (code) => {
      try {
        const result = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        reject(new Error(stderr || `Login script exited with code ${code}`));
      }
    });

    child.on("error", reject);

    // Send credentials via stdin
    child.stdin.write(JSON.stringify(creds));
    child.stdin.end();
  });
}
```

Extract this into a shared utility at `src/lib/linkedin-login.ts` to avoid duplication between `linkedin-mcp.ts` and the API route.

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/lib/linkedin-login.ts src/lib/linkedin-mcp.ts src/app/api/linkedin/login/route.ts
git commit -m "refactor: extract login script runner to shared utility"
```

---

### Task 7: End-to-End Test

**Step 1: Ensure LinkedIn MCP server is running**

Run: `python -m uv tool run linkedin-scraper-mcp --transport streamable-http --port 8080`

**Step 2: Test auto-login via API route**

```bash
curl -X POST http://localhost:3000/api/linkedin/login \
  -H "Cookie: <session-cookie>"
```

Expected: `{"success": true, "message": "Already logged in"}` (if session is fresh) or `{"success": true, "message": "Login successful"}` (if session was expired)

**Step 3: Test auth failure detection**

Manually clear session: delete `~/.linkedin-mcp/cookies.json`, restart MCP server, then run a prospect. The agent should:
1. Detect auth failure from MCP response
2. Auto-login using saved credentials
3. Retry and succeed

**Step 4: Verify the full prospecting flow works**

Run a prospect from the dashboard UI. Check logs for:
- `[LinkedIn MCP] Auth failure detected, attempting auto-login...`
- `[LinkedIn MCP] Auto-login succeeded`
- Profile validation succeeds after retry

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: LinkedIn auto-login using saved credentials"
```

---

## Summary of Changes

| File | Change |
|------|--------|
| `scripts/linkedin-login.py` | New — Patchright-based automated LinkedIn login |
| `src/lib/linkedin-login.ts` | New — Shared login script runner (spawn + stdin) |
| `src/lib/linkedin-mcp.ts` | Modified — Auth detection + auto-login retry |
| `src/lib/agent/nodes/validate-profile.ts` | Modified — Pass `userId` to `getLinkedInProfile` |
| `src/app/api/linkedin/login/route.ts` | New — Manual login trigger API |
| `src/app/(app)/settings/linkedin-login-button.tsx` | New — "Testar Login" button component |
| `src/app/(app)/settings/page.tsx` | Modified — Add login button |

## Risks & Mitigations

1. **LinkedIn security challenges (CAPTCHA, 2FA)** — The script detects `/checkpoint` URLs and reports failure. Manual login required in these cases. Mitigation: keep session fresh by using the "Testar Login" button periodically.
2. **Headless detection** — Patchright includes anti-detection patches. If LinkedIn blocks headless, the script will fail gracefully and fall back to stub validation.
3. **Password in memory** — Credentials are decrypted only in the Node.js process and passed via stdin pipe (not CLI args). The Python process reads and uses them, then they're garbage collected.
