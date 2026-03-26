"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ProspectForm } from "@/components/prospect-form";
import { AgentFeed } from "@/components/agent-feed";

export function ProspectClient() {
  const [stream, setStream] = useState<ReadableStream | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [dailyUsage, setDailyUsage] = useState<{ used: number; limit: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetch("/api/prospect")
      .then((r) => r.ok ? r.json() : null)
      .then(setDailyUsage)
      .catch(() => null);
  }, []);

  function handleSubmitting() {
    setIsRunning(true);
    setStream(null);
  }

  function handleStart(newStream: ReadableStream, controller: AbortController) {
    abortRef.current = controller;
    setStream(newStream);
  }

  const handleComplete = useCallback(() => {
    abortRef.current = null;
    setIsRunning(false);
  }, []);

  function handleCancel() {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold text-slate-900">Prospectar</h2>
      {dailyUsage && dailyUsage.used >= dailyUsage.limit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <strong>Limite diario do LinkedIn atingido</strong> ({dailyUsage.used}/{dailyUsage.limit} perfis).
          A prospeccao continuara usando validacao simplificada ate amanha.
        </div>
      )}
      {dailyUsage && dailyUsage.used >= dailyUsage.limit * 0.8 && dailyUsage.used < dailyUsage.limit && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-700">
          <strong>Atencao:</strong> {dailyUsage.used}/{dailyUsage.limit} perfis LinkedIn consultados hoje.
          Restam {dailyUsage.limit - dailyUsage.used} consultas.
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ProspectForm
          onStart={handleStart}
          onSubmitting={handleSubmitting}
          isRunning={isRunning}
        />
        <AgentFeed stream={stream} isRunning={isRunning} onComplete={handleComplete} onCancel={handleCancel} />
      </div>
    </div>
  );
}
