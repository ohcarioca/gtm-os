"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Square } from "lucide-react";
import { LinkedInLoginModal } from "@/components/linkedin-login-modal";
import { stepConfig, defaultStepConfig } from "@/lib/agent/step-config";

interface LogEntry {
  step: string;
  message: string;
  timestamp: string;
}

interface AgentFeedProps {
  stream: ReadableStream | null;
  isRunning: boolean;
  onComplete: () => void;
  onCancel?: () => void;
}

export function AgentFeed({ stream, isRunning, onComplete, onCancel }: AgentFeedProps) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  function handleCancel() {
    // Cancel reader FIRST so it doesn't see the AbortError from fetch
    if (readerRef.current) {
      readerRef.current.cancel();
      readerRef.current = null;
    }
    // Then abort the fetch — signals the server to stop the pipeline
    onCancel?.();
    setEntries((prev) => [
      ...prev,
      { step: "cancelled", message: "Prospecção cancelada pelo usuário", timestamp: new Date().toISOString() },
    ]);
    onComplete();
  }

  useEffect(() => {
    if (!stream) return;

    setEntries([]);
    const reader = stream.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();

    async function read() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            const json = JSON.parse(line.replace("data: ", ""));
            if (json.done) {
              onComplete();
              return;
            }
            if (json.error) {
              setEntries((prev) => [...prev, { step: "error", message: json.error, timestamp: new Date().toISOString() }]);
              onComplete();
              return;
            }
            // Extract log entries from graph events
            const nodeData = Object.values(json)[0] as Record<string, unknown> | undefined;
            if (nodeData?.log) {
              const logs = nodeData.log as LogEntry[];
              setEntries((prev) => [...prev, ...logs]);
              if (logs.some((l) => l.step === "linkedin_auth_required")) {
                setShowLoginModal(true);
              }
            }
          }
        }
      } catch {
        // Reader was cancelled
      } finally {
        readerRef.current = null;
      }
    }

    read();
  }, [stream, onComplete]);

  return (
    <Card className="rounded-xl shadow-sm border-slate-200">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Progresso do Agente</CardTitle>
        {isRunning && (
          <Button variant="destructive" size="sm" onClick={handleCancel}>
            <Square className="mr-2 h-3 w-3 fill-current" />
            Cancelar
          </Button>
        )}
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[600px]">
          {entries.length === 0 ? (
            isRunning ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
                Iniciando busca...
              </div>
            ) : (
              <p className="text-sm text-slate-400">Aguardando inicio...</p>
            )
          ) : (
            <div className="space-y-2">
              {entries.map((entry, i) => {
                const config = stepConfig[entry.step] ?? defaultStepConfig;
                const Icon = config.icon;
                return (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <div className={`flex items-center justify-center w-7 h-7 rounded-full ${config.bg} shrink-0`}>
                      <Icon className={`w-3.5 h-3.5 ${config.text}`} />
                    </div>
                    <div>
                      <p className="text-slate-700 whitespace-pre-line">{entry.message}</p>
                      <p className="text-xs text-slate-400">
                        {new Date(entry.timestamp).toLocaleTimeString("pt-BR")}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </ScrollArea>
      </CardContent>
      <LinkedInLoginModal
        open={showLoginModal}
        onOpenChange={setShowLoginModal}
        onSuccess={() => setShowLoginModal(false)}
      />
    </Card>
  );
}
