"use client";

import { useState } from "react";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  rectIntersection,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { LeadCard } from "@/components/lead-card";
import { LeadDetailModal } from "@/components/lead-detail-modal";
import { updateLeadStage } from "@/app/(app)/dashboard/actions";
import type { Lead, Stage } from "@/lib/types/database";

const STAGES: { id: Stage; label: string; dotColor: string; borderColor: string }[] = [
  { id: "identified", label: "Identificado", dotColor: "bg-indigo-500", borderColor: "border-t-indigo-500" },
  { id: "connected", label: "Conectado", dotColor: "bg-amber-500", borderColor: "border-t-amber-500" },
  { id: "in_conversation", label: "Em Conversa", dotColor: "bg-purple-500", borderColor: "border-t-purple-500" },
  { id: "converted", label: "Convertido", dotColor: "bg-emerald-500", borderColor: "border-t-emerald-500" },
  { id: "lost", label: "Perdido", dotColor: "bg-rose-500", borderColor: "border-t-rose-500" },
];

function StageColumn({ stage, leads, onLeadClick }: { stage: typeof STAGES[number]; leads: Lead[]; onLeadClick: (lead: Lead) => void }) {
  const { setNodeRef } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl border border-slate-200 border-t-2 ${stage.borderColor} bg-slate-50 p-3 min-w-[280px] snap-start flex-shrink-0 lg:min-w-0 lg:flex-1 flex flex-col`}
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <span className={`w-2.5 h-2.5 rounded-full ${stage.dotColor}`} />
        <h3 className="text-sm font-semibold text-slate-700">{stage.label}</h3>
        <span className="ml-auto text-xs font-medium bg-slate-600 text-white rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        <SortableContext
          id={stage.id}
          items={leads.map((l) => l.id)}
          strategy={verticalListSortingStrategy}
        >
          {leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={onLeadClick} />
          ))}
        </SortableContext>
      </div>
    </div>
  );
}

interface PipelineKanbanProps {
  leads: Lead[];
}

export function PipelineKanban({ leads: initialLeads }: PipelineKanbanProps) {
  const [leads, setLeads] = useState(initialLeads);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const STAGE_IDS = new Set(STAGES.map((s) => s.id));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over) return;

    const leadId = active.id as string;

    // over.id can be a stage column OR another lead card
    // If it's a lead card, find which stage that lead belongs to
    let newStage: Stage;
    if (STAGE_IDS.has(over.id as Stage)) {
      newStage = over.id as Stage;
    } else {
      const overLead = leads.find((l) => l.id === over.id);
      if (!overLead) return;
      newStage = overLead.stage;
    }

    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.stage === newStage) return;

    setLeads((prev) =>
      prev.map((l) => (l.id === leadId ? { ...l, stage: newStage } : l))
    );

    updateLeadStage(leadId, newStage);
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={(e) => setActiveId(e.active.id as string)}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 overflow-x-auto pb-4 snap-x snap-mandatory h-full">
        {STAGES.map((stage) => {
          const stageLeads = leads.filter((l) => l.stage === stage.id);
          return (
            <StageColumn key={stage.id} stage={stage} leads={stageLeads} onLeadClick={setSelectedLead} />
          );
        })}
      </div>
      <DragOverlay>
        {activeId ? (
          <LeadCard
            lead={leads.find((l) => l.id === activeId)!}
            onClick={() => {}}
          />
        ) : null}
      </DragOverlay>
      {selectedLead && (
        <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
    </DndContext>
  );
}
