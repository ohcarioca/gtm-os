"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCompany } from "@/app/(app)/companies/actions";

interface AddCompanyModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddCompanyModal({ open, onOpenChange }: AddCompanyModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      await createCompany({
        name: form.get("name") as string,
        website: (form.get("website") as string) || undefined,
        sector: (form.get("sector") as string) || undefined,
        size: (form.get("size") as string) || undefined,
        region: (form.get("region") as string) || undefined,
        description: (form.get("description") as string) || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao adicionar empresa.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Empresa</DialogTitle>
          <DialogDescription>Adicione uma empresa manualmente à sua lista.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="company-name">Nome *</Label>
            <Input id="company-name" name="name" required placeholder="Nome da empresa" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-website">Website</Label>
            <Input id="company-website" name="website" type="url" placeholder="https://empresa.com" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="company-sector">Setor</Label>
              <Input id="company-sector" name="sector" placeholder="Fintech, SaaS..." />
            </div>
            <div className="space-y-2">
              <Label htmlFor="company-size">Tamanho</Label>
              <Input id="company-size" name="size" placeholder="11-50, 200+..." />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-region">Região</Label>
            <Input id="company-region" name="region" placeholder="São Paulo, Brasil" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="company-description">Descrição</Label>
            <Input id="company-description" name="description" placeholder="Breve descrição da empresa" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 text-white" disabled={loading}>
            {loading ? "Salvando..." : "Adicionar Empresa"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
