"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { LeadDetailModal } from "@/components/lead-detail-modal";
import { LayoutGrid, List, Search, Plus, Mail, Phone, Pencil, Trash2, Sparkles, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AddLeadModal } from "@/components/add-lead-modal";
import { LinkedinLeadsModal } from "@/components/linkedin-leads-modal";
import { EditLeadModal } from "@/components/edit-lead-modal";
import { ConfirmModal } from "@/components/confirm-modal";
import { deleteLead } from "@/app/(app)/contacts/actions";
import type { Lead } from "@/lib/types/database";

interface ContactsTableProps {
  leads: Lead[];
}

type ViewMode = "grid" | "table";
type SortOption = "name" | "score" | "date";

const VIEW_MODE_KEY = "contacts-view-mode";

const stageLabels: Record<string, string> = {
  identified: "Identificado",
  connected: "Conectado",
  in_conversation: "Em Conversa",
  converted: "Convertido",
  lost: "Perdido",
};

function getInitialColor(name: string): string {
  const letter = name.charAt(0).toUpperCase();
  if (letter >= "A" && letter <= "E") return "bg-indigo-500";
  if (letter >= "F" && letter <= "J") return "bg-emerald-500";
  if (letter >= "K" && letter <= "O") return "bg-amber-500";
  if (letter >= "P" && letter <= "T") return "bg-rose-500";
  return "bg-cyan-500";
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

function getScoreBadgeClasses(score: string | null): string {
  switch (score) {
    case "A+": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "A": return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "B": return "bg-amber-100 text-amber-700 border-amber-200";
    case "C": return "bg-slate-100 text-slate-600 border-slate-200";
    default: return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function sortLeads(leads: Lead[], sort: SortOption): Lead[] {
  const sorted = [...leads];
  switch (sort) {
    case "name":
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case "score": {
      const scoreOrder: Record<string, number> = { "A+": 0, "A": 1, "B": 2, "C": 3 };
      return sorted.sort((a, b) => {
        const sa = a.score ? (scoreOrder[a.score] ?? 4) : 4;
        const sb = b.score ? (scoreOrder[b.score] ?? 4) : 4;
        return sa - sb;
      });
    }
    case "date":
      return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    default:
      return sorted;
  }
}

export function ContactsTable({ leads }: ContactsTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [sortOption, setSortOption] = useState<SortOption>("date");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showLinkedinModal, setShowLinkedinModal] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deletingLead, setDeletingLead] = useState<Lead | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === "grid" || saved === "table") {
      setViewMode(saved);
    }
  }, []);

  function handleViewModeChange(mode: ViewMode) {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }

  async function handleEnrich(e: React.MouseEvent, leadId: string) {
    e.stopPropagation();
    setEnrichingId(leadId);
    setEnrichError(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      });
      if (!res.ok) throw new Error("Enrichment failed");
      router.refresh();
    } catch {
      setEnrichError("Erro ao enriquecer lead. Tente novamente.");
    } finally {
      setEnrichingId(null);
    }
  }

  const filtered = leads.filter((lead) => {
    const matchesSearch =
      lead.name.toLowerCase().includes(search.toLowerCase()) ||
      lead.company?.name?.toLowerCase().includes(search.toLowerCase());
    const matchesStage = stageFilter === "all" || lead.stage === stageFilter;
    return matchesSearch && matchesStage;
  });

  const sorted = sortLeads(filtered, sortOption);

  async function handleDelete() {
    if (!deletingLead) return;
    setDeleteLoading(true);
    try {
      await deleteLead(deletingLead.id);
      setDeletingLead(null);
    } catch {
      // error handled silently
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      {enrichError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex justify-between items-center">
          {enrichError}
          <button onClick={() => setEnrichError(null)} className="text-red-500 hover:text-red-700">x</button>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-auto sm:min-w-[200px] sm:flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome ou empresa..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={stageFilter} onValueChange={setStageFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Filtrar estágio" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="identified">Identificado</SelectItem>
            <SelectItem value="connected">Conectado</SelectItem>
            <SelectItem value="in_conversation">Em Conversa</SelectItem>
            <SelectItem value="converted">Convertido</SelectItem>
            <SelectItem value="lost">Perdido</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortOption} onValueChange={(v) => setSortOption(v as SortOption)}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Ordenar" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="name">Nome A-Z</SelectItem>
            <SelectItem value="score">Score</SelectItem>
            <SelectItem value="date">Data</SelectItem>
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => setShowLinkedinModal(true)}>
          <Sparkles className="h-4 w-4 mr-2" />
          Via LinkedIn
        </Button>
        <Button onClick={() => setShowAddModal(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white">
          <Plus className="h-4 w-4 mr-2" /> Adicionar
        </Button>

        <div className="flex rounded-lg border border-slate-200 overflow-hidden">
          <button
            onClick={() => handleViewModeChange("grid")}
            className={`p-2 transition-colors ${
              viewMode === "grid"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50"
            }`}
            title="Visualização em grade"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => handleViewModeChange("table")}
            className={`p-2 transition-colors ${
              viewMode === "table"
                ? "bg-indigo-600 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50"
            }`}
            title="Visualização em lista"
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === "grid" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sorted.map((lead) => (
            <Card
              key={lead.id}
              className="p-5 cursor-pointer hover:shadow-md transition-shadow border-slate-200"
              onClick={() => setSelectedLead(lead)}
            >
              <div className="flex flex-col items-center text-center mb-3">
                <div
                  className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold text-lg mb-2 ${getInitialColor(lead.name)}`}
                >
                  {getInitials(lead.name)}
                </div>
                <p className="font-semibold text-slate-900 truncate w-full">{lead.name}</p>
              </div>

              <div className="space-y-1 mb-3">
                {lead.email && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Mail className="h-3 w-3 shrink-0" />
                    <span className="truncate">{lead.email}</span>
                  </div>
                )}
                {lead.phone && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Phone className="h-3 w-3 shrink-0" />
                    <span className="truncate">{lead.phone}</span>
                  </div>
                )}
                {(lead.role || lead.company?.name) && (
                  <p className="text-xs text-slate-500 truncate">
                    {[lead.role, lead.company?.name].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {lead.score && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${getScoreBadgeClasses(lead.score)}`}>
                      {lead.score}
                    </span>
                  )}
                  {Boolean((lead.metadata as Record<string, unknown>)?.enriched_at) && (
                    <Sparkles className="h-3 w-3 text-amber-500" />
                  )}
                </div>
                <div className="flex gap-0.5">
                  <button
                    onClick={(e) => handleEnrich(e, lead.id)}
                    disabled={enrichingId === lead.id}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-amber-500 transition-colors"
                    title="Enriquecer"
                  >
                    {enrichingId === lead.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Sparkles className="h-3.5 w-3.5" />}
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setEditingLead(lead); }}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
                    title="Editar"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingLead(lead); }}
                    className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-red-500 transition-colors"
                    title="Excluir"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
          {sorted.length === 0 && (
            <div className="col-span-full text-center text-slate-400 py-12">
              Nenhum lead encontrado
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div className="rounded-lg border border-slate-200 bg-white overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Empresa</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Estágio</TableHead>
                <TableHead>Data</TableHead>
                <TableHead className="w-24">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((lead) => (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer hover:bg-slate-50"
                  onClick={() => setSelectedLead(lead)}
                >
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0 ${getInitialColor(lead.name)}`}
                      >
                        {getInitials(lead.name)}
                      </div>
                      {lead.name}
                    </div>
                  </TableCell>
                  <TableCell>{lead.company?.name}</TableCell>
                  <TableCell>{lead.role}</TableCell>
                  <TableCell>
                    {lead.score && (
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${getScoreBadgeClasses(lead.score)}`}>
                        {lead.score}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{stageLabels[lead.stage]}</TableCell>
                  <TableCell className="text-slate-500">
                    <div className="flex items-center gap-1">
                      {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                      {Boolean((lead.metadata as Record<string, unknown>)?.enriched_at) && (
                        <Sparkles className="h-3 w-3 text-amber-500" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => handleEnrich(e, lead.id)}
                        disabled={enrichingId === lead.id}
                        title="Enriquecer lead"
                      >
                        {enrichingId === lead.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Sparkles className="h-4 w-4 text-amber-500" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); setEditingLead(lead); }}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={(e) => { e.stopPropagation(); setDeletingLead(lead); }}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {sorted.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-slate-400 py-8">
                    Nenhum lead encontrado
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {selectedLead && (
        <LeadDetailModal lead={selectedLead} onClose={() => setSelectedLead(null)} />
      )}
      <AddLeadModal open={showAddModal} onOpenChange={setShowAddModal} />
      <LinkedinLeadsModal open={showLinkedinModal} onOpenChange={setShowLinkedinModal} />
      {editingLead && (
        <EditLeadModal
          lead={editingLead}
          open={!!editingLead}
          onOpenChange={(open) => { if (!open) setEditingLead(null); }}
        />
      )}
      <ConfirmModal
        open={!!deletingLead}
        onOpenChange={(open) => { if (!open) setDeletingLead(null); }}
        title="Excluir Lead"
        description={`Tem certeza que deseja excluir "${deletingLead?.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={handleDelete}
        loading={deleteLoading}
        variant="destructive"
      />
    </div>
  );
}
