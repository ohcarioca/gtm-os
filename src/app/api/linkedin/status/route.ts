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
