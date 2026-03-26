"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Sparkles, Loader2 } from "lucide-react";
import type { Lead } from "@/lib/types/database";

const ENRICHMENT_LABELS: Record<string, string> = {
  phone: "Telefone",
  email: "E-mail",
  address: "Endereço",
  rating: "Avaliação",
  reviews_count: "Avaliações",
  category: "Categoria",
  business_hours: "Horário",
  description: "Descrição",
};

interface LeadDetailModalProps {
  lead: Lead;
  onClose: () => void;
}

export function LeadDetailModal({ lead, onClose }: LeadDetailModalProps) {
  const router = useRouter();
  const [enriching, setEnriching] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);

  const metadata = lead.company?.metadata ?? {};
  const isEnriched = Boolean(metadata.enriched_at);
  const enrichmentFields = Object.entries(ENRICHMENT_LABELS)
    .filter(([key]) => metadata[key] != null)
    .map(([key, label]) => ({ key, label, value: String(metadata[key]) }));

  async function handleEnrich() {
    setEnriching(true);
    setEnrichError(null);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: lead.id }),
      });
      if (!res.ok) throw new Error("Failed");
      router.refresh();
      onClose();
    } catch {
      setEnrichError("Erro ao enriquecer. Tente novamente.");
    } finally {
      setEnriching(false);
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            {lead.name}
            {lead.score && (
              <Badge>
                {lead.score}
                {(lead.metadata?.scoring as { total: number } | null)?.total
                  ? ` (${(lead.metadata.scoring as { total: number }).total}/100)`
                  : ""}
              </Badge>
            )}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-slate-500">{lead.role} — {lead.company?.name}</p>
            {lead.linkedin_url && (
              <a
                href={lead.linkedin_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-indigo-600 hover:underline"
              >
                Ver LinkedIn
              </a>
            )}
          </div>
          <Separator />
          <div>
            <h4 className="text-sm font-semibold mb-2">Validação</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <span>Foto: {lead.validation?.photo ? "✅" : "❌"}</span>
              <span>Conexões: {lead.connections ?? "—"}</span>
              <span>Cargo: {lead.validation?.role_match ? "✅" : "❌"}</span>
              <span>Atividade: {lead.validation?.activity ? "✅" : "❌"}</span>
            </div>
          </div>
          {(() => {
            const scoring = lead.metadata?.scoring as {
              total: number;
              dimensions: Record<string, { score: number; max: number; reason: string }>;
              justification: string;
            } | null;
            if (!scoring) return null;
            return (
              <>
                <Separator />
                <div>
                  <h4 className="text-sm font-semibold mb-2">
                    Qualificacao: {scoring.total}/100
                  </h4>
                  <div className="space-y-2 text-sm">
                    {Object.entries(scoring.dimensions).map(([key, dim]) => (
                      <div key={key} className="flex items-center gap-2">
                        <div className="w-24 text-slate-500 capitalize">
                          {key.replace("_", " ")}
                        </div>
                        <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-indigo-500 rounded-full"
                            style={{ width: `${(dim.score / dim.max) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-500 w-12 text-right">
                          {dim.score}/{dim.max}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-2 italic">{scoring.justification}</p>
                </div>
              </>
            );
          })()}
          {lead.message && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2">Mensagem LinkedIn</h4>
                <p className="text-sm bg-slate-50 rounded p-3">{lead.message}</p>
              </div>
            </>
          )}
          {lead.bant && Object.keys(lead.bant).length > 0 && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2">BANT</h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <span>Budget: {lead.bant.budget ?? "—"}</span>
                  <span>Authority: {lead.bant.authority ?? "—"}</span>
                  <span>Need: {lead.bant.need ?? "—"}</span>
                  <span>Timing: {lead.bant.timing ?? "—"}</span>
                </div>
              </div>
            </>
          )}
          <Separator />
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-sm font-semibold">Dados Enriquecidos</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleEnrich}
                disabled={enriching}
              >
                {enriching
                  ? <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  : <Sparkles className="h-4 w-4 text-amber-500 mr-1" />}
                {isEnriched ? "Re-enriquecer" : "Enriquecer"}
              </Button>
            </div>
            {enrichError && (
              <p className="text-sm text-red-500">{enrichError}</p>
            )}
            {enrichmentFields.length > 0 ? (
              <div className="grid grid-cols-1 gap-2 text-sm">
                {enrichmentFields.map(({ key, label, value }) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-slate-500 min-w-[80px]">{label}:</span>
                    <span>{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-400">
                {isEnriched ? "Enriquecido — nenhum dado encontrado" : "Não enriquecido"}
              </p>
            )}
          </div>
          {(lead.phone || lead.email) && (
            <>
              <Separator />
              <div>
                <h4 className="text-sm font-semibold mb-2">Contato</h4>
                <div className="grid grid-cols-1 gap-1 text-sm">
                  {lead.email && <span>Email: {lead.email}</span>}
                  {lead.phone && <span>Telefone: {lead.phone}</span>}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
