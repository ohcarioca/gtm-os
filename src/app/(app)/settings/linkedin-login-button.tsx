"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function LinkedInLoginButton() {
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
      } else {
        setStatus("error");
        setMessage(data.message);
      }
    } catch {
      setStatus("error");
      setMessage("Erro de conexão");
    }
  }

  return (
    <div className="mt-4 space-y-2">
      <Button
        type="button"
        variant="outline"
        onClick={handleLogin}
        disabled={status === "loading"}
      >
        {status === "loading" ? "Testando..." : "Testar Login"}
      </Button>
      {status === "success" && (
        <p className="text-sm text-green-600">{message}</p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600">{message}</p>
      )}
    </div>
  );
}
