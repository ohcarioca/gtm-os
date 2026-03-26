"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { getAllApprovedCompanies } from "@/app/(app)/companies/actions";
import { getCompanyProfile, addTargetRole } from "@/app/(app)/settings/actions";
import { Plus } from "lucide-react";

interface ProspectFormProps {
  onStart: (stream: ReadableStream, controller: AbortController) => void;
  onSubmitting?: () => void;
  isRunning: boolean;
}

interface ApprovedCompany {
  id: string;
  name: string;
  website: string | null;
  sector: string | null;
  icp_score: number;
}

function scoreBadgeClass(score: number): string {
  if (score >= 70) return "bg-emerald-100 text-emerald-700";
  if (score >= 40) return "bg-amber-100 text-amber-700";
  return "bg-red-100 text-red-700";
}

export function ProspectForm({ onStart, onSubmitting, isRunning }: ProspectFormProps) {
  const [method, setMethod] = useState<"full" | "linkedin_direct">("full");
  const [quantity, setQuantity] = useState(5);
  const [minScore, setMinScore] = useState(70);

  // Company state
  const [companies, setCompanies] = useState<ApprovedCompany[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sectorFilter, setSectorFilter] = useState("__all__");
  const [loadingCompanies, setLoadingCompanies] = useState(false);

  // Roles chip state
  const [defaultRoles, setDefaultRoles] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<Set<string>>(new Set());
  const [newRole, setNewRole] = useState("");

  const fetchCompanies = useCallback(async () => {
    setLoadingCompanies(true);
    try {
      const data = await getAllApprovedCompanies();
      setCompanies(data);
      setSelectedIds(new Set(data.map((c: ApprovedCompany) => c.id)));
    } catch {
      setCompanies([]);
      setSelectedIds(new Set());
    } finally {
      setLoadingCompanies(false);
    }
  }, []);

  useEffect(() => {
    fetchCompanies();
  }, [fetchCompanies]);

  useEffect(() => {
    getCompanyProfile()
      .then((profile) => {
        const roles = profile?.default_target_roles ?? [];
        setDefaultRoles(roles);
        setSelectedRoles(new Set(roles));
      })
      .catch((err: unknown) => {
        console.error("[prospect-form] Failed to load roles:", err);
        setDefaultRoles([]);
        setSelectedRoles(new Set());
      });
  }, []);

  const sectors = useMemo(() => {
    const unique = new Set(companies.map((c) => c.sector).filter(Boolean) as string[]);
    return Array.from(unique).sort();
  }, [companies]);

  const filteredCompanies = useMemo(() => {
    if (sectorFilter === "__all__") return companies;
    return companies.filter((c) => c.sector === sectorFilter);
  }, [companies, sectorFilter]);

  // When sector filter changes, select all filtered companies
  useEffect(() => {
    setSelectedIds(new Set(filteredCompanies.map((c) => c.id)));
  }, [filteredCompanies]);

  function handleSelectAll(checked: boolean) {
    if (checked) {
      setSelectedIds(new Set(filteredCompanies.map((c) => c.id)));
    } else {
      setSelectedIds(new Set());
    }
  }

  function handleToggleCompany(id: string, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleToggleRole(role: string) {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      if (next.has(role)) next.delete(role);
      else next.add(role);
      return next;
    });
  }

  async function handleAddRole() {
    const trimmed = newRole.trim();
    if (!trimmed || defaultRoles.includes(trimmed)) { setNewRole(""); return; }
    try {
      await addTargetRole(trimmed);
      setDefaultRoles((prev) => [...prev, trimmed]);
      setSelectedRoles((prev) => { const next = new Set(prev); next.add(trimmed); return next; });
      setNewRole("");
    } catch { /* user can retry */ }
  }

  function handleRoleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); handleAddRole(); }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    const roles = Array.from(selectedRoles);
    if (roles.length === 0) return;

    onSubmitting?.();

    const body = {
      method,
      quantity,
      company_ids: Array.from(selectedIds),
      target_roles: roles,
      min_score_threshold: minScore,
    };

    const controller = new AbortController();
    const response = await fetch("/api/prospect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) return;
    onStart(response.body, controller);
  }

  const allSelected = filteredCompanies.length > 0 && filteredCompanies.every((c) => selectedIds.has(c.id));
  const hasRoles = selectedRoles.size > 0;
  const canSubmit = hasRoles && selectedIds.size > 0;

  const radioClass = (active: boolean) =>
    `rounded-lg border px-4 py-3 text-sm text-left transition-colors ${
      active
        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
        : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
    }`;

  return (
    <Card className="rounded-xl shadow-sm border-slate-200">
      <CardHeader>
        <CardTitle>Nova Prospecção</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* 1. Method radio group */}
          <div className="space-y-2">
            <Label>Método de busca</Label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMethod("full")} className={radioClass(method === "full")}>
                <p className="font-medium">Busca completa</p>
                <p className="text-xs text-slate-400 mt-0.5">Google + LinkedIn + Firecrawl</p>
              </button>
              <button type="button" onClick={() => setMethod("linkedin_direct")} className={radioClass(method === "linkedin_direct")}>
                <p className="font-medium">LinkedIn direto</p>
                <p className="text-xs text-slate-400 mt-0.5">LinkedIn + Firecrawl</p>
              </button>
            </div>
          </div>

          {/* 2. Company selection */}
          {/* Sector filter */}
          <div className="space-y-2">
            <Label>Filtrar por setor</Label>
            <Select value={sectorFilter} onValueChange={setSectorFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Todos os setores" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos os setores</SelectItem>
                {sectors.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Company checkboxes */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Empresas ({filteredCompanies.length})</Label>
              {filteredCompanies.length > 0 && (
                <label className="flex items-center gap-2 text-sm text-slate-600">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(checked) => handleSelectAll(checked === true)}
                  />
                  Selecionar todas
                </label>
              )}
            </div>

            {loadingCompanies ? (
              <p className="text-sm text-slate-400 py-4 text-center">Carregando empresas...</p>
            ) : filteredCompanies.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                Nenhuma empresa aprovada encontrada.
              </p>
            ) : (
              <div className="border rounded-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                {filteredCompanies.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer">
                    <Checkbox
                      checked={selectedIds.has(c.id)}
                      onCheckedChange={(checked) => handleToggleCompany(c.id, checked === true)}
                    />
                    <span className="flex-1 text-sm text-slate-700 truncate">{c.name}</span>
                    {c.sector && (
                      <Badge variant="secondary" className="text-xs shrink-0">{c.sector}</Badge>
                    )}
                    <Badge className={`text-xs font-semibold shrink-0 ${scoreBadgeClass(c.icp_score)}`}>
                      {c.icp_score}
                    </Badge>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 3. Target roles chips */}
          <div className="space-y-2">
            <Label>Cargos-alvo *</Label>
            {defaultRoles.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {defaultRoles.map((role) => (
                  <button key={role} type="button" onClick={() => handleToggleRole(role)}
                    className={`inline-flex items-center px-3 py-1 rounded-full text-sm border transition-colors ${
                      selectedRoles.has(role)
                        ? "bg-indigo-100 border-indigo-300 text-indigo-700"
                        : "bg-slate-50 border-slate-200 text-slate-400 line-through"
                    }`}>
                    {role}
                  </button>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input value={newRole} onChange={(e) => setNewRole(e.target.value)} onKeyDown={handleRoleKeyDown}
                placeholder="Adicionar cargo..." className="flex-1" />
              <Button type="button" variant="outline" size="sm" onClick={handleAddRole} disabled={!newRole.trim()}>
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Score mínimo</Label>
              <Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Quantidade de leads</Label>
              <Input type="number" min={1} max={20} value={quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
            </div>
          </div>

          <Button type="submit" disabled={isRunning || !canSubmit} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white">
            {isRunning ? "Prospectando..." : "Iniciar Prospecção"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
