"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Loader2 } from "lucide-react";
import type { CompanyProfile } from "@/lib/types/database";

interface CompanyDiscoveryFormProps {
  companyProfile: CompanyProfile | null;
  onStart: (stream: ReadableStream, controller: AbortController) => void;
  onSubmitting?: () => void;
  isRunning: boolean;
}

const sizeOptions = [
  { value: "1-10", label: "1-10" },
  { value: "11-50", label: "11-50" },
  { value: "51-200", label: "51-200" },
  { value: "201-500", label: "201-500" },
  { value: "500+", label: "500+" },
];

export function CompanyDiscoveryForm({ companyProfile, onStart, onSubmitting, isRunning }: CompanyDiscoveryFormProps) {
  const [sector, setSector] = useState("");
  const [region, setRegion] = useState("");
  const [sizes, setSizes] = useState<string[]>([]);
  const [keywords, setKeywords] = useState("");
  const [freeText, setFreeText] = useState("");
  const [quantity, setQuantity] = useState(5);
  const [isAutoFilling, setIsAutoFilling] = useState(false);

  async function handleAutoFill() {
    if (!companyProfile) return;
    setIsAutoFilling(true);

    try {
      const response = await fetch("/api/companies/autofill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: companyProfile.name,
          sector: companyProfile.sector,
          icp: companyProfile.icp,
          valueProposition: companyProfile.value_proposition,
        }),
      });

      if (!response.ok) return;
      const suggestions = await response.json();

      if (suggestions.sector) setSector(suggestions.sector);
      if (suggestions.region) setRegion(suggestions.region);
      if (suggestions.sizes) setSizes(suggestions.sizes);
      if (suggestions.keywords) setKeywords(suggestions.keywords.join(", "));
      if (suggestions.freeText) setFreeText(suggestions.freeText);
    } catch {
      // Silently fail — user can fill manually
    } finally {
      setIsAutoFilling(false);
    }
  }

  function handleSizeToggle(size: string, checked: boolean) {
    setSizes((prev) =>
      checked ? [...prev, size] : prev.filter((s) => s !== size)
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    onSubmitting?.();

    const controller = new AbortController();
    const response = await fetch("/api/companies/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sector,
        region,
        sizes,
        keywords: keywords
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean),
        freeText: freeText || undefined,
        quantity,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body) return;
    onStart(response.body, controller);
  }

  return (
    <Card className="rounded-xl shadow-sm border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Descobrir Empresas</CardTitle>
        {companyProfile && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleAutoFill}
            disabled={isAutoFilling || isRunning}
            className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
          >
            <Sparkles className="mr-2 h-4 w-4" />
            {isAutoFilling ? "Preenchendo..." : "Preencher com IA"}
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Setor</Label>
            <Input
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Ex: Fintech, SaaS, E-commerce"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Regiao</Label>
            <Input
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              placeholder="Ex: Sao Paulo, Brasil"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Tamanho</Label>
            <div className="flex flex-wrap gap-3">
              {sizeOptions.map((opt) => (
                <label key={opt.value} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={sizes.includes(opt.value)}
                    onCheckedChange={(checked) =>
                      handleSizeToggle(opt.value, checked === true)
                    }
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Keywords</Label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="Ex: inteligencia artificial, machine learning"
            />
            <p className="text-xs text-slate-400">Separadas por virgula</p>
          </div>

          <div className="space-y-2">
            <Label>Contexto adicional</Label>
            <Textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="Informacoes extras sobre o tipo de empresa que voce busca..."
              maxLength={500}
              rows={3}
            />
            <p className="text-xs text-slate-400">{freeText.length}/500</p>
          </div>

          <div className="space-y-2">
            <Label>Quantidade</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
            />
          </div>

          <Button
            type="submit"
            disabled={isRunning || !sector || !region}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {isRunning ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Buscando empresas...
              </>
            ) : (
              "Buscar Empresas"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
