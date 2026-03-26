import { createClient } from "@/lib/supabase/server";
import { enrichLeadSchema } from "@/lib/validations/schemas";
import { enrichCompany } from "@/lib/firecrawl-enrich";
import { checkRateLimit } from "@/lib/security/rate-limit";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed } = checkRateLimit(user.id);
  if (!allowed) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": "60", "X-RateLimit-Remaining": "0" },
    });
  }

  const body = await request.json();
  const parsed = enrichLeadSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  // Fetch lead with company
  const { data: lead } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .eq("id", parsed.data.lead_id)
    .single();

  if (!lead) return new Response("Lead not found", { status: 404 });

  try {
    const result = await enrichCompany(
      lead.company.name,
      lead.company.metadata?.website ?? null,
      lead.company.city,
      user.id,
    );

    if (!result) {
      return Response.json(
        { success: false, error: "Could not enrich company" },
        { status: 422 }
      );
    }

    // Update company metadata
    const existingMetadata = lead.company.metadata ?? {};
    await supabase
      .from("companies")
      .update({
        metadata: {
          ...existingMetadata,
          description: result.description,
          sector: result.sector,
          employeeCount: result.employeeCount,
          products: result.products,
          techStack: result.techStack,
          isHiring: result.isHiring,
          address: result.address,
          website: result.website,
          enriched_at: new Date().toISOString(),
        },
      })
      .eq("id", lead.company.id);

    // Update lead contact info
    const leadUpdate: Record<string, unknown> = {
      metadata: {
        ...(lead.metadata ?? {}),
        enriched_at: new Date().toISOString(),
      },
    };
    if (result.contactEmail && !lead.email) leadUpdate.email = result.contactEmail;
    if (result.contactPhone && !lead.phone) leadUpdate.phone = result.contactPhone;

    await supabase
      .from("leads")
      .update(leadUpdate)
      .eq("id", lead.id);

    return Response.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Enrichment failed";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
