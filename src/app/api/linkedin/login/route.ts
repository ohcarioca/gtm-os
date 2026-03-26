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
