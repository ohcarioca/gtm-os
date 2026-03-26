import { createClient } from "@/lib/supabase/server";
import { prospectRequestSchema } from "@/lib/validations/schemas";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { closeBrowser, getDailyUsage } from "@/lib/linkedin-playwright";

export const dynamic = "force-dynamic";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const usage = await getDailyUsage(user.id);

  return Response.json(usage);
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed, remaining } = checkRateLimit(user.id);
  if (!allowed) {
    return new Response("Rate limit exceeded", {
      status: 429,
      headers: { "Retry-After": "60", "X-RateLimit-Remaining": "0" },
    });
  }

  const body = await request.json();
  const parsed = prospectRequestSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  // Fetch company profile for context
  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("name, sector, value_proposition, icp")
    .eq("user_id", user.id)
    .single();

  // Fetch selected approved companies, shuffle order
  const { data: selectedCompanies } = await supabase
    .from("prospect_companies")
    .select("id, name, website, linkedin_url")
    .eq("user_id", user.id)
    .eq("status", "approved")
    .in("id", parsed.data.company_ids);

  const targetCompanies = shuffle(
    (selectedCompanies ?? []).map((c: { id: string; name: string; website: string | null; linkedin_url: string | null }) => ({
      id: c.id,
      name: c.name,
      website: c.website,
      linkedinUrl: c.linkedin_url,
    }))
  );

  // Create agent run
  const { data: run } = await supabase.from("agent_runs").insert({
    user_id: user.id,
    region: "empresas-alvo",
    quantity: parsed.data.quantity,
    status: "running",
  }).select().single();

  const abortSignal = request.signal;

  // SSE stream
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const accumulatedLog: Array<{ step: string; message: string; timestamp: string }> = [];

      // Listen for client disconnect
      abortSignal.addEventListener("abort", () => {
        cancelled = true;
      });

      // Send runId to client so it can update status on cancel
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ runId: run!.id })}\n\n`));

      try {
        const { buildProspectingGraph } = await import("@/lib/agent/graph");
        const graph = buildProspectingGraph();

        const eventStream = await graph.stream(
          {
            quantity: parsed.data.quantity,
            targetRoles: parsed.data.target_roles,
            minScoreThreshold: parsed.data.min_score_threshold ?? 70,
            companyProfile: companyProfile ?? null,
            targetCompanies: targetCompanies,
            linkedinOnly: parsed.data.method === "linkedin_direct",
            runId: run!.id,
            userId: user.id,
          },
          { recursionLimit: 300, streamMode: "updates", signal: abortSignal }
        );

        for await (const event of eventStream) {
          if (cancelled) break;
          // Collect log entries from node updates
          for (const nodeData of Object.values(event)) {
            const nd = nodeData as Record<string, unknown>;
            if (nd?.log && Array.isArray(nd.log)) {
              accumulatedLog.push(...(nd.log as typeof accumulatedLog));
            }
          }
          const data = JSON.stringify(event);
          controller.enqueue(encoder.encode(`data: ${data}\n\n`));
        }

        if (cancelled) {
          await supabase.from("agent_runs").update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
          }).eq("id", run!.id);
        } else {
          // Mark run completed
          await supabase.from("agent_runs").update({
            status: "completed",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
          }).eq("id", run!.id);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        }
      } catch (error) {
        // Abort errors mean client disconnected
        if (abortSignal.aborted) {
          await supabase.from("agent_runs").update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
          }).eq("id", run!.id);
        } else {
          console.error("[Agent Error]", error);
          await supabase.from("agent_runs").update({
            status: "failed",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
          }).eq("id", run!.id);
          try {
            const errorMsg = error instanceof Error ? error.message : "Agent failed";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`));
          } catch {
            // Stream already closed
          }
        }
      } finally {
        await closeBrowser();
        try { controller.close(); } catch { /* already closed */ }
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
