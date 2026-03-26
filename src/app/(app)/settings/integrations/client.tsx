"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Linkedin, Search, Loader2 } from "lucide-react";
import { saveApiKey, deleteApiKey } from "./actions";

interface SerperStatus {
  configured: boolean;
  lastChars: string;
}

export function IntegrationsClient({
  initialSerperStatus,
}: {
  initialSerperStatus: SerperStatus;
}) {
  const router = useRouter();
  const [linkedinConnected, setLinkedinConnected] = useState(false);
  const [linkedinLoading, setLinkedinLoading] = useState(false);
  const [linkedinPolling, setLinkedinPolling] = useState(false);
  const [linkedinChecked, setLinkedinChecked] = useState(false);
  const [serperSaving, setSerperSaving] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkLinkedinStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/linkedin/status");
      if (res.ok) {
        const data = await res.json();
        setLinkedinConnected(data.connected);
        return data.connected;
      }
    } catch {
      // ignore
    }
    return false;
  }, []);

  // Check LinkedIn status on mount
  useEffect(() => {
    checkLinkedinStatus().then(() => setLinkedinChecked(true));
  }, [checkLinkedinStatus]);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  async function handleLinkedinConnect() {
    setLinkedinLoading(true);
    try {
      const res = await fetch("/api/linkedin/login", { method: "POST" });
      if (!res.ok) {
        setLinkedinLoading(false);
        return;
      }

      // Start polling
      setLinkedinPolling(true);
      setLinkedinLoading(false);

      pollingRef.current = setInterval(async () => {
        const connected = await checkLinkedinStatus();
        if (connected) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;
          setLinkedinPolling(false);
        }
      }, 3000);
    } catch {
      setLinkedinLoading(false);
    }
  }

  async function handleSerperSave(formData: FormData) {
    setSerperSaving(true);
    try {
      await saveApiKey(formData);
      router.refresh();
    } finally {
      setSerperSaving(false);
    }
  }

  async function handleSerperDelete() {
    await deleteApiKey("serper");
    router.refresh();
  }

  return (
    <div className="space-y-4">
      {/* LinkedIn Card */}
      <Card className="rounded-xl shadow-sm border-slate-200 p-8">
        <CardContent className="p-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                <Linkedin className="h-5 w-5 text-blue-700" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  LinkedIn
                </h2>
                <p className="text-sm text-slate-500">
                  Navegador persistente para scraping
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {linkedinChecked && (
                <Badge
                  className={
                    linkedinConnected
                      ? "bg-green-100 text-green-700 border-green-200"
                      : "bg-red-100 text-red-700 border-red-200"
                  }
                >
                  {linkedinConnected ? "Conectado" : "Desconectado"}
                </Badge>
              )}
              {linkedinPolling ? (
                <Button disabled variant="outline" size="sm">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Aguardando login...
                </Button>
              ) : (
                <Button
                  onClick={handleLinkedinConnect}
                  disabled={linkedinLoading}
                  variant="outline"
                  size="sm"
                >
                  {linkedinLoading && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  {linkedinConnected ? "Reconectar" : "Conectar LinkedIn"}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Serper Card */}
      <Card className="rounded-xl shadow-sm border-slate-200 p-8">
        <CardContent className="p-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100">
                <Search className="h-5 w-5 text-amber-700" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Serper (Google Search)
                </h2>
                <p className="text-sm text-slate-500">
                  API de busca para prospecção
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge
                className={
                  initialSerperStatus.configured
                    ? "bg-green-100 text-green-700 border-green-200"
                    : "bg-red-100 text-red-700 border-red-200"
                }
              >
                {initialSerperStatus.configured
                  ? "Configurado"
                  : "Não configurado"}
              </Badge>
            </div>
          </div>

          <div className="mt-4">
            {initialSerperStatus.configured ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600 font-mono">
                  ••••••{initialSerperStatus.lastChars}
                </span>
                <Button
                  onClick={handleSerperDelete}
                  variant="outline"
                  size="sm"
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                >
                  Remover
                </Button>
              </div>
            ) : (
              <form action={handleSerperSave} className="flex items-center gap-3">
                <input type="hidden" name="service" value="serper" />
                <Input
                  name="key"
                  type="password"
                  placeholder="Cole sua API key do Serper"
                  required
                  className="max-w-sm"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={serperSaving}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {serperSaving && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Salvar
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
