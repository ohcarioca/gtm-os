import { createClient } from "@supabase/supabase-js";
import { decrypt } from "@/lib/encryption";

interface GoogleSearchResult {
  title: string;
  link: string;
  snippet: string;
}

async function getSerperKey(userId: string): Promise<string> {
  // Try DB first
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data } = await supabase
    .from("api_keys")
    .select("encrypted_key")
    .eq("user_id", userId)
    .eq("service", "serper")
    .single();

  if (data) {
    return decrypt(data.encrypted_key);
  }

  // Fallback to .env
  const envKey = process.env.SERPER_API_KEY;
  if (envKey) return envKey;

  throw new Error("SERPER_API_KEY not configured. Add it in Settings > Integrations.");
}

export async function googleSearch(query: string, userId?: string): Promise<GoogleSearchResult[]> {
  const apiKey = userId ? await getSerperKey(userId) : process.env.SERPER_API_KEY;

  if (!apiKey) {
    throw new Error("SERPER_API_KEY must be set");
  }

  const response = await fetch("https://google.serper.dev/search", {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      gl: "br",
      hl: "pt",
      num: 10,
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(`Serper API error: ${data.message ?? response.statusText}`);
  }

  return (data.organic ?? []).map((item: Record<string, string>) => ({
    title: item.title ?? "",
    link: item.link ?? "",
    snippet: item.snippet ?? "",
  }));
}
