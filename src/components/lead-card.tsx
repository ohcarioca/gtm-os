"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Sparkles, Loader2, Mail, Phone, Linkedin } from "lucide-react";
import type { Lead } from "@/lib/types/database";

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 24) return `há ${Math.max(1, diffHours)}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `há ${diffDays}d`;
}

const scoreColors: Record<string, string> = {
  "A+": "bg-emerald-100 text-emerald-700",
  A: "bg-indigo-100 text-indigo-700",
  B: "bg-amber-100 text-amber-700",
  C: "bg-slate-100 text-slate-600",
};

interface LeadCardProps {
  lead: Lead;
  onClick: (lead: Lead) => void;
}

export function LeadCard({ lead, onClick }: LeadCardProps) {
  const router = useRouter();
  const [enriching, setEnriching] = useState(false);

  async function handleEnrich(e: React.MouseEvent) {
    e.stopPropagation();
    setEnriching(true);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      if (!res.ok) throw new Error("Enrichment failed");
      router.refresh();
    } catch {
      alert("Erro ao enriquecer lead. Tente novamente.");
    } finally {
      setEnriching(false);
    }
  }

  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: lead.id,
    data: { lead },
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="group cursor-grab active:cursor-grabbing mb-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow"
      onClick={() => onClick(lead)}
    >
      {/* Row 1: Name + Enrich icon */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900 truncate">{lead.name}</p>
        <button
          onClick={handleEnrich}
          disabled={enriching}
          className="opacity-0 group-hover:opacity-100 transition-opacity ml-1 flex-shrink-0"
          title="Enriquecer lead"
        >
          {enriching ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
          )}
        </button>
      </div>

      {/* Row 2: Role · Company */}
      <p className="text-xs text-slate-500 truncate mt-0.5">
        {[lead.role, lead.company?.name].filter(Boolean).join(" · ")}
      </p>

      {/* Row 3: Score badge */}
      {lead.score && (
        <span className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded ${scoreColors[lead.score] ?? scoreColors.C}`}>
          {(lead.metadata?.scoring as { total: number } | null)?.total
            ? `${(lead.metadata.scoring as { total: number }).total}/100`
            : `Score: ${lead.score}`}
        </span>
      )}

      {/* Row 4: Contact icons + time ago */}
      <div className="flex items-center gap-1.5 mt-1.5">
        {lead.email && <Mail className="h-3.5 w-3.5 text-slate-400" />}
        {lead.phone && <Phone className="h-3.5 w-3.5 text-slate-400" />}
        {lead.linkedin_url && <Linkedin className="h-3.5 w-3.5 text-slate-400" />}
        {(lead.email || lead.phone || lead.linkedin_url) && (
          <span className="text-slate-300 text-xs">·</span>
        )}
        <span className="text-xs text-slate-400 ml-auto">{timeAgo(lead.created_at)}</span>
      </div>
    </div>
  );
}
