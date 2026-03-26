import { AgentStateType } from "../state";
import { getProfile, LinkedInAuthError, LinkedInLimitError } from "@/lib/linkedin-playwright";

export async function validateProfile(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const log = { step: "validate_profile", message: "", timestamp: new Date().toISOString() };
  const dm = state.currentDecisionMaker;

  if (!dm?.linkedinUrl) {
    return {
      currentValidation: { photo: false, connections: false, role_match: false, activity: false, experience_match: false },
      searchRetries: state.searchRetries + 1,
      log: [{ ...log, message: "Perfil sem URL do LinkedIn, pulando." }],
    };
  }

  try {
    const profile = await getProfile(dm.linkedinUrl, state.userId, state.targetRoles);

    if (!profile) {
      return {
        currentValidation: { photo: true, connections: true, role_match: true, activity: true, experience_match: true },
        log: [{ ...log, message: "Limite LinkedIn atingido, usando dados da busca." }],
      };
    }

    const roleMatchTerms = state.targetRoles.map((r) => r.toLowerCase());
    const profileRole = (profile.role || dm.role || "").toLowerCase();
    const roleMatch = roleMatchTerms.some(
      (term) => profileRole.includes(term) || term.includes(profileRole.split(" ")[0])
    );

    // Check if lead's current company matches the search company
    const searchCompany = state.currentCompany?.name?.toLowerCase().trim() ?? "";
    const profileCompany = (profile.company || "").toLowerCase().trim();
    const companyMismatch = searchCompany && profileCompany &&
      !profileCompany.includes(searchCompany) && !searchCompany.includes(profileCompany);
    const isCompanyFirst = state.targetCompanies.length > 0;

    const validation = {
      photo: !!profile.name,
      connections: profile.connections > 50,
      role_match: roleMatch,
      activity: profile.isRecentlyActive,
      experience_match: profile.experienceMatchesICP,
      company_match: !(isCompanyFirst && companyMismatch),
    };

    const enrichedDm = {
      ...dm,
      name: profile.name || dm.name,
      role: profile.role || dm.role,
      company: profile.company || dm.company,
      connections: profile.connections,
      about: profile.about,
      email: profile.contactEmail || dm.email,
      phone: profile.contactPhone || dm.phone,
      lastActivityDate: profile.lastActivityDate,
    };

    // Valid = has name + (active OR experience matches ICP) + company matches (in company-first mode)
    const isValid = validation.photo && (validation.activity || validation.experience_match)
      && validation.company_match;

    const details = [
      `nome=${validation.photo ? "ok" : "no"}`,
      `atividade=${validation.activity ? "recente" : "inativa"}`,
      `cargo_icp=${validation.experience_match ? "sim" : "não"}`,
      `conexões=${profile.connections}`,
    ].join(", ");

    log.message = isValid
      ? `Validado: ${profile.name} — ${profile.role} @ ${profile.company} (${details})`
      : isCompanyFirst && companyMismatch
        ? `Rejeitado: ${profile.name} — empresa atual é ${profile.company}, não trabalha mais em ${state.currentCompany?.name} (${details})`
        : `Rejeitado: ${profile.name} (${details})`;

    if (profile.currentExperience) {
      log.message += ` | Experiência atual: ${profile.currentExperience}`;
    }

    return {
      currentValidation: validation,
      currentDecisionMaker: enrichedDm,
      log: [log],
    };
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

    console.error("[validate-profile] Error:", err);
    return {
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro na validação: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
