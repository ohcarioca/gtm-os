import { AgentStateType } from "../state";
import { googleSearch } from "@/lib/google-search";
import { searchPeople, searchCompanyPeople, LinkedInAuthError, LinkedInLimitError } from "@/lib/linkedin-playwright";
import { createClient } from "@supabase/supabase-js";

function normalizeLinkedInUrl(url: string): string {
  const match = url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/);
  if (!match) return url;
  return `https://www.linkedin.com/in/${match[1].toLowerCase().replace(/\/+$/, "")}`;
}

async function loadProcessedUrls(userId: string): Promise<Set<string>> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const [{ data: leads }, { data: rejected }] = await Promise.all([
    supabase.from("leads").select("linkedin_url").eq("user_id", userId),
    supabase.from("rejected_leads").select("linkedin_url").eq("user_id", userId),
  ]);

  const urls = new Set<string>();
  for (const l of leads ?? []) if (l.linkedin_url) urls.add(l.linkedin_url);
  for (const r of rejected ?? []) if (r.linkedin_url) urls.add(r.linkedin_url);
  return urls;
}

export async function findLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "find_lead", message: "", timestamp: new Date().toISOString() };

  try {
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
    // Tries ALL target roles in sequence, then searches without keywords for general analysis
    if (targetCompany.linkedinUrl) {
      const logs: Array<{ step: string; message: string; timestamp: string }> = [];

      // Step 1: Try each target role on company people page
      for (const searchRole of state.targetRoles) {
        logs.push({ step: "company_people_search", message: `[Company People] Buscando "${searchRole}" na página de ${targetCompany.name}...`, timestamp: new Date().toISOString() });

        const candidates = await searchCompanyPeople(
          targetCompany.linkedinUrl,
          searchRole,
          state.userId
        );

        for (const candidate of candidates) {
          const url = normalizeLinkedInUrl(candidate.linkedinUrl);
          if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
          return buildFoundResult(candidate, "Company People", logs);
        }

        logs.push({ step: "company_people_search", message: `[Company People] Nenhum "${searchRole}" novo em ${targetCompany.name}`, timestamp: new Date().toISOString() });
      }

      // Step 2: Search without keywords — analyze all profiles for relevance
      logs.push({ step: "company_people_search", message: `[Company People] Buscando perfis gerais na página de ${targetCompany.name}...`, timestamp: new Date().toISOString() });

      const generalCandidates = await searchCompanyPeople(
        targetCompany.linkedinUrl,
        "",
        state.userId
      );

      for (const candidate of generalCandidates) {
        const url = normalizeLinkedInUrl(candidate.linkedinUrl);
        if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
        return buildFoundResult(candidate, "Company People (análise geral)", logs);
      }

      // Step 3: Fallback to generic LinkedIn search
      logs.push({ step: "company_people_search", message: `[Company People] Nenhum perfil relevante em ${targetCompany.name}, tentando LinkedIn Search...`, timestamp: new Date().toISOString() });

      const fallbackCandidates = await searchPeople(
        `${role} ${targetCompany.name}`,
        state.linkedinOnly ? undefined : state.region,
        state.userId
      );

      for (const candidate of fallbackCandidates) {
        const url = normalizeLinkedInUrl(candidate.linkedinUrl);
        if (processedUrls.has(url) || state.companiesSearched.includes(url)) continue;
        return buildFoundResult(candidate, "LinkedIn Fallback", logs);
      }

      return buildAdvanceResult(logs);
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
  } catch (err) {
    if (err instanceof LinkedInAuthError) {
      return {
        errorRetries: 999,
        log: [{ ...log, message: "Sessão LinkedIn expirou. Faça login novamente." }],
      };
    }

    if (err instanceof LinkedInLimitError) {
      return {
        errorRetries: 999,
        log: [{ ...log, message: err.message }],
      };
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }

    console.error("[find-lead] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na busca: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
