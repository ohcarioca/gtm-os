"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface LinkedInLoginModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

export function LinkedInLoginModal({ open, onOpenChange, onSuccess }: LinkedInLoginModalProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleLogin() {
    setStatus("loading");
    setMessage("");

    try {
      const res = await fetch("/api/linkedin/login", { method: "POST" });
      const data = await res.json();

      if (data.success) {
        setStatus("success");
        setMessage(data.message);
        setTimeout(() => {
          onSuccess();
          onOpenChange(false);
          setStatus("idle");
          setMessage("");
        }, 1500);
      } else {
        setStatus("error");
        setMessage(data.message || "Falha no login");
      }
    } catch {
      setStatus("error");
      setMessage("Erro de conexão com o servidor");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Sessão do LinkedIn expirou</DialogTitle>
          <DialogDescription>
            O login automático falhou. Clique abaixo para reconectar usando suas credenciais salvas.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          {status === "success" && (
            <p className="text-sm text-green-600">{message}</p>
          )}
          {status === "error" && (
            <p className="text-sm text-red-600">{message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={status === "loading"}>
            Fechar
          </Button>
          <Button onClick={handleLogin} disabled={status === "loading" || status === "success"}>
            {status === "loading" ? "Conectando..." : "Reconectar LinkedIn"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
