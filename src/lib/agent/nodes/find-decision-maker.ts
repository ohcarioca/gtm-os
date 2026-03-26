import { googleSearch } from "@/lib/google-search";
import { createClient } from "@supabase/supabase-js";
import type { AgentStateType } from "../state";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeLinkedInUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `https://www.linkedin.com${parsed.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

async function getExistingLinkedInUrls(
  userId: string,
  urls: string[]
): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const { data } = await supabase
    .from("leads")
    .select("linkedin_url")
    .eq("user_id", userId)
    .in("linkedin_url", urls);
  return new Set((data ?? []).map((r) => r.linkedin_url as string));
}

export async function findDecisionMaker(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  if (!state.currentCompany) {
    return {
      currentDecisionMaker: null,
      log: [{
        step: "find_decision_maker",
        message: "No company to search for",
        timestamp: new Date().toISOString(),
      }],
    };
  }

  const companyName = state.currentCompany.name;
  const roles = state.targetRoles.join('" OR "');
  const query = `site:linkedin.com/in "${companyName}" "${roles}"`;

  const results = await googleSearch(query, state.userId);

  // Normalize all LinkedIn URLs and batch-check for duplicates
  const linkedInResults = results
    .filter((r) => r.link?.includes("linkedin.com/in/"))
    .map((r) => ({
      ...r,
      normalizedUrl: normalizeLinkedInUrl(r.link),
    }));

  const allUrls = linkedInResults.map((r) => r.normalizedUrl);
  const existingUrls = await getExistingLinkedInUrls(state.userId, allUrls);

  // Find first non-duplicate
  for (const profile of linkedInResults) {
    if (existingUrls.has(profile.normalizedUrl)) continue;

    const name = profile.title
      ?.replace(/ - LinkedIn$/, "")
      .replace(/ \|.*$/, "")
      .trim() ?? "Unknown";

    return {
      currentDecisionMaker: {
        name,
        role: "",
        linkedinUrl: profile.normalizedUrl,
        company: companyName,
      },
      searchRetries: 0,
      log: [{
        step: "find_decision_maker",
        message: `Found: ${name} at ${companyName}`,
        timestamp: new Date().toISOString(),
      }],
    };
  }

  return {
    currentDecisionMaker: null,
    searchRetries: state.searchRetries + 1,
    log: [{
      step: "find_decision_maker",
      message: `No new decision makers for ${companyName} (${existingUrls.size} duplicates skipped)`,
      timestamp: new Date().toISOString(),
    }],
  };
}
