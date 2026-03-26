"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createLead } from "@/app/(app)/contacts/actions";

interface AddLeadModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddLeadModal({ open, onOpenChange }: AddLeadModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      await createLead({
        name: form.get("name") as string,
        company_name: form.get("company_name") as string,
        linkedin_url: form.get("linkedin_url") as string,
        role: (form.get("role") as string) || undefined,
        stage: (form.get("stage") as string) || undefined,
        score: (form.get("score") as string) || undefined,
        phone: (form.get("phone") as string) || undefined,
        email: (form.get("email") as string) || undefined,
        notes: (form.get("notes") as string) || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao criar lead.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Adicionar Lead</DialogTitle>
          <DialogDescription>Preencha os dados do lead manualmente.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="lead-name">Nome *</Label>
            <Input id="lead-name" name="name" required placeholder="Nome do contato" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-company">Empresa *</Label>
            <Input id="lead-company" name="company_name" required placeholder="Nome da empresa" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-linkedin">LinkedIn URL *</Label>
            <Input id="lead-linkedin" name="linkedin_url" required placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="lead-role">Cargo</Label>
              <Input id="lead-role" name="role" placeholder="CEO, CTO..." />
            </div>
            <div className="space-y-2">
              <Label>Estágio</Label>
              <Select name="stage" defaultValue="identified">
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="identified">Identificado</SelectItem>
                  <SelectItem value="connected">Conectado</SelectItem>
                  <SelectItem value="in_conversation">Em Conversa</SelectItem>
                  <SelectItem value="converted">Convertido</SelectItem>
                  <SelectItem value="lost">Perdido</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Score</Label>
              <Select name="score">
                <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="A+">A+</SelectItem>
                  <SelectItem value="A">A</SelectItem>
                  <SelectItem value="B">B</SelectItem>
                  <SelectItem value="C">C</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="lead-phone">Telefone</Label>
              <Input id="lead-phone" name="phone" placeholder="+55 11 99999-9999" />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-email">Email</Label>
            <Input id="lead-email" name="email" type="email" placeholder="email@empresa.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lead-notes">Notas</Label>
            <Input id="lead-notes" name="notes" placeholder="Observações sobre o lead" />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Adicionar Lead"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
