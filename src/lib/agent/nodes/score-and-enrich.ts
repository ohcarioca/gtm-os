import { z } from "zod";
import { AgentStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";
import { createClient } from "@supabase/supabase-js";

const scoreAndEnrichSchema = z.object({
  score: z.object({
    total: z.number().min(0).max(100),
    dimensions: z.object({
      company_fit: z.number().min(0).max(30),
      role_fit: z.number().min(0).max(30),
      seniority: z.number().min(0).max(20),
      activity: z.number().min(0).max(20),
    }),
    justification: z.string(),
  }),
  enrichment: z.object({
    description: z.string(),
    sector: z.string(),
    employee_count: z.number().nullable(),
    products: z.array(z.string()),
    tech_stack: z.array(z.string()),
    is_hiring: z.boolean().nullable(),
    contact_email: z.string().nullable(),
    contact_phone: z.string().nullable(),
  }),
  message: z.string(),
});

async function fetchCompanyMarkdown(
  companyName: string,
  userId: string
): Promise<string | null> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Try exact match first
  const { data: exact } = await supabase
    .from("prospect_companies")
    .select("company_markdown")
    .eq("user_id", userId)
    .ilike("name", companyName)
    .not("company_markdown", "is", null)
    .limit(1)
    .single();

  if (exact?.company_markdown) return exact.company_markdown;

  // Fallback: fuzzy match by substring (e.g. "Acerto" matches "Acerto Cobrança")
  const { data: fuzzy } = await supabase
    .from("prospect_companies")
    .select("company_markdown")
    .eq("user_id", userId)
    .ilike("name", `%${companyName}%`)
    .not("company_markdown", "is", null)
    .limit(1)
    .single();

  return fuzzy?.company_markdown ?? null;
}

export async function scoreAndEnrich(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "score_and_enrich", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;
  const company = state.currentCompany;
  const validation = state.currentValidation;

  if (!dm || !company) {
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: "Dados insuficientes para scoring/enriquecimento." }],
    };
  }

  try {
    // Fetch pre-scraped company markdown from discovery
    const companyMarkdown = await fetchCompanyMarkdown(company.name, state.userId);

    // Detect company mismatch (LinkedIn company vs search company)
    const actualCompany = dm.company || company.name;
    const searchCompany = company.name;
    const companyChanged = actualCompany && searchCompany &&
      actualCompany.toLowerCase() !== searchCompany.toLowerCase() &&
      !actualCompany.toLowerCase().includes(searchCompany.toLowerCase()) &&
      !searchCompany.toLowerCase().includes(actualCompany.toLowerCase());

    const prompt = `Score this B2B lead (0-100) AND enrich the company data in a single analysis.

SEGMENT CRITERIA:
- Target roles: ${state.targetRoles.join(", ")}
- Company sizes: ${state.companySizeTargets.join(", ")}
- Region: ${state.region}
${state.companyProfile ? `- ICP: ${state.companyProfile.icp}\n- Sector: ${state.companyProfile.sector}\n- Value proposition: ${state.companyProfile.value_proposition}` : ""}

LEAD DATA:
- Name: ${dm.name}
- Role: ${dm.role}
- Current company (from LinkedIn): ${actualCompany}${companyChanged ? `\n- IMPORTANT: This lead was found searching for "${searchCompany}" but their CURRENT company is "${actualCompany}". Score based on their CURRENT company, not the search company. If the current company doesn't match the ICP, company_fit should be LOW.` : ""}
- Connections: ${dm.connections ?? "unknown"}
- About: ${dm.about ?? "N/A"}
- Recently active: ${validation?.activity ?? "unknown"}

${companyMarkdown ? `COMPANY WEBSITE DATA (scraped):\n${companyMarkdown}\n` : "No company website data available — enrich with what you can infer from the lead data above."}

SCORING DIMENSIONS:
1. company_fit (0-30): Does the company match the ICP? Sector, size, relevance.${!companyChanged ? `\n   IMPORTANT: This company comes from the user's pre-approved prospect list — it was already vetted and approved as an ICP match. Unless the lead's CURRENT company is different from the search company (see company mismatch above), company_fit should be HIGH (25-30).` : ""}
2. role_fit (0-30): Does the role match target roles? Exact match = high, related = medium.
3. seniority (0-20): Is this person a decision-maker? Connections > 500 is a strong signal.
4. activity (0-20): Is the person active on LinkedIn? Active = higher chance of response.

ENRICHMENT: Extract from the company website data (if available):
- description: Brief company description
- sector: Industry/sector
- employee_count: Number of employees (null if unknown)
- products: List of main products/services
- tech_stack: Technologies used (null/empty if unknown)
- is_hiring: Whether they're hiring (null if unknown)
- contact_email: General contact email (null if not found)
- contact_phone: General contact phone (null if not found)

MESSAGE RULES:
- Max 300 characters, in Portuguese (Brazil)
- Professional but friendly tone
- Mention something specific about the person or their company
- Clear value hook${state.companyProfile ? `\n- My company: ${state.companyProfile.name} — ${state.companyProfile.value_proposition}` : ""}
- No excessive emojis

Return JSON with:
- score: { total (sum of dimensions), dimensions (each score), justification (1-2 sentences in Portuguese) }
- enrichment: { description, sector, employee_count, products, tech_stack, is_hiring, contact_email, contact_phone }
- message: the LinkedIn message`;

    const result = await callClaudeJSON(prompt, scoreAndEnrichSchema, { timeout: 60_000, model: "sonnet" });

    log.message = `Score: ${result.score.total}/100 — ${result.score.justification}. Empresa: ${result.enrichment.sector || "setor desconhecido"}`;

    return {
      currentScore: {
        total: result.score.total,
        dimensions: result.score.dimensions,
        justification: result.score.justification,
        message: result.message,
      },
      currentCompany: {
        ...company,
        metadata: {
          ...(company.metadata ?? {}),
          enrichment: {
            description: result.enrichment.description,
            sector: result.enrichment.sector,
            employeeCount: result.enrichment.employee_count,
            products: result.enrichment.products,
            techStack: result.enrichment.tech_stack,
            isHiring: result.enrichment.is_hiring,
            contactEmail: result.enrichment.contact_email,
            contactPhone: result.enrichment.contact_phone,
            enrichedAt: new Date().toISOString(),
          },
        },
      },
      currentDecisionMaker: {
        ...dm,
        email: dm.email || result.enrichment.contact_email,
        phone: dm.phone || result.enrichment.contact_phone,
      },
      log: [log],
    };
  } catch (err) {
    console.error("[score-and-enrich] Error:", err);
    return {
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: `Erro no scoring/enriquecimento: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
