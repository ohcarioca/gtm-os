"use client";

import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateLead } from "@/app/(app)/contacts/actions";
import type { Lead } from "@/lib/types/database";

interface EditLeadModalProps {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditLeadModal({ lead, open, onOpenChange }: EditLeadModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const form = new FormData(e.currentTarget);
    try {
      await updateLead({
        id: lead.id,
        name: (form.get("name") as string) || undefined,
        role: (form.get("role") as string) || undefined,
        linkedin_url: (form.get("linkedin_url") as string) || undefined,
        stage: (form.get("stage") as string) || undefined,
        score: (form.get("score") as string) || undefined,
        phone: (form.get("phone") as string) || undefined,
        email: (form.get("email") as string) || undefined,
        notes: (form.get("notes") as string) || undefined,
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao atualizar lead.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar Lead</DialogTitle>
          <DialogDescription>Atualize os dados do lead.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input id="edit-name" name="name" defaultValue={lead.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-linkedin">LinkedIn URL</Label>
            <Input id="edit-linkedin" name="linkedin_url" defaultValue={lead.linkedin_url ?? ""} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-role">Cargo</Label>
              <Input id="edit-role" name="role" defaultValue={lead.role ?? ""} />
            </div>
            <div className="space-y-2">
              <Label>Estágio</Label>
              <Select name="stage" defaultValue={lead.stage}>
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
              <Select name="score" defaultValue={lead.score ?? undefined}>
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
              <Label htmlFor="edit-phone">Telefone</Label>
              <Input id="edit-phone" name="phone" defaultValue={lead.phone ?? ""} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-email">Email</Label>
            <Input id="edit-email" name="email" type="email" defaultValue={lead.email ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notas</Label>
            <Input id="edit-notes" name="notes" defaultValue={lead.notes ?? ""} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Salvando..." : "Salvar Alterações"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
