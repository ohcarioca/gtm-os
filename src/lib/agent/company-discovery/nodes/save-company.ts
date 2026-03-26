import { CompanyDiscoveryStateType } from "../state";
import { createClient } from "@supabase/supabase-js";

interface CompanyAnalysis {
  name: string;
  sector: string;
  size: string | null;
  description: string | null;
  products: string[];
  tech_stack: string[];
  hiring_status: boolean;
  icp_score: number;
  icp_justification: string;
  contact_email: string | null;
  contact_phone: string | null;
  employee_count: string | null;
  linkedin_url: string | null;
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function saveCompany(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "save_company", message: "", timestamp: new Date().toISOString() };

  if (!state.currentUrl || !state.currentMarkdown) {
    return {
      log: [{ ...log, message: "Sem dados de empresa para salvar" }],
    };
  }

  const domain = extractDomain(state.currentUrl);

  let analysis: CompanyAnalysis;
  try {
    analysis = JSON.parse(state.currentMarkdown);
  } catch {
    return {
      currentUrl: null,
      currentMarkdown: null,
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `JSON inválido da análise de ${extractDomain(state.currentUrl)} — pulando` }],
    };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Check for duplicate by website URL (using domain match)
    const { data: existing } = await supabase
      .from("prospect_companies")
      .select("id")
      .eq("user_id", state.userId)
      .ilike("website", `%${domain}%`)
      .limit(1)
      .single();

    if (existing) {
      return {
        currentUrl: null,
        currentMarkdown: null,
        log: [{ ...log, message: `${analysis.name} já existe na base — pulando` }],
      };
    }

    // Also check by normalized name
    const { data: nameMatch } = await supabase
      .from("prospect_companies")
      .select("id")
      .eq("user_id", state.userId)
      .ilike("name", analysis.name.trim())
      .limit(1)
      .single();

    if (nameMatch) {
      return {
        currentUrl: null,
        currentMarkdown: null,
        log: [{ ...log, message: `${analysis.name} já existe (por nome) — pulando` }],
      };
    }

    const { error } = await supabase.from("prospect_companies").insert({
      user_id: state.userId,
      name: analysis.name,
      website: state.currentUrl,
      sector: analysis.sector,
      size: analysis.size,
      region: state.region,
      description: analysis.description,
      products: Array.isArray(analysis.products) ? analysis.products.join(", ") : analysis.products,
      tech_stack: Array.isArray(analysis.tech_stack) ? analysis.tech_stack.join(", ") : analysis.tech_stack,
      hiring_status: analysis.hiring_status ? "hiring" : "not_hiring",
      icp_score: analysis.icp_score,
      icp_justification: analysis.icp_justification,
      company_markdown: state.currentMarkdown,
      linkedin_url: analysis.linkedin_url,
      source: "serper",
      status: "new",
    });

    if (error) {
      console.error("[save-company] Insert error:", error);
      return {
        currentUrl: null,
        currentMarkdown: null,
        errorRetries: state.errorRetries + 1,
        log: [{ ...log, message: `Erro ao salvar ${analysis.name}: ${error.message}` }],
      };
    }

    const newSaved = state.companiesSaved + 1;

    return {
      currentUrl: null,
      currentMarkdown: null,
      companiesSaved: newSaved,
      log: [{ ...log, message: `Empresa salva: ${analysis.name} — ICP ${analysis.icp_score}/100 (${newSaved}/${state.quantity})` }],
    };
  } catch (err) {
    console.error("[save-company] Error:", err);
    return {
      currentUrl: null,
      currentMarkdown: null,
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro ao salvar empresa: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
