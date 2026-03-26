import { createClient } from "@/lib/supabase/server";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";

export const dynamic = "force-dynamic";

const suggestionsSchema = z.object({
  sector: z.string(),
  region: z.string(),
  sizes: z.array(z.string()),
  keywords: z.array(z.string()),
  freeText: z.string(),
});

const inputSchema = z.object({
  companyName: z.string().min(1).max(200),
  sector: z.string().max(200).optional().default(""),
  icp: z.string().min(1).max(1000),
  valueProposition: z.string().max(2000).optional().default(""),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return new Response("Invalid input", { status: 400 });
  }
  const { companyName, sector, icp, valueProposition } = parsed.data;

  try {
    const prompt = `Based on this company's profile, suggest search parameters to find their ideal prospect companies.

COMPANY PROFILE:
- Name: ${companyName}
- Sector: ${sector}
- ICP (Ideal Customer Profile): ${icp}
- Value Proposition: ${valueProposition}

Generate search parameters to find companies that match this ICP:
- sector: the industry/sector to search for (e.g. "Fintech", "E-commerce", "SaaS")
- region: geographic region in Portuguese (e.g. "São Paulo, Brasil")
- sizes: array of company size ranges that fit the ICP. Pick from: "1-10", "11-50", "51-200", "201-500", "500+"
- keywords: array of 3-5 relevant keywords to find these companies (in Portuguese)
- freeText: a short sentence describing the ideal company to find (in Portuguese, max 200 chars)

Return JSON.`;

    const suggestions = await callClaudeJSON(prompt, suggestionsSchema, { timeout: 30_000 });

    return Response.json(suggestions);
  } catch {
    return new Response("Failed to generate suggestions", { status: 500 });
  }
}
