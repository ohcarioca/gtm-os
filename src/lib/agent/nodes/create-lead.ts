import { AgentStateType } from "../state";
import { createClient } from "@supabase/supabase-js";

export async function createLead(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "create_lead", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;
  const company = state.currentCompany;
  const score = state.currentScore;

  if (!dm || !company) {
    return {
      log: [{ ...log, message: "Dados insuficientes para criar lead." }],
    };
  }

  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const message = state.currentScore?.message ?? "";

    const total = score?.total ?? 0;
    const letterGrade = total >= 90 ? "A+" : total >= 80 ? "A" : total >= 70 ? "B" : "C";

    const { data: companyRow } = await supabase
      .from("companies")
      .insert({
        user_id: state.userId,
        name: company.name,
        website: company.website,
        linkedin_url: company.linkedinUrl,
        metadata: company.metadata ?? {},
      })
      .select("id")
      .single();

    if (!companyRow) {
      throw new Error("Failed to create company");
    }

    await supabase.from("leads").insert({
      user_id: state.userId,
      company_id: companyRow.id,
      name: dm.name,
      role: dm.role,
      linkedin_url: dm.linkedinUrl,
      email: dm.email ?? null,
      phone: dm.phone ?? null,
      score: letterGrade,
      stage: "identified",
      message: message.slice(0, 300),
      connections: dm.connections ?? null,
      recent_activity: state.currentValidation?.activity ?? false,
      validation: state.currentValidation,
      metadata: {
        scoring: score,
        about: dm.about,
        lastActivityDate: dm.lastActivityDate,
      },
    });

    await supabase
      .from("agent_runs")
      .update({
        leads_found: state.leadsCreated + 1,
        leads_approved: state.leadsCreated + 1,
      })
      .eq("id", state.runId);

    log.message = `Lead criado: ${dm.name} - ${dm.role} @ ${company.name} (${letterGrade}, ${total}pts)`;

    return {
      currentCompany: null,
      currentDecisionMaker: null,
      currentValidation: null,
      currentScore: null,
      leadsCreated: state.leadsCreated + 1,
      log: [log],
    };
  } catch (err) {
    console.error("[create-lead] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro ao criar lead: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
