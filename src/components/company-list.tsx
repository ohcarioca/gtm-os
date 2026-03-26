"use client";

import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Check, X, ChevronDown, ChevronUp, ExternalLink, LinkedinIcon } from "lucide-react";
import { updateCompanyStatus, bulkUpdateCompanyStatus } from "@/app/(app)/companies/actions";
import type { ProspectCompany, ProspectCompanyStatus } from "@/lib/types/database";

interface CompanyListProps {
  companies: ProspectCompany[];
  actions?: React.ReactNode;
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

function statusBadge(status: ProspectCompanyStatus) {
  if (status === "approved") {
    return <Badge className="bg-emerald-100 text-emerald-700">Aprovada</Badge>;
  }
  if (status === "rejected") {
    return <Badge className="bg-red-100 text-red-700">Rejeitada</Badge>;
  }
  return null;
}

function CompanyCard({ company }: { company: ProspectCompany }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleStatusChange(status: "approved" | "rejected") {
    setLoading(true);
    try {
      await updateCompanyStatus(company.id, status);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="rounded-xl shadow-sm border-slate-200">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900 truncate">{company.name}</h3>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {company.sector && (
                <Badge variant="secondary" className="text-xs bg-indigo-100 text-indigo-700">
                  {company.sector}
                </Badge>
              )}
              {company.size && (
                <Badge variant="outline" className="text-xs">
                  {company.size}
                </Badge>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge className={`text-xs font-semibold ${scoreBadgeClass(company.icp_score)}`}>
              {company.icp_score}
            </Badge>
            {statusBadge(company.status)}
          </div>
        </div>

        {company.description && (
          <p className="text-sm text-slate-600 line-clamp-2">{company.description}</p>
        )}

        {expanded && (
          <div className="space-y-2 text-sm text-slate-600 border-t border-slate-100 pt-3">
            {company.tech_stack && (
              <div>
                <span className="font-medium text-slate-700">Tech Stack:</span>{" "}
                {company.tech_stack}
              </div>
            )}
            {company.products && (
              <div>
                <span className="font-medium text-slate-700">Produtos:</span>{" "}
                {company.products}
              </div>
            )}
            {company.hiring_status && (
              <div>
                <span className="font-medium text-slate-700">Contratando:</span>{" "}
                {company.hiring_status}
              </div>
            )}
            {company.icp_justification && (
              <div>
                <span className="font-medium text-slate-700">Justificativa ICP:</span>{" "}
                {company.icp_justification}
              </div>
            )}
            {company.website && (
              <a
                href={company.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {company.website}
              </a>
            )}
            {company.linkedin_url && (
              <a
                href={company.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
              >
                <LinkedinIcon className="h-3.5 w-3.5" />
                LinkedIn
              </a>
            )}
          </div>
        )}

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExpanded(!expanded)}
            className="text-slate-500 hover:text-slate-700"
          >
            {expanded ? (
              <>
                <ChevronUp className="h-4 w-4 mr-1" />
                Menos
              </>
            ) : (
              <>
                <ChevronDown className="h-4 w-4 mr-1" />
                Mais
              </>
            )}
          </Button>

          {company.status === "new" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => handleStatusChange("approved")}
                className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                <Check className="h-4 w-4 mr-1" />
                Aprovar
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={loading}
                onClick={() => handleStatusChange("rejected")}
                className="border-red-300 text-red-700 hover:bg-red-50"
              >
                <X className="h-4 w-4 mr-1" />
                Rejeitar
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function CompanyList({ companies, actions }: CompanyListProps) {
  const [minScore, setMinScore] = useState(70);
  const [bulkLoading, setBulkLoading] = useState(false);

  const counts = {
    all: companies.length,
    new: companies.filter((c) => c.status === "new").length,
    approved: companies.filter((c) => c.status === "approved").length,
    rejected: companies.filter((c) => c.status === "rejected").length,
  };

  function filterCompanies(status: string): ProspectCompany[] {
    if (status === "all") return companies;
    return companies.filter((c) => c.status === status);
  }

  async function handleBulkApprove() {
    setBulkLoading(true);
    try {
      await bulkUpdateCompanyStatus(minScore, "approved");
    } catch {
      // handled silently
    } finally {
      setBulkLoading(false);
    }
  }

  return (
    <Tabs defaultValue="all">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <TabsList>
          <TabsTrigger value="all">Todas ({counts.all})</TabsTrigger>
          <TabsTrigger value="new">Novas ({counts.new})</TabsTrigger>
          <TabsTrigger value="approved">Aprovadas ({counts.approved})</TabsTrigger>
          <TabsTrigger value="rejected">Rejeitadas ({counts.rejected})</TabsTrigger>
        </TabsList>
        {actions && <div className="flex gap-2">{actions}</div>}
      </div>

      {(["all", "new", "approved", "rejected"] as const).map((tab) => (
        <TabsContent key={tab} value={tab}>
          {tab === "new" && counts.new > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
              <span className="text-sm text-slate-600 whitespace-nowrap">Score minimo:</span>
              <Input
                type="number"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-20"
              />
              <Button
                size="sm"
                disabled={bulkLoading}
                onClick={handleBulkApprove}
                className="bg-emerald-600 hover:bg-emerald-700 text-white whitespace-nowrap"
              >
                {bulkLoading ? "Aprovando..." : `Aprovar todas >= ${minScore}`}
              </Button>
            </div>
          )}

          {filterCompanies(tab).length === 0 ? (
            <p className="text-center text-slate-400 py-8">Nenhuma empresa encontrada</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filterCompanies(tab).map((company) => (
                <CompanyCard key={company.id} company={company} />
              ))}
            </div>
          )}
        </TabsContent>
      ))}
    </Tabs>
  );
}
