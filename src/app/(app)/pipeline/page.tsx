import { createClient } from "@/lib/supabase/server";
import { PipelineKanban } from "@/components/pipeline-kanban";
import type { Lead } from "@/lib/types/database";

export default async function PipelinePage() {
  const supabase = await createClient();

  const { data: leads } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-2xl font-bold mb-4">Pipeline</h2>
      <div className="flex-1 min-h-0">
        <PipelineKanban leads={(leads as Lead[]) ?? []} />
      </div>
    </div>
  );
}
