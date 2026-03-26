"use server";

import { createClient } from "@/lib/supabase/server";
import { createLeadSchema, updateLeadSchema } from "@/lib/validations/schemas";
import { revalidatePath } from "next/cache";

export async function createLead(data: {
  name: string;
  company_name: string;
  linkedin_url: string;
  role?: string;
  stage?: string;
  score?: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  const parsed = createLeadSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  // Find or create company
  const { data: existingCompany } = await supabase
    .from("companies")
    .select("id")
    .eq("name", parsed.data.company_name)
    .limit(1)
    .single();

  let companyId: string;
  if (existingCompany) {
    companyId = existingCompany.id;
  } else {
    const { data: newCompany, error: companyError } = await supabase
      .from("companies")
      .insert({
        user_id: user.id,
        name: parsed.data.company_name,
      })
      .select("id")
      .single();
    if (companyError) throw new Error(companyError.message);
    companyId = newCompany.id;
  }

  const { error } = await supabase.from("leads").insert({
    user_id: user.id,
    company_id: companyId,
    name: parsed.data.name,
    role: parsed.data.role || null,
    linkedin_url: parsed.data.linkedin_url,
    stage: parsed.data.stage || "identified",
    score: parsed.data.score || null,
    phone: parsed.data.phone || null,
    email: parsed.data.email || null,
    notes: parsed.data.notes || null,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
}

export async function updateLead(data: {
  id: string;
  name?: string;
  role?: string;
  linkedin_url?: string;
  stage?: string;
  score?: string;
  phone?: string;
  email?: string;
  notes?: string;
}) {
  const parsed = updateLeadSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { id, ...updates } = parsed.data;

  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  );

  if (Object.keys(cleanUpdates).length === 0) return;

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { error } = await supabase
    .from("leads")
    .update(cleanUpdates)
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
}

export async function deleteLead(id: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { error } = await supabase.from("leads").delete().eq("id", id).eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/contacts");
  revalidatePath("/pipeline");
  revalidatePath("/dashboard");
}

export async function saveLinkedinLeads(data: {
  leads: Array<{
    name: string;
    role?: string;
    company_name: string;
    linkedin_url: string;
    score?: string;
    email?: string;
    phone?: string;
    connections?: number;
    about?: string;
    message?: string;
    metadata?: Record<string, unknown>;
    validation?: Record<string, unknown>;
  }>;
}) {
  const { saveLinkedinLeadsSchema } = await import("@/lib/validations/schemas");
  const parsed = saveLinkedinLeadsSchema.safeParse(data);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const results: string[] = [];

  for (const lead of parsed.data.leads) {
    // Find or create company (same pattern as existing createLead)
    const { data: existingCompany } = await supabase
      .from("companies")
      .select("id")
      .eq("name", lead.company_name)
      .limit(1)
      .single();

    let companyId: string;
    if (existingCompany) {
      companyId = existingCompany.id;
    } else {
      const { data: newCompany, error: companyError } = await supabase
        .from("companies")
        .insert({ user_id: user.id, name: lead.company_name })
        .select("id")
        .single();
      if (companyError) throw new Error(companyError.message);
      companyId = newCompany.id;
    }

    const { data: newLead, error } = await supabase.from("leads").insert({
      user_id: user.id,
      company_id: companyId,
      name: lead.name,
      role: lead.role || null,
      linkedin_url: lead.linkedin_url,
      stage: "identified",
      score: lead.score || null,
      email: lead.email || null,
      phone: lead.phone || null,
      connections: lead.connections || null,
      message: lead.message || null,
      notes: lead.about ? `LinkedIn: ${lead.about.substring(0, 500)}` : null,
      metadata: lead.metadata || {},
      validation: lead.validation || {},
    }).select("id").single();

    if (error) throw new Error(error.message);
    results.push(newLead.id);
  }

  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return results;
}
