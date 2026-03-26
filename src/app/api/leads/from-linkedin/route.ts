import { createClient } from "@/lib/supabase/server";
import { linkedinLeadRequestSchema } from "@/lib/validations/schemas";
import { checkRateLimit } from "@/lib/security/rate-limit";
import {
  getProfile,
  closeBrowser,
  getDailyUsage,
  LinkedInAuthError,
  LinkedInLimitError,
} from "@/lib/linkedin-playwright";
import { callClaudeJSON } from "@/lib/claude-cli";
import { z } from "zod";

export const dynamic = "force-dynamic";

// --- Score schema ---

const scoreResultSchema = z.object({
  score: z.object({
    total: z.number().min(0).max(100),
    dimensions: z.object({
      company_fit: z.number().min(0).max(30),
      role_fit: z.number().min(0).max(30),
      seniority: z.number().min(0).max(20),
      activity: z.number().min(0).max(20),
    }),
    justification: z.string(),
  }),
  message: z.string(),
});

// --- Grade mapping ---

function totalToGrade(total: number): string {
  if (total >= 80) return "A+";
  if (total >= 65) return "A";
  if (total >= 50) return "B";
  if (total >= 35) return "C";
  return "D";
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed } = checkRateLimit(user.id);
  if (!allowed) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": "60", "X-RateLimit-Remaining": "0" },
    });
  }

  const body = await request.json();
  const parsed = linkedinLeadRequestSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  const urls = parsed.data.urls;

  // Check LinkedIn daily usage
  const usage = await getDailyUsage(user.id);
  const availableScrapes = Math.max(0, 100 - usage.scrapes);

  // Fetch company profile for scoring context
  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("name, sector, value_proposition, icp, default_target_roles")
    .eq("user_id", user.id)
    .single();

  const targetRoles: string[] =
    companyProfile?.default_target_roles ?? ["CEO", "CTO", "Founder"];

  // Service role client for dedup checks
  const { createClient: createServiceClient } = await import(
    "@supabase/supabase-js"
  );
  const serviceClient = createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const abortSignal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream already closed
        }
      };

      try {
        send({ type: "start", total: urls.length, available_scrapes: availableScrapes });

        for (let i = 0; i < urls.length; i++) {
          if (abortSignal.aborted) break;

          const url = urls[i];
          send({ type: "processing", index: i, url });

          // --- Dedup check ---
          const { data: existingLead } = await serviceClient
            .from("leads")
            .select("id")
            .eq("user_id", user.id)
            .eq("linkedin_url", url)
            .maybeSingle();

          if (existingLead) {
            send({
              type: "result",
              index: i,
              url,
              status: "duplicate",
              error: "Lead já existe na base",
            });
            continue;
          }

          const { data: rejectedLead } = await serviceClient
            .from("rejected_leads")
            .select("id")
            .eq("user_id", user.id)
            .eq("linkedin_url", url)
            .maybeSingle();

          if (rejectedLead) {
            send({
              type: "result",
              index: i,
              url,
              status: "duplicate",
              error: "Lead já foi rejeitado anteriormente",
            });
            continue;
          }

          // --- Scrape LinkedIn profile ---
          let profile;
          try {
            profile = await getProfile(url, user.id, targetRoles);
          } catch (err) {
            if (err instanceof LinkedInAuthError) {
              send({
                type: "result",
                index: i,
                url,
                status: "error",
                error: "LinkedIn session expired - faça login novamente",
              });
              send({ type: "error", error: "auth_wall" });
              break;
            }
            if (err instanceof LinkedInLimitError) {
              send({
                type: "result",
                index: i,
                url,
                status: "error",
                error: err.message,
              });
              send({ type: "error", error: "rate_limit" });
              break;
            }
            const errorMsg =
              err instanceof Error ? err.message : "Erro ao acessar perfil";
            send({
              type: "result",
              index: i,
              url,
              status: "error",
              error: errorMsg,
            });
            continue;
          }

          if (!profile) {
            send({
              type: "result",
              index: i,
              url,
              status: "error",
              error: "Perfil não encontrado ou sem dados",
            });
            continue;
          }

          // --- Score with Claude ---
          try {
            const companyContext = companyProfile
              ? `Empresa do usuário: ${companyProfile.name}\nSetor: ${companyProfile.sector}\nProposta de valor: ${companyProfile.value_proposition}\nICP: ${companyProfile.icp}`
              : "Sem perfil de empresa configurado.";

            const scoringPrompt = `Você é um especialista em qualificação de leads B2B.

${companyContext}

Roles alvo: ${targetRoles.join(", ")}

Dados do lead:
- Nome: ${profile.name}
- Cargo: ${profile.role}
- Empresa: ${profile.company}
- Conexões: ${profile.connections}
- Sobre: ${profile.about || "N/A"}
- Ativo recentemente: ${profile.isRecentlyActive ? "Sim" : "Não"}
- Experiência atual: ${profile.currentExperience || "N/A"}

Avalie este lead com as seguintes dimensões:
- company_fit (0-30): Quanto a empresa do lead se alinha com o ICP
- role_fit (0-30): Quanto o cargo se alinha com os roles alvo
- seniority (0-20): Nível de senioridade e poder de decisão
- activity (0-20): Atividade recente e engajamento no LinkedIn

Também crie uma mensagem de prospecção personalizada:
- Máximo 300 caracteres
- Português do Brasil
- Tom profissional mas humano
- Seja específico (mencione algo do perfil)
- Inclua um gancho de valor baseado na proposta de valor

Retorne JSON: { "score": { "total": number, "dimensions": { "company_fit": number, "role_fit": number, "seniority": number, "activity": number }, "justification": string }, "message": string }`;

            const result = await callClaudeJSON(scoringPrompt, scoreResultSchema, {
              model: "sonnet",
            });

            const grade = totalToGrade(result.score.total);

            send({
              type: "result",
              index: i,
              url,
              status: "success",
              data: {
                name: profile.name,
                role: profile.role,
                company_name: profile.company,
                linkedin_url: url,
                score: grade,
                score_total: result.score.total,
                score_dimensions: result.score.dimensions,
                score_justification: result.score.justification,
                email: profile.contactEmail,
                phone: profile.contactPhone,
                connections: profile.connections,
                about: profile.about,
                message: result.message,
                is_recently_active: profile.isRecentlyActive,
                experience_matches_icp: profile.experienceMatchesICP,
                photo_url: null,
              },
            });
          } catch (err) {
            const errorMsg =
              err instanceof Error ? err.message : "Erro ao pontuar lead";
            console.error(`[from-linkedin] Score error for ${url}:`, errorMsg);
            send({
              type: "result",
              index: i,
              url,
              status: "error",
              error: errorMsg,
            });
          }
        }

        send({ type: "done" });
      } catch (err) {
        console.error("[from-linkedin] Stream error:", err);
        const errorMsg =
          err instanceof Error ? err.message : "Erro interno";
        send({ type: "error", error: errorMsg });
      } finally {
        await closeBrowser();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
