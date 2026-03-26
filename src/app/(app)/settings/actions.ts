"use server";

import { createClient } from "@/lib/supabase/server";
import { encrypt } from "@/lib/encryption";
import { linkedinCredentialsSchema, companyProfileSchema } from "@/lib/validations/schemas";
import { revalidatePath } from "next/cache";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";

export async function saveLinkedInCredentials(formData: FormData) {
  const parsed = linkedinCredentialsSchema.safeParse({
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(", "));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase.from("linkedin_credentials").upsert({
    user_id: user.id,
    encrypted_email: encrypt(parsed.data.email),
    encrypted_password: encrypt(parsed.data.password),
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function saveCompanyProfile(formData: FormData) {
  const parsed = companyProfileSchema.safeParse({
    name: String(formData.get("company_name") ?? ""),
    sector: String(formData.get("sector") ?? ""),
    value_proposition: String(formData.get("value_proposition") ?? ""),
    icp: String(formData.get("icp") ?? ""),
  });
  if (!parsed.success) throw new Error(parsed.error.issues.map(i => i.message).join(", "));

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Check if ICP text changed (skip LLM call if unchanged)
  const { data: existing } = await supabase
    .from("company_profiles")
    .select("icp, icp_company_types")
    .eq("user_id", user.id)
    .single();

  let icpCompanyTypes: string[] = existing?.icp_company_types ?? [];

  // Only regenerate if ICP text changed or no types exist yet
  if (!existing || existing.icp !== parsed.data.icp || icpCompanyTypes.length === 0) {
    try {
      const prompt = `Dado este Perfil de Cliente Ideal (ICP): "${parsed.data.icp}"
Setor da empresa: "${parsed.data.sector}"

Liste 5-10 tipos/categorias de empresa que se encaixam neste ICP.
Exemplos de formato: "Fintechs", "Bancos digitais", "Empresas de cobrança", "Operadoras de telecom"

Retorne JSON: {"types": ["tipo1", "tipo2", ...]}`;

      const result = await callClaudeJSON(
        prompt,
        z.object({ types: z.array(z.string().min(1)).min(1).max(10) }),
        { timeout: 30_000, model: "haiku" }
      );
      icpCompanyTypes = result.types;
    } catch (err) {
      console.warn("[settings] Failed to generate ICP company types:", err);
    }
  }

  const { error } = await supabase.from("company_profiles").upsert({
    user_id: user.id,
    ...parsed.data,
    icp_company_types: icpCompanyTypes,
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

export async function getCompanyProfile() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("company_profiles")
    .select("icp_company_types, default_target_roles, default_regions")
    .eq("user_id", user.id)
    .single();

  return data as {
    icp_company_types: string[];
    default_target_roles: string[];
    default_regions: string[];
  } | null;
}

export async function addCompanyType(type: string) {
  const trimmed = type.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("Tipo inválido");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("company_profiles")
    .select("icp_company_types")
    .eq("user_id", user.id)
    .single();

  if (!profile) throw new Error("Perfil não encontrado. Salve o ICP primeiro.");

  const existing: string[] = profile.icp_company_types ?? [];
  if (existing.includes(trimmed)) return;
  if (existing.length >= 20) throw new Error("Limite de 20 tipos atingido");

  const { error } = await supabase
    .from("company_profiles")
    .update({ icp_company_types: [...existing, trimmed] })
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

async function addProfileArrayItem(column: "default_target_roles" | "default_regions", value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("Valor inválido");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("company_profiles")
    .select(column)
    .eq("user_id", user.id)
    .single();

  if (!profile) throw new Error("Perfil não encontrado. Salve o ICP primeiro.");

  const existing: string[] = (profile as Record<string, string[]>)[column] ?? [];
  if (existing.includes(trimmed)) return;
  if (existing.length >= 20) throw new Error("Limite de 20 itens atingido");

  const { error: updateError } = await supabase
    .from("company_profiles")
    .update({ [column]: [...existing, trimmed] })
    .eq("user_id", user.id);

  if (updateError) throw new Error(updateError.message);
}

export async function addTargetRole(role: string) {
  return addProfileArrayItem("default_target_roles", role);
}

export async function addRegion(region: string) {
  return addProfileArrayItem("default_regions", region);
}
