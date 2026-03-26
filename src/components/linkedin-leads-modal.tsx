"use client";

import { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Plus, X, Loader2, AlertCircle, CheckCircle2, Trash2 } from "lucide-react";
import { saveLinkedinLeads } from "@/app/(app)/contacts/actions";
import { useRouter } from "next/navigation";

interface LinkedinLeadsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface LeadResult {
  url: string;
  status: "pending" | "processing" | "success" | "error" | "duplicate";
  error?: string;
  data?: {
    name: string;
    role: string;
    company_name: string;
    linkedin_url: string;
    score: string;
    score_total: number;
    email: string | null;
    phone: string | null;
    connections: number;
    about: string;
    message: string;
  };
}

function getScoreBadgeClasses(score: string): string {
  switch (score) {
    case "A+": return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "A": return "bg-indigo-100 text-indigo-700 border-indigo-200";
    case "B": return "bg-amber-100 text-amber-700 border-amber-200";
    case "C": return "bg-slate-100 text-slate-600 border-slate-200";
    default: return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

const LINKEDIN_URL_REGEX = /linkedin\.com\/in\//;

export function LinkedinLeadsModal({ open, onOpenChange }: LinkedinLeadsModalProps) {
  const router = useRouter();
  const [urls, setUrls] = useState<string[]>([""]);
  const [results, setResults] = useState<LeadResult[]>([]);
  const [phase, setPhase] = useState<"input" | "processing" | "preview">("input");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addUrlInput() {
    if (urls.length >= 10) return;
    setUrls([...urls, ""]);
  }

  function removeUrlInput(index: number) {
    if (urls.length <= 1) return;
    setUrls(urls.filter((_, i) => i !== index));
  }

  function updateUrl(index: number, value: string) {
    const updated = [...urls];
    updated[index] = value;
    setUrls(updated);
  }

  const validUrls = urls.filter((u) => u.trim() && LINKEDIN_URL_REGEX.test(u));

  const startProcessing = useCallback(async () => {
    if (validUrls.length === 0) return;
    setError(null);
    setPhase("processing");

    const initial: LeadResult[] = validUrls.map((url) => ({
      url: url.trim(),
      status: "pending",
    }));
    setResults(initial);

    try {
      const response = await fetch("/api/leads/from-linkedin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: validUrls.map((u) => u.trim()) }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: "Erro no servidor" }));
        setError(err.error || "Erro no servidor");
        setPhase("input");
        return;
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const dataLine = line.replace(/^data: /, "").trim();
          if (!dataLine) continue;

          try {
            const event = JSON.parse(dataLine);

            if (event.type === "processing") {
              setResults((prev) => prev.map((r, i) =>
                i === event.index ? { ...r, status: "processing" } : r
              ));
            }

            if (event.type === "result") {
              setResults((prev) => prev.map((r, i) =>
                i === event.index ? {
                  url: event.url,
                  status: event.status,
                  error: event.error,
                  data: event.data,
                } : r
              ));
            }

            if (event.type === "done") {
              setPhase("preview");
            }

            if (event.type === "error") {
              setError(event.error);
              setPhase("preview");
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }

      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro de conexao");
      setPhase("input");
    }
  }, [validUrls]);

  function removeResult(index: number) {
    setResults((prev) => prev.filter((_, i) => i !== index));
  }

  function updateResultField(index: number, field: string, value: string) {
    setResults((prev) => prev.map((r, i) => {
      if (i !== index || !r.data) return r;
      return { ...r, data: { ...r.data, [field]: value } };
    }));
  }

  const successResults = results.filter((r) => r.status === "success" && r.data);

  async function handleSave() {
    if (successResults.length === 0) return;
    setSaving(true);
    setError(null);

    try {
      await saveLinkedinLeads({
        leads: successResults.map((r) => ({
          name: r.data!.name,
          role: r.data!.role || undefined,
          company_name: r.data!.company_name,
          linkedin_url: r.data!.linkedin_url,
          score: r.data!.score || undefined,
          email: r.data!.email || undefined,
          phone: r.data!.phone || undefined,
          connections: r.data!.connections,
          about: r.data!.about || undefined,
          message: r.data!.message || undefined,
        })),
      });
      router.refresh();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao salvar leads");
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    setUrls([""]);
    setResults([]);
    setPhase("input");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className={phase === "input" ? "max-w-lg" : "max-w-4xl max-h-[90vh] overflow-y-auto"}>
        <DialogHeader>
          <DialogTitle>
            {phase === "input" && "Adicionar via LinkedIn"}
            {phase === "processing" && "Buscando perfis..."}
            {phase === "preview" && "Revisar leads"}
          </DialogTitle>
          <DialogDescription>
            {phase === "input" && "Cole os links de perfis do LinkedIn para criar leads automaticamente."}
            {phase === "processing" && "Extraindo dados e calculando score de cada perfil."}
            {phase === "preview" && "Revise os dados antes de salvar. Voce pode editar ou remover leads."}
          </DialogDescription>
        </DialogHeader>

        {/* Input phase */}
        {phase === "input" && (
          <div className="space-y-4">
            <div className="space-y-2">
              {urls.map((url, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={url}
                    onChange={(e) => updateUrl(i, e.target.value)}
                    placeholder="https://linkedin.com/in/nome-do-perfil"
                    className={url && !LINKEDIN_URL_REGEX.test(url) ? "border-red-300" : ""}
                  />
                  {urls.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeUrlInput(i)}
                      className="shrink-0"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {urls.length < 10 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addUrlInput}
                className="w-full"
              >
                <Plus className="h-4 w-4 mr-2" />
                Adicionar outro link
              </Button>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <Button
              onClick={startProcessing}
              disabled={validUrls.length === 0}
              className="w-full"
            >
              Buscar {validUrls.length} {validUrls.length === 1 ? "perfil" : "perfis"}
            </Button>
          </div>
        )}

        {/* Processing phase */}
        {phase === "processing" && (
          <div className="space-y-3">
            {results.map((r, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-lg border">
                {r.status === "pending" && (
                  <div className="h-4 w-4 rounded-full bg-slate-200" />
                )}
                {r.status === "processing" && (
                  <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                )}
                {r.status === "success" && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                )}
                {(r.status === "error" || r.status === "duplicate") && (
                  <AlertCircle className="h-4 w-4 text-red-500" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {r.data?.name || r.url}
                  </p>
                  {r.error && (
                    <p className="text-xs text-red-500">{r.error}</p>
                  )}
                  {r.data && (
                    <p className="text-xs text-slate-500">
                      {r.data.role} @ {r.data.company_name}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Preview phase */}
        {phase === "preview" && (
          <div className="space-y-4">
            {results.filter((r) => r.status !== "success").length > 0 && (
              <div className="space-y-1">
                {results.filter((r) => r.status !== "success").map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-slate-500">
                    <AlertCircle className="h-3 w-3 text-red-400" />
                    <span className="truncate">{r.url}</span>
                    <span className="text-red-500">&mdash; {r.error}</span>
                  </div>
                ))}
              </div>
            )}

            {successResults.length > 0 && (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Cargo</TableHead>
                      <TableHead>Empresa</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((r, i) => {
                      if (r.status !== "success" || !r.data) return null;
                      return (
                        <TableRow key={i}>
                          <TableCell>
                            <Input
                              value={r.data.name}
                              onChange={(e) => updateResultField(i, "name", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.data.role}
                              onChange={(e) => updateResultField(i, "role", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.data.company_name}
                              onChange={(e) => updateResultField(i, "company_name", e.target.value)}
                              className="h-8 text-sm"
                            />
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={getScoreBadgeClasses(r.data.score)}>
                              {r.data.score} ({r.data.score_total})
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Input
                              value={r.data.email || ""}
                              onChange={(e) => updateResultField(i, "email", e.target.value)}
                              className="h-8 text-sm"
                              placeholder="—"
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => removeResult(i)}
                              className="h-8 w-8"
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || successResults.length === 0}
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Salvando...
                  </>
                ) : (
                  `Salvar ${successResults.length} ${successResults.length === 1 ? "lead" : "leads"}`
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
