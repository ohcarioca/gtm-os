"use server";

import { createClient } from "@/lib/supabase/server";
import { updateLeadStageSchema } from "@/lib/validations/schemas";
import type { Stage } from "@/lib/types/database";

export async function updateLeadStage(id: string, stage: Stage) {
  const parsed = updateLeadStageSchema.safeParse({ id, stage });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { error } = await supabase
    .from("leads")
    .update({ stage: parsed.data.stage })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
}

export async function getApprovedCompaniesCount(): Promise<number> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from("prospect_companies")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("status", "approved");

  return count ?? 0;
}

export async function getDashboardCompanyProfile() {
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

export async function getDashboardApprovedCompanies() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("prospect_companies")
    .select("id, name, website, sector, icp_score")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("icp_score", { ascending: false });

  return (data ?? []) as {
    id: string;
    name: string;
    website: string | null;
    sector: string | null;
    icp_score: number;
  }[];
}
