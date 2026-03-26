import { createClient } from "@/lib/supabase/server";
import { CompaniesClient } from "./client";
import type { ProspectCompany } from "@/lib/types/database";

export default async function CompaniesPage() {
  const supabase = await createClient();

  const { data: companies } = await supabase
    .from("prospect_companies")
    .select("*")
    .order("icp_score", { ascending: false });

  return (
    <CompaniesClient
      companies={(companies as ProspectCompany[]) ?? []}
    />
  );
}
