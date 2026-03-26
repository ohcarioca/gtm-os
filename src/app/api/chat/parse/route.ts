import { createClient } from "@/lib/supabase/server";
import { callClaudeJSON } from "@/lib/claude-cli";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { z } from "zod";

export const dynamic = "force-dynamic";

const parseResultSchema = z.object({
  action: z.enum(["search_leads", "search_companies"]),
  params: z.object({
    target_roles: z.array(z.string()).optional(),
    region: z.string().optional(),
    sector: z.string().optional(),
    sizes: z.array(z.string()).optional(),
    keywords: z.array(z.string()).optional(),
    quantity: z.number().optional(),
  }),
  missing: z.array(z.string()),
});

const inputSchema = z.object({
  text: z.string().min(1),
  context: z.string().optional(),
});

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
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Text is required" }, { status: 400 });
  }

  const { text, context } = parsed.data;

  // Fetch company profile for context
  const { data: profile } = await supabase
    .from("company_profiles")
    .select("name, sector, icp")
    .eq("user_id", user.id)
    .single();

  const prompt = `Extraia parâmetros de busca deste texto do usuário.

CONTEXTO: O usuário quer ${context === "companies" ? "buscar empresas" : "buscar leads"}.
${profile ? `PERFIL DA EMPRESA: ${profile.name}, setor: ${profile.sector}, ICP: ${profile.icp}` : ""}

TEXTO DO USUÁRIO: "${text}"

Extraia os parâmetros que conseguir identificar:
- action: "search_leads" ou "search_companies"
- target_roles: cargos mencionados
- region: região/cidade/estado
- sector: setor/indústria
- sizes: portes de empresa (small, medium, large)
- keywords: palavras-chave relevantes
- quantity: quantidade desejada

Em "missing", liste os campos obrigatórios que NÃO foram mencionados:
- Para search_companies: sector e region são obrigatórios
- Para search_leads: target_roles é obrigatório`;

  try {
    const result = await callClaudeJSON(prompt, parseResultSchema, {
      timeout: 15_000,
      model: "haiku",
    });
    return Response.json(result);
  } catch (error) {
    console.error("[chat/parse] Failed to parse:", error);
    return Response.json({ error: "Failed to parse" }, { status: 500 });
  }
}
