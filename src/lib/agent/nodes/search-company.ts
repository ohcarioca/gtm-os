import { googleSearch } from "@/lib/google-search";
import type { AgentStateType } from "../state";

export async function searchCompany(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const sectorTerm = state.companyProfile?.sector ?? "";
  const query = `${sectorTerm} ${state.region} empresas`.trim();

  const results = await googleSearch(query, state.userId);
  const company = results.find(
    (r) => !state.companiesSearched.includes(r.title)
  );

  if (!company) {
    return {
      currentCompany: null,
      log: [
        {
          step: "search_company",
          message: "No new companies found",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  return {
    currentCompany: {
      name: company.title,
      website: company.link,
      linkedinUrl: null,
    },
    companiesSearched: [company.title],
    log: [
      {
        step: "search_company",
        message: `Found: ${company.title}`,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}
