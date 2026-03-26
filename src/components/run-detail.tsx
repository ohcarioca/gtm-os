"use client";

import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, CheckCircle, ClipboardList, Zap } from "lucide-react";
import type { AgentRun } from "@/lib/types/database";

interface RunDetailProps {
  run: AgentRun;
}

const stepConfig: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  search_company: { icon: Search, bg: "bg-indigo-100", text: "text-indigo-600" },
  find_decision_maker: { icon: User, bg: "bg-amber-100", text: "text-amber-600" },
  validate_profile: { icon: CheckCircle, bg: "bg-emerald-100", text: "text-emerald-600" },
  create_lead: { icon: ClipboardList, bg: "bg-purple-100", text: "text-purple-600" },
};

const defaultStepConfig = { icon: Zap, bg: "bg-slate-100", text: "text-slate-600" };

export function RunDetail({ run }: RunDetailProps) {
  if (!run.log || run.log.length === 0) {
    return <p className="text-sm text-slate-400">Sem logs disponiveis</p>;
  }

  return (
    <ScrollArea className="max-h-[300px]">
      <div className="space-y-2">
        {run.log.map((entry, i) => {
          const config = stepConfig[entry.step] ?? defaultStepConfig;
          const Icon = config.icon;
          return (
            <div key={i} className="flex items-start gap-3 text-sm">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full ${config.bg} shrink-0`}>
                <Icon className={`w-3 h-3 ${config.text}`} />
              </div>
              <div>
                <p className="text-slate-700">{entry.message}</p>
                <p className="text-xs text-slate-400">
                  {new Date(entry.timestamp).toLocaleTimeString("pt-BR")}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}
