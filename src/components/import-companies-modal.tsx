"use client";

import { useState, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Upload, ArrowLeft, ArrowRight, FileSpreadsheet, AlertCircle } from "lucide-react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { importCompanies } from "@/app/(app)/companies/actions";

interface ImportCompaniesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = "upload" | "mapping" | "confirm";

const SYSTEM_FIELDS = [
  { key: "name", label: "Nome *", required: true },
  { key: "website", label: "Website", required: false },
  { key: "sector", label: "Setor", required: false },
  { key: "size", label: "Tamanho", required: false },
  { key: "region", label: "Região", required: false },
  { key: "description", label: "Descrição", required: false },
] as const;

type FieldKey = (typeof SYSTEM_FIELDS)[number]["key"];

export function ImportCompaniesModal({ open, onOpenChange }: ImportCompaniesModalProps) {
  const [step, setStep] = useState<Step>("upload");
  const [fileColumns, setFileColumns] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string>>({
    name: "", website: "", sector: "", size: "", region: "", description: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("upload");
    setFileColumns([]);
    setRawRows([]);
    setMapping({ name: "", website: "", sector: "", size: "", region: "", description: "" });
    setError(null);
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) reset();
    onOpenChange(isOpen);
  }

  function parseCSV(file: File) {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete(results) {
        const rows = results.data as Record<string, string>[];
        if (rows.length === 0) {
          setError("Arquivo vazio.");
          return;
        }
        if (rows.length > 50) {
          setError("Máximo de 50 empresas por importação.");
          return;
        }
        setFileColumns(Object.keys(rows[0]));
        setRawRows(rows);
        autoMap(Object.keys(rows[0]));
        setStep("mapping");
      },
      error() {
        setError("Erro ao ler o arquivo CSV.");
      },
    });
  }

  function parseXLSX(file: File) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target?.result, { type: "array" });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, { defval: "" });
        if (rows.length === 0) {
          setError("Arquivo vazio.");
          return;
        }
        if (rows.length > 50) {
          setError("Máximo de 50 empresas por importação.");
          return;
        }
        setFileColumns(Object.keys(rows[0]));
        setRawRows(rows);
        autoMap(Object.keys(rows[0]));
        setStep("mapping");
      } catch {
        setError("Erro ao ler o arquivo XLSX.");
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function autoMap(columns: string[]) {
    const lower = columns.map((c) => c.toLowerCase().trim());
    const newMapping = { name: "", website: "", sector: "", size: "", region: "", description: "" };
    const hints: Record<FieldKey, string[]> = {
      name: ["name", "nome", "empresa", "company", "razao social", "razão social"],
      website: ["website", "site", "url", "dominio", "domínio"],
      sector: ["sector", "setor", "industria", "indústria", "industry"],
      size: ["size", "tamanho", "porte", "employees", "funcionarios", "funcionários"],
      region: ["region", "regiao", "região", "city", "cidade", "location", "local"],
      description: ["description", "descricao", "descrição", "about", "sobre"],
    };
    for (const field of SYSTEM_FIELDS) {
      const idx = lower.findIndex((c) => hints[field.key].includes(c));
      if (idx !== -1) newMapping[field.key] = columns[idx];
    }
    setMapping(newMapping);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "csv") parseCSV(file);
    else if (ext === "xlsx" || ext === "xls") parseXLSX(file);
    else setError("Formato não suportado. Use CSV ou XLSX.");
  }

  const mappedRows = useCallback(() => {
    return rawRows
      .map((row) => {
        const mapped: Record<string, string> = {};
        for (const field of SYSTEM_FIELDS) {
          const col = mapping[field.key];
          mapped[field.key] = col ? (row[col] ?? "").trim() : "";
        }
        return mapped;
      })
      .filter((row) => row.name.length > 0);
  }, [rawRows, mapping]);

  const canAdvanceToConfirm = mapping.name !== "";

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      const rows = mappedRows();
      if (rows.length === 0) {
        setError("Nenhuma empresa válida para importar.");
        setLoading(false);
        return;
      }
      await importCompanies({
        companies: rows.map((r) => ({
          name: r.name,
          website: r.website || undefined,
          sector: r.sector || undefined,
          size: r.size || undefined,
          region: r.region || undefined,
          description: r.description || undefined,
        })),
      });
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao importar empresas.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Importar Empresas
          </DialogTitle>
          <DialogDescription>
            {step === "upload" && "Selecione um arquivo CSV ou XLSX com até 50 empresas."}
            {step === "mapping" && "Mapeie as colunas do arquivo para os campos do sistema."}
            {step === "confirm" && "Revise os dados e confirme a importação."}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 text-sm text-destructive bg-red-50 p-3 rounded-lg">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Step 1: Upload */}
        {step === "upload" && (
          <div className="space-y-4">
            <label className="flex flex-col items-center justify-center border-2 border-dashed border-slate-300 rounded-xl p-8 cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50 transition-colors">
              <Upload className="h-8 w-8 text-slate-400 mb-2" />
              <span className="text-sm text-slate-600">Clique para selecionar ou arraste o arquivo</span>
              <span className="text-xs text-slate-400 mt-1">.csv ou .xlsx — máximo 50 linhas</span>
              <input type="file" accept=".csv,.xlsx,.xls" onChange={handleFile} className="hidden" />
            </label>
          </div>
        )}

        {/* Step 2: Mapping */}
        {step === "mapping" && (
          <div className="space-y-4">
            <div className="space-y-3">
              {SYSTEM_FIELDS.map((field) => (
                <div key={field.key} className="flex items-center gap-3">
                  <Label className="w-28 text-right text-sm shrink-0">
                    {field.label}
                  </Label>
                  <Select
                    value={mapping[field.key]}
                    onValueChange={(v) => setMapping((prev) => ({ ...prev, [field.key]: v === "__skip__" ? "" : v }))}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Pular" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__skip__">Pular</SelectItem>
                      {fileColumns.map((col) => (
                        <SelectItem key={col} value={col}>{col}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <div className="border rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50">
                    {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th key={f.key} className="px-3 py-2 text-left font-medium text-slate-600">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawRows.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t">
                      {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="px-3 py-2 text-slate-700 truncate max-w-[200px]">
                          {row[mapping[f.key]] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawRows.length > 5 && (
                <p className="text-xs text-slate-400 px-3 py-2 bg-slate-50">
                  ... e mais {rawRows.length - 5} linhas
                </p>
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setStep("upload"); setError(null); }}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={() => setStep("confirm")}
                disabled={!canAdvanceToConfirm}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                Avançar <ArrowRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Confirm */}
        {step === "confirm" && (
          <div className="space-y-4">
            {rawRows.length !== mappedRows().length && (
              <div className="text-sm text-amber-700 bg-amber-50 p-3 rounded-lg">
                {rawRows.length - mappedRows().length} linhas removidas (sem nome).
              </div>
            )}

            <div className="border rounded-lg overflow-x-auto max-h-60">
              <table className="w-full text-xs">
                <thead className="sticky top-0">
                  <tr className="bg-slate-50">
                    {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                      <th key={f.key} className="px-3 py-2 text-left font-medium text-slate-600">{f.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mappedRows().map((row, i) => (
                    <tr key={i} className="border-t">
                      {SYSTEM_FIELDS.filter((f) => mapping[f.key]).map((f) => (
                        <td key={f.key} className="px-3 py-2 text-slate-700 truncate max-w-[200px]">
                          {row[f.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("mapping")}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
              <Button
                onClick={handleImport}
                disabled={loading || mappedRows().length === 0}
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
              >
                {loading ? "Importando..." : `Importar ${mappedRows().length} empresas`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
