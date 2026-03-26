# LinkedIn Auth Modal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When LinkedIn auto-login fails during prospecting, stop the pipeline and show a modal asking the user to login manually. After successful login, let the user restart prospecting.

**Architecture:** Add a `LinkedInAuthError` exception class to distinguish auth failures from other MCP errors. `validate-profile` catches it, emits a special `linkedin_auth_required` log step, and forces pipeline stop via max retries. `agent-feed` detects this step and shows a login modal using the existing `/api/linkedin/login` endpoint.

**Tech Stack:** Next.js, shadcn/ui Dialog, existing LinkedIn login API

---

### Task 1: Add LinkedInAuthError to linkedin-mcp.ts

**Files:**
- Modify: `src/lib/linkedin-mcp.ts:1-16` (add error class after imports)
- Modify: `src/lib/linkedin-mcp.ts:113-115` (throw instead of return null)

**Step 1: Add error class after the interface definition**

After line 16 (closing `}` of `LinkedInProfileData`), add:

```typescript
export class LinkedInAuthError extends Error {
  constructor() {
    super("LinkedIn authentication failed");
    this.name = "LinkedInAuthError";
  }
}
```

**Step 2: Throw LinkedInAuthError when auto-login fails**

Replace lines 114-115:
```typescript
      console.warn("[LinkedIn MCP] Auto-login failed, falling back to stub");
      return null;
```

With:
```typescript
      console.warn("[LinkedIn MCP] Auto-login failed, requesting manual login");
      throw new LinkedInAuthError();
```

**Step 3: Verify build compiles**

Run: `npx next build 2>&1 | head -20` (or `npm run build`)
Expected: No TypeScript errors in linkedin-mcp.ts

**Step 4: Commit**

```bash
git add src/lib/linkedin-mcp.ts
git commit -m "feat: add LinkedInAuthError for manual login flow"
```

---

### Task 2: Handle LinkedInAuthError in validate-profile

**Files:**
- Modify: `src/lib/agent/nodes/validate-profile.ts`

**Step 1: Import LinkedInAuthError**

Add to imports at top of file:
```typescript
import { getLinkedInProfile, LinkedInAuthError } from "@/lib/linkedin-mcp";
```

**Step 2: Wrap the MCP call in try-catch for LinkedInAuthError**

Replace the block starting at line 55 (`const profile = await getLinkedInProfile(...)`) through the fallback section (line 131). The full replacement:

```typescript
  let profile: Awaited<ReturnType<typeof getLinkedInProfile>> = null;
  try {
    profile = await getLinkedInProfile(linkedinUrl, state.userId);
  } catch (error) {
    if (error instanceof LinkedInAuthError) {
      return {
        currentValidation: null,
        retries: 999, // force pipeline stop
        log: [{
          step: "linkedin_auth_required",
          message: "Sessão do LinkedIn expirou. Faça login manual para continuar.",
          timestamp: new Date().toISOString(),
        }],
      };
    }
    // Re-throw unexpected errors
    throw error;
  }

  if (profile) {
    // ... (keep existing profile handling code exactly as-is, lines 58-112)
  }

  // Fallback: MCP unavailable, use stub behavior
  // ... (keep existing fallback code exactly as-is, lines 116-131)
```

Key: Only the `try-catch` wrapping the MCP call is new. All existing profile handling and fallback code stays unchanged.

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add src/lib/agent/nodes/validate-profile.ts
git commit -m "feat: stop pipeline on LinkedIn auth failure with auth_required log"
```

---

### Task 3: Create LinkedIn login modal component

**Files:**
- Create: `src/components/linkedin-login-modal.tsx`

**Step 1: Create the modal component**

```typescript
"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface LinkedInLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function LinkedInLoginModal({ open, onOpenChange, onSuccess }: LinkedInLoginModalProps) {
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
        setTimeout(() => {
          onSuccess();
          onOpenChange(false);
          setStatus("idle");
          setMessage("");
        }, 1500);
      } else {
        setStatus("error");
        setMessage(data.message || "Falha no login");
      }
    } catch {
      setStatus("error");
      setMessage("Erro de conexão com o servidor");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sessão do LinkedIn expirou</DialogTitle>
          <DialogDescription>
            O login automático falhou. Clique abaixo para reconectar usando suas credenciais salvas.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {status === "success" && (
            <p className="text-sm text-green-600">{message}</p>
          )}
          {status === "error" && (
            <p className="text-sm text-red-600">{message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={status === "loading"}>
            Fechar
          </Button>
          <Button onClick={handleLogin} disabled={status === "loading" || status === "success"}>
            {status === "loading" ? "Conectando..." : "Reconectar LinkedIn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 2: Verify build compiles**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/linkedin-login-modal.tsx
git commit -m "feat: add LinkedIn login modal for expired session"
```

---

### Task 4: Wire modal into agent-feed

**Files:**
- Modify: `src/components/agent-feed.tsx`

**Step 1: Add import and state for modal**

Add to imports:
```typescript
import { LinkedInLoginModal } from "@/components/linkedin-login-modal";
import { AlertTriangle } from "lucide-react";
```

Add `linkedin_auth_required` to `stepConfig`:
```typescript
  linkedin_auth_required: { icon: AlertTriangle, bg: "bg-red-100", text: "text-red-600" },
```

**Step 2: Add modal state**

Inside `AgentFeed` component, after existing state:
```typescript
const [showLoginModal, setShowLoginModal] = useState(false);
```

**Step 3: Detect auth_required in SSE stream**

In the `read()` function, after extracting log entries (line 79), add detection:

```typescript
if (nodeData?.log) {
  const logs = nodeData.log as LogEntry[];
  setEntries((prev) => [...prev, ...logs]);
  // Detect LinkedIn auth failure
  if (logs.some((l) => l.step === "linkedin_auth_required")) {
    setShowLoginModal(true);
  }
}
```

**Step 4: Render the modal**

At the end of the component JSX, just before the closing `</Card>`, add:

```typescript
<LinkedInLoginModal
  open={showLoginModal}
  onOpenChange={setShowLoginModal}
  onSuccess={() => setShowLoginModal(false)}
/>
```

**Step 5: Verify build compiles and test manually**

Run: `npm run build`
Expected: No errors

Manual test:
1. Stop LinkedIn MCP server (or let session expire)
2. Start a prospection
3. Expected: agent log shows "Sessão do LinkedIn expirou" with red icon
4. Expected: modal pops up with "Reconectar LinkedIn" button
5. Click button → calls `/api/linkedin/login` → shows success/error
6. After success, modal closes

**Step 6: Commit**

```bash
git add src/components/agent-feed.tsx
git commit -m "feat: show LinkedIn login modal when session expires during prospecting"
```

---

### Task 5: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add linkedin-login-modal.tsx to Architecture tree**

Under `src/components/`, add:
```
│   ├── linkedin-login-modal.tsx  # LinkedIn re-login modal (triggered by agent)
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add linkedin-login-modal to architecture tree"
```
