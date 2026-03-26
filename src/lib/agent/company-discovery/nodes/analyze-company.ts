import { z } from "zod";
import { CompanyDiscoveryStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const analysisSchema = z.object({
  is_company: z.boolean(),
  name: z.string().optional(),
  sector: z.string().optional(),
  size: z.string().optional(),
  description: z.string().optional(),
  products: z.array(z.string()).optional(),
  tech_stack: z.array(z.string()).optional(),
  hiring_status: z.boolean().optional(),
  icp_score: z.number().min(0).max(100).optional(),
  icp_justification: z.string().optional(),
  // Enrichment fields
  contact_email: z.string().nullable().optional(),
  contact_phone: z.string().nullable().optional(),
  employee_count: z.string().nullable().optional(),
  linkedin_url: z.string().nullable().optional(),
});

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function analyzeCompany(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "analyze_company", message: "", timestamp: new Date().toISOString() };

  if (!state.currentUrl || !state.currentMarkdown) {
    return {
      log: [{ ...log, message: "Sem conteúdo para analisar" }],
    };
  }

  const domain = extractDomain(state.currentUrl);

  try {
    const icpContext = state.companyProfile
      ? `
ICP (Ideal Customer Profile):
- Our company: ${state.companyProfile.name}
- Our sector: ${state.companyProfile.sector}
- Value proposition: ${state.companyProfile.value_proposition}
- ICP description: ${state.companyProfile.icp}`
      : "";

    const prompt = `Analyze the following website content and determine if this is a company website.

URL: ${state.currentUrl}
Target sector: ${state.sector}
Target region: ${state.region}
Target sizes: ${state.sizes.length > 0 ? state.sizes.join(", ") : "any"}
Keywords: ${state.keywords.length > 0 ? state.keywords.join(", ") : "none"}
${icpContext}

Website content (markdown):
${state.currentMarkdown.slice(0, 8000)}

Determine:
1. Is this actually a company website (not a blog post, directory listing, job board, news article, etc.)?
2. If yes, extract company details.

If it IS a company website, set is_company=true and fill in all fields.
The icp_score (0-100) rates how well this company matches our target criteria:
- 80-100: Excellent match (right sector, size, region)
- 50-79: Partial match (some criteria match)
- 0-49: Poor match

If it is NOT a company website, set is_company=false only.

- linkedin_url: company LinkedIn page URL (e.g. "https://www.linkedin.com/company/acme-corp") or null if not found. Look for LinkedIn links in the page header, footer, or social media section.

Return JSON: {"is_company": bool, "name": "...", "sector": "...", "size": "...", "description": "...", "products": [...], "tech_stack": [...], "hiring_status": bool, "icp_score": N, "icp_justification": "...", "contact_email": "..." or null, "contact_phone": "..." or null, "employee_count": "50-200" or null, "linkedin_url": "..." or null}`;

    const result = await callClaudeJSON(prompt, analysisSchema, { timeout: 60_000, model: "sonnet" });

    if (!result.is_company) {
      return {
        currentUrl: null,
        currentMarkdown: null,
        log: [{ ...log, message: `${domain} não é um site de empresa — pulando` }],
      };
    }

    // Store the analysis as JSON in currentMarkdown for the save node
    const analysis = {
      name: result.name ?? domain,
      sector: result.sector ?? state.sector,
      size: result.size ?? null,
      description: result.description ?? null,
      products: result.products ?? [],
      tech_stack: result.tech_stack ?? [],
      hiring_status: result.hiring_status ?? false,
      icp_score: result.icp_score ?? 0,
      icp_justification: result.icp_justification ?? "",
      // Enrichment fields
      contact_email: result.contact_email ?? null,
      contact_phone: result.contact_phone ?? null,
      employee_count: result.employee_count ?? null,
      linkedin_url: result.linkedin_url ?? null,
    };

    return {
      currentMarkdown: JSON.stringify(analysis),
      log: [{ ...log, message: `Empresa identificada: ${analysis.name} (ICP score: ${analysis.icp_score})` }],
    };
  } catch (err) {
    console.error("[analyze-company] Error:", err);
    return {
      currentUrl: null,
      currentMarkdown: null,
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na análise de ${domain}: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
