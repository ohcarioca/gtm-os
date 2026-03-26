import { createClient } from "@/lib/supabase/server";
import { RunList } from "@/components/run-list";
import type { AgentRun } from "@/lib/types/database";

export default async function RunsPage() {
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("agent_runs")
    .select("*")
    .order("started_at", { ascending: false });

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Execucoes</h2>
      <RunList runs={(runs as AgentRun[]) ?? []} />
    </div>
  );
}
