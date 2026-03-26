"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RunDetail } from "@/components/run-detail";
import type { AgentRun } from "@/lib/types/database";

interface RunListProps {
  runs: AgentRun[];
}

const statusColors: Record<string, string> = {
  running: "bg-amber-100 text-amber-800",
  completed: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
  cancelled: "bg-slate-100 text-slate-800",
};

const statusLabels: Record<string, string> = {
  running: "Executando",
  completed: "Concluido",
  failed: "Falhou",
  cancelled: "Cancelado",
};

export function RunList({ runs }: RunListProps) {
  const [selectedRun, setSelectedRun] = useState<AgentRun | null>(null);

  return (
    <div className="space-y-4">
      {runs.length === 0 && (
        <p className="text-slate-400 text-center py-8">Nenhuma execucao encontrada</p>
      )}
      {runs.map((run) => (
        <Card
          key={run.id}
          className="cursor-pointer rounded-xl shadow-sm border-slate-200 hover:border-indigo-200 transition-colors"
          onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
        >
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900">{run.region || "\u2014"}</p>
                <p className="text-sm text-slate-500">{run.region} · {run.leads_approved}/{run.quantity} {run.log?.some((l) => l.step === "save_company") ? "empresas" : "leads"}</p>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant="secondary" className={statusColors[run.status]}>
                  {statusLabels[run.status] ?? run.status}
                </Badge>
                <span className="text-xs text-slate-400">
                  {new Date(run.started_at).toLocaleDateString("pt-BR")}
                </span>
              </div>
            </div>
            {selectedRun?.id === run.id && (
              <div className="mt-4 border-t border-slate-200 pt-4">
                <RunDetail run={run} />
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
