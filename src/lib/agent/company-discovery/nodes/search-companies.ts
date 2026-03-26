import { CompanyDiscoveryStateType } from "../state";
import { googleSearch } from "@/lib/google-search";
import { createClient } from "@supabase/supabase-js";

const BLOCKED_DOMAINS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "glassdoor.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
];

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function isBlockedDomain(url: string): boolean {
  const domain = extractDomain(url);
  return BLOCKED_DOMAINS.some((blocked) => domain.includes(blocked));
}

async function getExistingDomains(userId: string): Promise<Set<string>> {
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data } = await supabase
      .from("prospect_companies")
      .select("website")
      .eq("user_id", userId)
      .not("website", "is", null);

    if (!data) return new Set();
    return new Set(data.map((row) => extractDomain(row.website)));
  } catch {
    return new Set();
  }
}

export async function searchCompanies(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "search_companies", message: "", timestamp: new Date().toISOString() };

  try {
    // Fetch existing company domains from DB to skip duplicates early
    const existingDomains = await getExistingDomains(state.userId);

    const seenDomains = new Set<string>(
      state.companiesProcessed.map((url) => extractDomain(url))
    );
    const pending: { url: string; title: string; snippet: string }[] = [];
    let skippedExisting = 0;

    for (const query of state.searchQueries) {
      const results = await googleSearch(query, state.userId);

      for (const result of results) {
        if (isBlockedDomain(result.link)) continue;

        const domain = extractDomain(result.link);
        if (seenDomains.has(domain)) continue;

        seenDomains.add(domain);

        // Skip domains that already exist in prospect_companies
        if (existingDomains.has(domain)) {
          skippedExisting++;
          continue;
        }

        pending.push({ url: result.link, title: result.title, snippet: result.snippet });
      }
    }

    if (pending.length === 0) {
      return {
        pendingUrls: [],
        searchRetries: state.searchRetries + 1,
        log: [{ ...log, message: `Nenhuma URL nova encontrada${skippedExisting > 0 ? ` (${skippedExisting} já existem na base)` : ""} (tentativa ${state.searchRetries + 1})` }],
      };
    }

    return {
      pendingUrls: pending,
      log: [{ ...log, message: `Encontradas ${pending.length} URLs de empresas para analisar${skippedExisting > 0 ? ` (${skippedExisting} já existem na base)` : ""}` }],
    };
  } catch (err) {
    console.error("[search-companies] Error:", err);
    return {
      pendingUrls: [],
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na busca: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
