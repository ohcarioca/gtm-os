import { createClient } from "@/lib/supabase/server";
import { companyDiscoveryRequestSchema } from "@/lib/validations/schemas";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { allowed } = checkRateLimit(user.id);
  if (!allowed) {
    return new Response("Rate limit exceeded", { status: 429 });
  }

  const body = await request.json();
  const parsed = companyDiscoveryRequestSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("name, sector, value_proposition, icp")
    .eq("user_id", user.id)
    .single();

  // Create agent run
  const { data: run } = await supabase.from("agent_runs").insert({
    user_id: user.id,
    region: parsed.data.region,
    quantity: parsed.data.quantity,
    status: "running",
  }).select().single();

  const abortSignal = request.signal;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let cancelled = false;
      const accumulatedLog: Array<{ step: string; message: string; timestamp: string }> = [];

      abortSignal.addEventListener("abort", () => { cancelled = true; });

      // Send runId to client so it can update status on cancel
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ runId: run!.id })}\n\n`));

      try {
        const { buildCompanyDiscoveryGraph } = await import("@/lib/agent/company-discovery/graph");
        const graph = buildCompanyDiscoveryGraph();

        const eventStream = await graph.stream(
          {
            userId: user.id,
            sector: parsed.data.sector,
            region: parsed.data.region,
            sizes: parsed.data.sizes,
            keywords: parsed.data.keywords,
            freeText: parsed.data.freeText,
            quantity: parsed.data.quantity,
            companyProfile: companyProfile ?? null,
          },
          { recursionLimit: 200, streamMode: "updates", signal: abortSignal }
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

        const companiesFound = accumulatedLog.filter((l) => l.step === "save_company" && l.message.startsWith("Empresa salva")).length;

        if (cancelled) {
          await supabase.from("agent_runs").update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
            leads_found: companiesFound,
            leads_approved: companiesFound,
          }).eq("id", run!.id);
        } else {
          await supabase.from("agent_runs").update({
            status: "completed",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
            leads_found: companiesFound,
            leads_approved: companiesFound,
          }).eq("id", run!.id);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
        }
      } catch (error) {
        if (abortSignal.aborted) {
          await supabase.from("agent_runs").update({
            status: "cancelled",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
          }).eq("id", run!.id);
        } else {
          console.error("[Company Discovery Error]", error);
          await supabase.from("agent_runs").update({
            status: "failed",
            finished_at: new Date().toISOString(),
            log: accumulatedLog,
          }).eq("id", run!.id);
          try {
            const errorMsg = error instanceof Error ? error.message : "Discovery failed";
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: errorMsg })}\n\n`));
          } catch { /* stream closed */ }
        }
      } finally {
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
