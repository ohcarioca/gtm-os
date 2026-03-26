import { z } from "zod";
import { CompanyDiscoveryStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const queriesSchema = z.object({
  queries: z.array(z.string()).min(1).max(10),
});

export async function buildQueries(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "build_queries", message: "", timestamp: new Date().toISOString() };

  try {
    const icpBlock = state.companyProfile
      ? `
OUR COMPANY (the one selling):
- Name: ${state.companyProfile.name}
- Sector: ${state.companyProfile.sector}
- Value proposition: ${state.companyProfile.value_proposition}
- ICP (who we sell to): ${state.companyProfile.icp}`
      : "";

    const prompt = `You are a Google search expert. Generate search queries to find SPECIFIC COMPANIES that match the criteria below.

TARGET COMPANIES WE'RE LOOKING FOR:
- Sector: ${state.sector}
- Region: ${state.region}
- Company sizes: ${state.sizes.length > 0 ? state.sizes.join(", ") + " employees" : "any"}
- Keywords: ${state.keywords.length > 0 ? state.keywords.join(", ") : "none"}
- Additional context: ${state.freeText || "none"}
${icpBlock}
- Already found: ${state.companiesProcessed.length} companies (need variety)

Generate 8-10 Google search queries that will return COMPANY WEBSITES (not LinkedIn, not blogs, not directories).

CRITICAL RULES:
- NEVER use site:linkedin.com or site:facebook.com
- Queries must find actual company homepages
- Use SPECIFIC terms from the sector, not generic ones
- Include company-finding patterns like:
  - "lista de [tipo de empresa] em [cidade]"
  - "[tipo de empresa] [cidade] site oficial"
  - "[setor] [região] clientes cases"
  - "melhores [tipo] [região] 2025 2026"
  - "[keyword específico] empresa [cidade]"
  - English: "[sector] companies [region]"
- Mix Portuguese and English queries
- Use city/state names from the region field
- If ICP mentions specific characteristics, include them in queries

BAD queries (too generic): "empresas brasil", "technology companies"
GOOD queries (specific): "provedores de internet fibra óptica interior SP", "ISP regional sul do brasil clientes"

Return JSON: {"queries": ["query1", "query2", ...]}`;

    const result = await callClaudeJSON(prompt, queriesSchema, { timeout: 60_000, model: "haiku" });

    // Log each query so user can see what's being searched
    const queryList = result.queries.map((q, i) => `  ${i + 1}. ${q}`).join("\n");
    log.message = `${result.queries.length} queries geradas:\n${queryList}`;

    return {
      searchQueries: result.queries,
      log: [log],
    };
  } catch (err) {
    console.error("[build-queries] Query generation failed, using fallback:", err);

    const terms = state.keywords.length > 0 ? state.keywords.join(" ") : state.sector;
    const fallbackQueries = [
      `"${state.sector}" empresas "${state.region}" site oficial`,
      `lista "${terms}" "${state.region}" 2025`,
      `${terms} empresa ${state.region}`,
      `melhores "${state.sector}" "${state.region}"`,
      `"${terms}" companies "${state.region}"`,
    ];

    return {
      searchQueries: fallbackQueries,
      log: [{ ...log, message: `Usando queries de fallback:\n${fallbackQueries.map((q, i) => `  ${i + 1}. ${q}`).join("\n")}` }],
    };
  }
}
