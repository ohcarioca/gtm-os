"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Users,
  Play,
  TrendingUp,
  Search,
} from "lucide-react";
import type { Lead, AgentRun } from "@/lib/types/database";

interface DashboardContentProps {
  leads: Lead[];
  runs: AgentRun[];
}

const stageConfig: Record<string, { label: string; color: string; barColor: string }> = {
  identified: { label: "Identificado", color: "bg-indigo-500", barColor: "bg-indigo-500" },
  connected: { label: "Conectado", color: "bg-amber-500", barColor: "bg-amber-500" },
  in_conversation: { label: "Em Conversa", color: "bg-purple-500", barColor: "bg-purple-500" },
  converted: { label: "Convertido", color: "bg-emerald-500", barColor: "bg-emerald-500" },
  lost: { label: "Perdido", color: "bg-rose-500", barColor: "bg-rose-500" },
};

const scoreConfig: Record<string, string> = {
  "A+": "bg-emerald-100 text-emerald-800",
  A: "bg-indigo-100 text-indigo-800",
  B: "bg-amber-100 text-amber-800",
  C: "bg-slate-100 text-slate-600",
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "agora";
  if (diffMin < 60) return `há ${diffMin}m`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `há ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD < 30) return `há ${diffD}d`;
  const diffMo = Math.floor(diffD / 30);
  return `há ${diffMo}mo`;
}

export function DashboardContent({ leads, runs }: DashboardContentProps) {
  const totalLeads = leads.length;
  const totalRuns = runs.length;
  const converted = leads.filter((l) => l.stage === "converted").length;
  const conversionRate = totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(1) : "0";

  const serpApiQueries = runs.reduce((count, run) => {
    const logEntries = run.log ?? [];
    return count + logEntries.filter((entry) =>
      entry.step === "find_lead" || entry.step === "search_company" || entry.step === "enrich_lead"
    ).length;
  }, 0);

  const stageCounts = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.stage] = (acc[l.stage] || 0) + 1;
    return acc;
  }, {});

  const scoreCounts = leads.reduce<Record<string, number>>((acc, l) => {
    if (l.score) acc[l.score] = (acc[l.score] || 0) + 1;
    return acc;
  }, {});

  const totalForBar = Object.values(stageCounts).reduce((a, b) => a + b, 0);
  const recentLeads = leads.slice(0, 5);

  const kpis = [
    {
      icon: Users,
      label: "Total de Leads",
      value: totalLeads,
      trend: null,
    },
    {
      icon: Play,
      label: "Execuções",
      value: totalRuns,
      trend: null,
    },
    {
      icon: TrendingUp,
      label: "Taxa de Conversão",
      value: `${conversionRate}%`,
      trend: Number(conversionRate) > 0 ? `+${conversionRate}%` : null,
    },
    {
      icon: Search,
      label: "Queries SerpAPI",
      value: serpApiQueries,
      trend: null,
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card
            key={kpi.label}
            className="rounded-xl shadow-sm border border-slate-200 bg-white"
          >
            <CardContent className="p-6">
              <kpi.icon className="h-5 w-5 text-slate-400 mb-3" />
              <p className="text-xs font-medium tracking-wide uppercase text-slate-500">
                {kpi.label}
              </p>
              <p className="text-3xl font-bold text-slate-900 mt-1">
                {kpi.value}
              </p>
              {kpi.trend && (
                <p className="text-sm text-emerald-600 mt-1">{kpi.trend}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline Summary */}
      <Card className="rounded-xl shadow-sm border border-slate-200 bg-white">
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-medium text-slate-700">
            Pipeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Horizontal bar */}
          {totalForBar > 0 ? (
            <div className="flex h-4 rounded-full overflow-hidden mb-4">
              {Object.entries(stageConfig).map(([stage, config]) => {
                const count = stageCounts[stage] || 0;
                if (count === 0) return null;
                const pct = (count / totalForBar) * 100;
                return (
                  <div
                    key={stage}
                    className={`${config.barColor} transition-all`}
                    style={{ width: `${pct}%` }}
                    title={`${config.label}: ${count}`}
                  />
                );
              })}
            </div>
          ) : (
            <div className="h-4 rounded-full bg-slate-100 mb-4" />
          )}

          {/* Legend */}
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {Object.entries(stageConfig).map(([stage, config]) => (
              <div key={stage} className="flex items-center gap-2">
                <span
                  className={`inline-block h-2.5 w-2.5 rounded-full ${config.color}`}
                />
                <span className="text-sm text-slate-600">{config.label}</span>
                <span className="text-sm font-semibold text-slate-900">
                  {stageCounts[stage] || 0}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Leads by Score */}
        <Card className="rounded-xl shadow-sm border border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium text-slate-700">
              Leads por Score
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3">
              {(["A+", "A", "B", "C"] as const).map((score) => (
                <Badge
                  key={score}
                  variant="secondary"
                  className={`text-base px-4 py-2 rounded-lg border-0 ${scoreConfig[score]}`}
                >
                  {score}: {scoreCounts[score] || 0}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent Leads */}
        <Card className="rounded-xl shadow-sm border border-slate-200 bg-white">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-medium text-slate-700">
              Leads Recentes
            </CardTitle>
          </CardHeader>
          <CardContent>
            {recentLeads.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum lead ainda.</p>
            ) : (
              <div className="space-y-3">
                {recentLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className="flex items-center justify-between"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {lead.name}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {lead.company?.name ?? "—"} · {timeAgo(lead.created_at)}
                      </p>
                    </div>
                    {lead.score && (
                      <Badge
                        variant="secondary"
                        className={`ml-2 shrink-0 border-0 ${scoreConfig[lead.score]}`}
                      >
                        {lead.score}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
