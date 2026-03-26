"use server";

import { createClient } from "@/lib/supabase/server";
import { updateProspectCompanySchema, createProspectCompanySchema, importProspectCompaniesSchema } from "@/lib/validations/schemas";
import { enrichCompany } from "@/lib/firecrawl-enrich";
import { revalidatePath } from "next/cache";

export async function updateCompanyStatus(id: string, status: "approved" | "rejected") {
  const parsed = updateProspectCompanySchema.safeParse({ id, status });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("prospect_companies")
    .update({ status })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
  revalidatePath("/companies");
}

export async function bulkUpdateCompanyStatus(
  minScore: number,
  status: "approved" | "rejected"
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  let query = supabase
    .from("prospect_companies")
    .update({ status })
    .eq("user_id", user.id)
    .eq("status", "new");

  if (status === "approved") {
    query = query.gte("icp_score", minScore);
  } else {
    query = query.lt("icp_score", minScore);
  }

  const { error } = await query;
  if (error) throw error;
  revalidatePath("/companies");
}

export async function deleteProspectCompany(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase
    .from("prospect_companies")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
  revalidatePath("/companies");
}

export async function createCompany(input: unknown) {
  const parsed = createProspectCompanySchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { name, website, sector, size, region, description } = parsed.data;

  const { data, error } = await supabase
    .from("prospect_companies")
    .insert({
      user_id: user.id,
      name,
      website: website || null,
      sector: sector || null,
      size: size || null,
      region: region || null,
      description: description || null,
      source: "manual",
      status: "approved",
    })
    .select("id")
    .single();

  if (error) throw error;

  // Non-blocking enrichment
  if (website) {
    enrichCompany(name, website, undefined, user.id).then(async (enrichment) => {
      if (!enrichment) return;
      await supabase
        .from("prospect_companies")
        .update({
          description: enrichment.description ?? description ?? null,
          tech_stack: enrichment.techStack.join(", ") || null,
          products: enrichment.products.join(", ") || null,
          hiring_status: enrichment.isHiring ? "Contratando" : "Não contratando",
          sector: enrichment.sector ?? sector ?? null,
          size: enrichment.employeeCount ?? size ?? null,
        })
        .eq("id", data.id)
        .eq("user_id", user.id);
    }).catch(console.error);
  }

  revalidatePath("/companies");
}

export async function importCompanies(input: unknown) {
  const parsed = importProspectCompaniesSchema.safeParse(input);
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { companies } = parsed.data;

  const rows = companies.map((c) => ({
    user_id: user.id,
    name: c.name,
    website: c.website || null,
    sector: c.sector || null,
    size: c.size || null,
    region: c.region || null,
    description: c.description || null,
    source: "manual" as const,
    status: "approved" as const,
  }));

  const { data, error } = await supabase
    .from("prospect_companies")
    .insert(rows)
    .select("id, name, website");

  if (error) throw error;

  // Non-blocking enrichment for companies with websites
  if (data) {
    for (const company of data) {
      if (!company.website) continue;
      enrichCompany(company.name, company.website, undefined, user.id).then(async (enrichment) => {
        if (!enrichment) return;
        await supabase
          .from("prospect_companies")
          .update({
            description: enrichment.description,
            tech_stack: enrichment.techStack.join(", ") || null,
            products: enrichment.products.join(", ") || null,
            hiring_status: enrichment.isHiring ? "Contratando" : "Não contratando",
            sector: enrichment.sector,
            size: enrichment.employeeCount,
          })
          .eq("id", company.id)
          .eq("user_id", user.id);
      }).catch(console.error);
    }
  }

  revalidatePath("/companies");
}

export async function getAllApprovedCompanies() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data } = await supabase
    .from("prospect_companies")
    .select("id, name, website, sector, icp_score")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .order("icp_score", { ascending: false });

  return data ?? [];
}
