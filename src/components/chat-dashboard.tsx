"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { LinkedInLoginModal } from "@/components/linkedin-login-modal";
import { createClient } from "@/lib/supabase/client";
import {
  Sun,
  Pencil,
  Sparkles,
  Send,
  Square,
  ArrowLeft,
} from "lucide-react";
import { stepConfig, defaultStepConfig } from "@/lib/agent/step-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChatState =
  | "idle"
  | "choosing_action"
  | "configuring_companies"
  | "configuring_companies_region"
  | "configuring_companies_quantity"
  | "configuring_leads"
  | "editing_roles"
  | "editing_companies"
  | "editing_quantity"
  | "confirming"
  | "running"
  | "results";

interface QuickAction {
  label: string;
  icon?: "pencil" | "sparkle";
  onClick: () => void;
}

interface ChatMessage {
  id: string;
  role: "system" | "user" | "agent";
  content: string;
  timestamp: Date;
  type?: "text" | "quick_actions" | "param_card" | "summary";
  quickActions?: QuickAction[];
}

interface LogEntry {
  step: string;
  message: string;
  timestamp: string;
}

interface ApprovedCompany {
  id: string;
  name: string;
  website: string | null;
  sector: string | null;
  icp_score: number;
}

interface CompanyProfileData {
  icp_company_types: string[];
  default_target_roles: string[];
  default_regions: string[];
}

interface ChatDashboardProps {
  firstName: string;
  approvedCount: number;
  companyProfile: CompanyProfileData | null;
  approvedCompanies: ApprovedCompany[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let msgCounter = 0;
function genId(): string {
  msgCounter += 1;
  return `msg-${Date.now()}-${msgCounter}`;
}


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ChatDashboard({
  firstName,
  approvedCount,
  companyProfile,
  approvedCompanies,
}: ChatDashboardProps) {
  // State machine
  const [state, setState] = useState<ChatState>("idle");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");

  // Running state
  const [isRunning, setIsRunning] = useState(false);
  const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
  const logEntriesRef = useRef<LogEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null);
  const foundCountRef = useRef(0);
  const runIdRef = useRef<string | null>(null);
  const [showLoginModal, setShowLoginModal] = useState(false);

  // Company discovery config
  const [cdSector, setCdSector] = useState(companyProfile ? "" : "");
  const [cdRegion, setCdRegion] = useState("");
  const [cdSizes, setCdSizes] = useState<string[]>([]);
  const [cdKeywords, setCdKeywords] = useState("");
  const [cdQuantity, setCdQuantity] = useState(5);

  // Lead config
  const [leadMethod, setLeadMethod] = useState<"full" | "linkedin_direct">("full");
  const [leadSelectedIds, setLeadSelectedIds] = useState<Set<string>>(
    new Set(approvedCompanies.map((c) => c.id))
  );
  const [leadRoles, setLeadRoles] = useState<Set<string>>(
    new Set(companyProfile?.default_target_roles ?? [])
  );
  const [leadMinScore, setLeadMinScore] = useState(70);
  const [leadQuantity, setLeadQuantity] = useState(5);

  // Results tracking
  const [resultsCount, setResultsCount] = useState(0);
  const [runType, setRunType] = useState<"leads" | "companies">("leads");

  // Keep logEntriesRef in sync for cancel handler
  useEffect(() => {
    logEntriesRef.current = logEntries;
  }, [logEntries]);

  // Auto-scroll
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, logEntries]);

  // -------------------------------------------------------------------------
  // Message helpers
  // -------------------------------------------------------------------------

  function addMessage(msg: Omit<ChatMessage, "id" | "timestamp">) {
    setMessages((prev) => [...prev, { ...msg, id: genId(), timestamp: new Date() }]);
  }

  function addAgentMessage(content: string, extras?: Partial<ChatMessage>) {
    addMessage({ role: "agent", content, ...extras });
  }

  function addUserMessage(content: string) {
    addMessage({ role: "user", content });
  }

  // -------------------------------------------------------------------------
  // Navigation actions
  // -------------------------------------------------------------------------

  function goToIdle() {
    setState("idle");
    setMessages([]);
    setLogEntries([]);
    setResultsCount(0);
  }

  function handleSearchCompanies() {
    addUserMessage("Buscar empresas");
    setState("configuring_companies");
    const suggestions = icpTypes.length > 0
      ? icpTypes.map((type) => ({
          label: type,
          icon: "pencil" as const,
          onClick: () => handleIcpShortcut(type),
        }))
      : undefined;
    addAgentMessage("Qual setor de empresas voce quer buscar?", {
      type: "quick_actions",
      quickActions: suggestions,
    });
  }

  function handleSearchLeads() {
    addUserMessage("Buscar Leads");
    if (approvedCount === 0) {
      setState("choosing_action");
      addAgentMessage(
        "Voce nao tem empresas aprovadas ainda. Quer que eu busque empresas primeiro?",
        {
          type: "quick_actions",
          quickActions: [
            { label: "Buscar empresas", icon: "pencil", onClick: handleSearchCompanies },
            { label: "Ir para Empresas", icon: "sparkle", onClick: () => window.location.assign("/companies") },
          ],
        }
      );
    } else {
      setState("choosing_action");
      addAgentMessage("Qual metodo de busca voce prefere?", {
        type: "quick_actions",
        quickActions: [
          {
            label: "Busca Completa",
            icon: "pencil",
            onClick: () => {
              setLeadMethod("full");
              addUserMessage("Busca Completa");
              showLeadSummary("full");
            },
          },
          {
            label: "LinkedIn Direto",
            icon: "sparkle",
            onClick: () => {
              setLeadMethod("linkedin_direct");
              addUserMessage("LinkedIn Direto");
              showLeadSummary("linkedin_direct");
            },
          },
        ],
      });
    }
  }

  function showLeadSummary(method?: "full" | "linkedin_direct") {
    const m = method ?? leadMethod;
    const roles = Array.from(leadRoles);
    const selectedCount = leadSelectedIds.size;
    const qty = leadQuantity;
    const minScore = leadMinScore;
    const companyIds = Array.from(leadSelectedIds);
    const methodLabel = m === "full" ? "Busca Completa" : "LinkedIn Direto";

    setState("configuring_leads");
    addAgentMessage(
      `Vou buscar ${qty} leads via ${methodLabel} em ${selectedCount} empresa${selectedCount > 1 ? "s" : ""} aprovada${selectedCount > 1 ? "s" : ""}.\n\nCargos-alvo: ${roles.length > 0 ? roles.join(", ") : "(nenhum definido)"}\nScore minimo: ${minScore}\n\nDeseja iniciar ou ajustar algo?`,
      {
        type: "quick_actions",
        quickActions: [
          { label: "Iniciar", icon: "sparkle", onClick: () => {
            // Use captured values to avoid stale closure
            if (roles.length === 0 || companyIds.length === 0) return;
            addUserMessage("Iniciar Prospeccao");
            setState("running");
            setIsRunning(true);
            setLogEntries([]);
            setRunType("leads");
            addAgentMessage("Iniciando prospeccao de leads...");
            startLeadProspecting(m, qty, companyIds, roles, minScore);
          }},
          { label: "Mudar cargos", icon: "pencil", onClick: () => {
            setState("editing_roles");
            addAgentMessage("Digite os cargos-alvo separados por virgula:");
          }},
          { label: "Mudar empresas", icon: "pencil", onClick: () => {
            setState("editing_companies");
            addAgentMessage(`Voce tem ${approvedCompanies.length} empresas aprovadas (${selectedCount} selecionadas). Quer selecionar todas ou escolher especificas?`, {
              type: "quick_actions",
              quickActions: [
                { label: "Todas", icon: "sparkle", onClick: () => {
                  toggleAllCompanies(true);
                  addUserMessage("Todas");
                  showLeadSummary(m);
                }},
                { label: "Escolher", icon: "pencil", onClick: () => {
                  addUserMessage("Escolher");
                  addAgentMessage("Digite os nomes das empresas separados por virgula:");
                }},
              ],
            });
          }},
          { label: `Quantidade: ${qty}`, icon: "pencil", onClick: () => {
            setState("editing_quantity");
            addAgentMessage("Quantos leads deseja buscar? (1-20)");
          }},
        ],
      }
    );
  }

  function handleFullSearch() {
    setLeadMethod("full");
    addUserMessage("Busca Completa");
    if (approvedCount === 0) {
      handleSearchCompanies();
    } else {
      showLeadSummary("full");
    }
  }

  function handleLinkedInDirect() {
    setLeadMethod("linkedin_direct");
    addUserMessage("LinkedIn Direto");
    if (approvedCount === 0) {
      handleSearchCompanies();
    } else {
      showLeadSummary("linkedin_direct");
    }
  }

  function handleIcpShortcut(type: string) {
    addUserMessage(`Buscar empresas: ${type}`);
    setCdSector(type);
    setState("configuring_companies_region");
    const regions = companyProfile?.default_regions ?? [];
    const regionSuggestions = regions.length > 0
      ? regions.map((r) => ({
          label: r,
          icon: "pencil" as const,
          onClick: () => {
            addUserMessage(r);
            const sector = type;
            const region = r;
            const qty = cdQuantity;
            setCdRegion(r);
            setState("configuring_companies_quantity");
            addAgentMessage(
              `Setor: "${sector}"\nRegiao: "${region}"\nQuantidade: ${qty}\n\nDeseja iniciar ou ajustar?`,
              {
                type: "quick_actions",
                quickActions: [
                  { label: "Iniciar", icon: "sparkle", onClick: () => {
                    addUserMessage("Iniciar Busca de Empresas");
                    setState("running");
                    setIsRunning(true);
                    setLogEntries([]);
                    setRunType("companies");
                    addAgentMessage("Iniciando busca de empresas...");
                    startCompanyDiscovery(sector, region, qty);
                  }},
                  { label: `Quantidade: ${qty}`, icon: "pencil", onClick: () => {
                    addAgentMessage("Quantas empresas deseja buscar? (1-20)");
                    setState("configuring_companies_quantity");
                  }},
                ],
              }
            );
          },
        }))
      : undefined;
    addAgentMessage(`Setor: "${type}". Em qual regiao?`, {
      type: "quick_actions",
      quickActions: regionSuggestions,
    });
  }

  // -------------------------------------------------------------------------
  // Confirm & Run
  // -------------------------------------------------------------------------

  function handleConfirmCompanies() {
    if (!cdSector || !cdRegion) return;
    addUserMessage("Iniciar Busca de Empresas");
    setState("confirming");
    setRunType("companies");
    addAgentMessage(
      `Buscar ${cdQuantity} empresas no setor "${cdSector}" em "${cdRegion}"${
        cdKeywords ? `, keywords: ${cdKeywords}` : ""
      }`,
      {
        type: "summary",
        quickActions: [
          { label: "Confirmar", icon: "sparkle", onClick: () => runCompanyDiscovery() },
          { label: "Ajustar", icon: "pencil", onClick: () => { setState("configuring_companies"); addAgentMessage("Ajuste os parametros:"); } },
        ],
      }
    );
  }

  function handleConfirmLeads() {
    const roles = Array.from(leadRoles);
    if (roles.length === 0 || leadSelectedIds.size === 0) return;
    addUserMessage("Iniciar Prospeccao");
    setState("confirming");
    setRunType("leads");
    const selectedCount = leadSelectedIds.size;
    addAgentMessage(
      `Buscar ${leadQuantity} leads em ${selectedCount} empresa${selectedCount > 1 ? "s" : ""}, cargos: ${roles.join(", ")}, metodo: ${leadMethod === "full" ? "Busca Completa" : "LinkedIn Direto"}`,
      {
        type: "summary",
        quickActions: [
          { label: "Confirmar", icon: "sparkle", onClick: () => runLeadProspecting() },
          { label: "Ajustar", icon: "pencil", onClick: () => { setState("configuring_leads"); addAgentMessage("Ajuste os parametros:"); } },
        ],
      }
    );
  }

  // -------------------------------------------------------------------------
  // SSE streaming (shared logic)
  // -------------------------------------------------------------------------

  const handleStreamComplete = useCallback((count: number) => {
    setIsRunning(false);
    abortRef.current = null;
    setResultsCount(count);
    setState("results");
  }, []);

  function processSSE(stream: ReadableStream, type: "leads" | "companies") {
    const reader = stream.getReader();
    readerRef.current = reader;
    const decoder = new TextDecoder();
    foundCountRef.current = 0;
    runIdRef.current = null;
    let foundCount = 0;

    async function read() {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const text = decoder.decode(value);
          const lines = text.split("\n").filter((l) => l.startsWith("data: "));

          for (const line of lines) {
            const json = JSON.parse(line.replace("data: ", ""));
            if (json.runId) {
              runIdRef.current = json.runId;
              continue;
            }
            if (json.done) {
              handleStreamComplete(foundCount);
              return;
            }
            if (json.error) {
              setLogEntries((prev) => [
                ...prev,
                { step: "error", message: json.error, timestamp: new Date().toISOString() },
              ]);
              handleStreamComplete(foundCount);
              return;
            }
            const nodeData = Object.values(json)[0] as Record<string, unknown> | undefined;
            if (nodeData?.log) {
              const logs = nodeData.log as LogEntry[];
              setLogEntries((prev) => [...prev, ...logs]);
              if (logs.some((l) => l.step === "linkedin_auth_required")) {
                setShowLoginModal(true);
              }
              // Count created leads or saved companies
              for (const log of logs) {
                if (
                  (type === "leads" && log.step === "create_lead") ||
                  (type === "companies" && log.step === "save_company")
                ) {
                  foundCount += 1;
                  foundCountRef.current = foundCount;
                }
              }
            }
          }
        }
      } catch {
        // Reader cancelled
      } finally {
        readerRef.current = null;
      }
    }

    read();
  }

  async function startCompanyDiscovery(sector: string, region: string, quantity: number) {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/companies/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sector,
          region,
          sizes: cdSizes,
          keywords: cdKeywords.split(",").map((k) => k.trim()).filter(Boolean),
          quantity,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        addAgentMessage("Erro ao iniciar busca de empresas.");
        handleStreamComplete(0);
        return;
      }

      processSSE(response.body, "companies");
    } catch {
      addAgentMessage("Erro de conexao.");
      handleStreamComplete(0);
    }
  }

  async function runCompanyDiscovery() {
    addUserMessage("Confirmar");
    setState("running");
    setIsRunning(true);
    setLogEntries([]);
    setRunType("companies");
    addAgentMessage("Iniciando busca de empresas...");
    startCompanyDiscovery(cdSector, cdRegion, cdQuantity);
  }

  async function startLeadProspecting(
    method: "full" | "linkedin_direct",
    quantity: number,
    companyIds: string[],
    roles: string[],
    minScore: number,
  ) {
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch("/api/prospect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method,
          quantity,
          company_ids: companyIds,
          target_roles: roles,
          min_score_threshold: minScore,
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        addAgentMessage("Erro ao iniciar prospeccao.");
        handleStreamComplete(0);
        return;
      }

      processSSE(response.body, "leads");
    } catch {
      addAgentMessage("Erro de conexao.");
      handleStreamComplete(0);
    }
  }

  async function runLeadProspecting() {
    addUserMessage("Confirmar");
    setState("running");
    setIsRunning(true);
    setLogEntries([]);
    setRunType("leads");
    addAgentMessage("Iniciando prospeccao de leads...");
    startLeadProspecting(leadMethod, leadQuantity, Array.from(leadSelectedIds), Array.from(leadRoles), leadMinScore);
  }

  function handleCancel() {
    if (readerRef.current) {
      readerRef.current.cancel();
      readerRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    const cancelEntry = { step: "cancelled", message: "Operacao cancelada pelo usuario", timestamp: new Date().toISOString() };
    setLogEntries((prev) => [...prev, cancelEntry]);
    setIsRunning(false);
    setResultsCount(foundCountRef.current);
    setState("results");

    // Update agent_run in DB (server handler may not complete after abort)
    if (runIdRef.current) {
      const cancelLog = [...logEntriesRef.current, cancelEntry];
      const supabase = createClient();
      supabase.from("agent_runs").update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        log: cancelLog,
      }).eq("id", runIdRef.current).then(() => {
        runIdRef.current = null;
      });
    }
  }

  // -------------------------------------------------------------------------
  // Text input handler
  // -------------------------------------------------------------------------

  function handleInputSubmit() {
    const text = inputValue.trim();
    if (!text) return;
    setInputValue("");

    addUserMessage(text);

    // Handle conversational company config flow
    if (state === "configuring_companies") {
      setCdSector(text);
      setState("configuring_companies_region");
      const regions = companyProfile?.default_regions ?? [];
      const regionSuggestions = regions.length > 0
        ? regions.map((r) => ({
            label: r,
            icon: "pencil" as const,
            onClick: () => {
              addUserMessage(r);
              const sector = text;
              const region = r;
              const qty = cdQuantity;
              setCdRegion(r);
              setState("configuring_companies_quantity");
              addAgentMessage(
                `Setor: "${sector}"\nRegiao: "${region}"\nQuantidade: ${qty}\n\nDeseja iniciar ou ajustar?`,
                {
                  type: "quick_actions",
                  quickActions: [
                    { label: "Iniciar", icon: "sparkle", onClick: () => {
                      addUserMessage("Iniciar Busca de Empresas");
                      setState("running");
                      setIsRunning(true);
                      setLogEntries([]);
                      setRunType("companies");
                      addAgentMessage("Iniciando busca de empresas...");
                      startCompanyDiscovery(sector, region, qty);
                    }},
                    { label: `Quantidade: ${qty}`, icon: "pencil", onClick: () => {
                      addAgentMessage("Quantas empresas deseja buscar? (1-20)");
                      setState("configuring_companies_quantity");
                    }},
                  ],
                }
              );
            },
          }))
        : undefined;
      addAgentMessage(`Setor: "${text}". Em qual regiao?`, {
        type: "quick_actions",
        quickActions: regionSuggestions,
      });
      return;
    }
    if (state === "configuring_companies_region") {
      // Capture values now since setCdRegion is async
      const sector = cdSector;
      const region = text;
      const qty = cdQuantity;
      setCdRegion(text);
      setState("configuring_companies_quantity");

      const defaultRegions = companyProfile?.default_regions ?? [];
      // Show region suggestions if available and user might want to add more
      addAgentMessage(
        `Setor: "${sector}"\nRegiao: "${region}"\nQuantidade: ${qty}\n\nDeseja iniciar ou ajustar?`,
        {
          type: "quick_actions",
          quickActions: [
            { label: "Iniciar", icon: "sparkle", onClick: () => {
              // Use captured values directly to avoid stale closure
              if (!sector || !region) return;
              addUserMessage("Iniciar Busca de Empresas");
              setState("running");
              setIsRunning(true);
              setLogEntries([]);
              setRunType("companies");
              addAgentMessage("Iniciando busca de empresas...");
              startCompanyDiscovery(sector, region, qty);
            }},
            { label: `Quantidade: ${qty}`, icon: "pencil", onClick: () => {
              addAgentMessage("Quantas empresas deseja buscar? (1-20)");
              setState("configuring_companies_quantity");
            }},
            { label: "Adicionar keywords", icon: "pencil", onClick: () => {
              addAgentMessage("Digite keywords separadas por virgula:");
              setState("configuring_companies");
            }},
          ],
        }
      );
      return;
    }
    if (state === "configuring_companies_quantity") {
      const num = parseInt(text);
      if (num >= 1 && num <= 20) {
        setCdQuantity(num);
        addAgentMessage(`Quantidade atualizada para ${num}. Pronto para iniciar?`, {
          type: "quick_actions",
          quickActions: [
            { label: "Iniciar", icon: "sparkle", onClick: handleConfirmCompanies },
            { label: "Ajustar", icon: "pencil", onClick: () => {
              setState("configuring_companies");
              addAgentMessage("Qual setor de empresas voce quer buscar?");
            }},
          ],
        });
      } else {
        addAgentMessage("Quantidade deve ser entre 1 e 20. Tente novamente:");
      }
      return;
    }

    // Handle lead editing states
    if (state === "editing_roles") {
      const newRoles = text.split(",").map(r => r.trim()).filter(Boolean);
      setLeadRoles(new Set(newRoles));
      addAgentMessage(`Cargos atualizados: ${newRoles.join(", ")}`);
      showLeadSummary();
      return;
    }
    if (state === "editing_companies") {
      const names = text.split(",").map(n => n.trim().toLowerCase()).filter(Boolean);
      const matched = approvedCompanies.filter(c =>
        names.some(n => c.name.toLowerCase().includes(n))
      );
      if (matched.length > 0) {
        setLeadSelectedIds(new Set(matched.map(c => c.id)));
        addAgentMessage(`Selecionadas ${matched.length} empresa${matched.length > 1 ? "s" : ""}: ${matched.map(c => c.name).join(", ")}`);
      } else {
        addAgentMessage("Nenhuma empresa encontrada com esses nomes. Mantendo selecao atual.");
      }
      showLeadSummary();
      return;
    }
    if (state === "editing_quantity") {
      const num = parseInt(text);
      if (num >= 1 && num <= 20) {
        setLeadQuantity(num);
        addAgentMessage(`Quantidade atualizada para ${num}.`);
        showLeadSummary();
      } else {
        addAgentMessage("Quantidade deve ser entre 1 e 20. Tente novamente:");
      }
      return;
    }

    // Default: intent detection from idle/other states
    const lower = text.toLowerCase();
    if (lower.includes("empresa") && (lower.includes("busca") || lower.includes("descobr") || lower.includes("encontr"))) {
      handleSearchCompanies();
    } else if (lower.includes("lead") || lower.includes("prospeccao") || lower.includes("prospectar")) {
      handleSearchLeads();
    } else if (lower.includes("linkedin direto")) {
      handleLinkedInDirect();
    } else if (lower.includes("busca completa")) {
      handleFullSearch();
    } else {
      addAgentMessage(
        "Nao entendi. Escolha uma das opcoes abaixo:",
        {
          type: "quick_actions",
          quickActions: [
            { label: "Buscar empresas", icon: "pencil", onClick: handleSearchCompanies },
            { label: "Buscar Leads", icon: "sparkle", onClick: handleSearchLeads },
          ],
        }
      );
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleInputSubmit();
    }
  }

  // -------------------------------------------------------------------------
  // Toggle helpers
  // -------------------------------------------------------------------------

  function toggleAllCompanies(checked: boolean) {
    if (checked) {
      setLeadSelectedIds(new Set(approvedCompanies.map((c) => c.id)));
    } else {
      setLeadSelectedIds(new Set());
    }
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const icpTypes = companyProfile?.icp_company_types ?? [];

  function renderQuickActionButton(action: QuickAction) {
    const IconComp = action.icon === "sparkle" ? Sparkles : Pencil;
    return (
      <button
        key={action.label}
        onClick={action.onClick}
        className="inline-flex items-center gap-1.5 rounded-full border border-stone-200/80 bg-white/80 backdrop-blur-sm px-3.5 py-1.5 text-[13px] text-stone-600 transition-all hover:border-stone-300 hover:bg-white hover:text-stone-900 hover:shadow-sm"
      >
        <IconComp className="h-3 w-3" />
        {action.label}
      </button>
    );
  }

  function renderMessage(msg: ChatMessage) {
    if (msg.role === "user") {
      return (
        <div key={msg.id} className="flex justify-end">
          <div className="max-w-[70%] rounded-3xl bg-stone-100 px-5 py-3 text-[15px] text-stone-800 leading-relaxed">
            {msg.content}
          </div>
        </div>
      );
    }

    return (
      <div key={msg.id} className="flex justify-start">
        <div className="max-w-[85%] space-y-3">
          <div className="text-[15px] text-stone-700 leading-relaxed whitespace-pre-line">
            {msg.content}
          </div>
          {msg.quickActions && msg.quickActions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {msg.quickActions.map(renderQuickActionButton)}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderLogEntries() {
    return logEntries.map((entry, i) => {
      const config = stepConfig[entry.step] ?? defaultStepConfig;
      const Icon = config.icon;
      return (
        <div key={i} className="flex items-start gap-3 text-sm">
          <div className={`flex items-center justify-center w-6 h-6 rounded-full ${config.bg} shrink-0 mt-0.5`}>
            <Icon className={`w-3 h-3 ${config.text}`} />
          </div>
          <div className="min-w-0">
            <p className="text-stone-600 whitespace-pre-line leading-relaxed">{entry.message}</p>
            <p className="text-xs text-stone-400 mt-0.5">
              {new Date(entry.timestamp).toLocaleTimeString("pt-BR")}
            </p>
          </div>
        </div>
      );
    });
  }

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  const showGreeting = state === "idle" && messages.length === 0;
  const isConfigState = state === "choosing_action" || state === "configuring_companies" || state === "configuring_companies_region" || state === "configuring_companies_quantity" || state === "configuring_leads" || state === "editing_roles" || state === "editing_companies" || state === "editing_quantity";

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)] w-full">
      {/* Scrollable message area — full height, no border */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        <div className="max-w-2xl mx-auto px-6 py-4 space-y-4">
          {/* Greeting */}
          {showGreeting && (
            <div className="flex flex-col items-center justify-center pt-24 pb-12 space-y-3">
              <div className="flex items-center gap-2">
                <Sun className="h-8 w-8 text-amber-500" />
              </div>
              <h1 className="text-3xl font-semibold text-stone-800 tracking-tight">
                Ola, {firstName}
              </h1>
            </div>
          )}

          {/* Messages */}
          {messages.length > 0 && (
            <div className="space-y-5">
              {messages.map(renderMessage)}
            </div>
          )}

          {/* Running */}
          {state === "running" && (
            <div className="space-y-3">
              {logEntries.length === 0 && isRunning && (
                <div className="flex items-center gap-2.5 text-sm text-stone-500">
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500" />
                  Iniciando...
                </div>
              )}
              {renderLogEntries()}
              {isRunning && logEntries.length > 0 && (
                <div className="flex items-center gap-2.5 text-sm text-stone-400 pt-1">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-stone-200 border-t-stone-400" />
                  Processando...
                </div>
              )}
            </div>
          )}

          {/* Results */}
          {state === "results" && (
            <div className="space-y-3">
              <p className="text-[15px] text-stone-700 leading-relaxed">
                {resultsCount > 0
                  ? runType === "leads"
                    ? `Encontrei ${resultsCount} lead${resultsCount > 1 ? "s" : ""}!`
                    : `Encontrei ${resultsCount} empresa${resultsCount > 1 ? "s" : ""}!`
                  : "Busca finalizada. Nenhum resultado novo encontrado."}
              </p>
              <div className="flex flex-wrap gap-2">
                {renderQuickActionButton({
                  label: "Ver resultados",
                  icon: "sparkle",
                  onClick: () => window.location.assign(runType === "leads" ? "/contacts" : "/companies"),
                })}
                {renderQuickActionButton({
                  label: "Buscar mais",
                  icon: "pencil",
                  onClick: () => {
                    setMessages([]);
                    setLogEntries([]);
                    setState(runType === "leads" ? "configuring_leads" : "configuring_companies");
                    addAgentMessage("Configure os parametros:");
                  },
                })}
                {renderQuickActionButton({
                  label: "Nova busca",
                  icon: "sparkle",
                  onClick: goToIdle,
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar — Claude-style floating input */}
      <div className="shrink-0 pb-3 pt-1 px-6">
        <div className="max-w-2xl mx-auto space-y-3">
          {/* Quick actions for idle */}
          {state === "idle" && (
            <div className="flex flex-wrap justify-center gap-2">
              {renderQuickActionButton({
                label: "Buscar empresas",
                icon: "pencil",
                onClick: handleSearchCompanies,
              })}
              {renderQuickActionButton({
                label: "Buscar Leads",
                icon: "sparkle",
                onClick: handleSearchLeads,
              })}
            </div>
          )}

          {/* Cancel */}
          {state === "running" && isRunning && (
            <div className="flex justify-center">
              <button onClick={handleCancel} className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3.5 py-1.5 text-[13px] text-red-600 transition-all hover:bg-red-50 hover:border-red-300">
                <Square className="h-3 w-3 fill-current" />
                Cancelar
              </button>
            </div>
          )}

          {/* Back */}
          {isConfigState && (
            <div className="flex justify-start">
              <button onClick={goToIdle} className="inline-flex items-center gap-1 text-[13px] text-stone-400 hover:text-stone-600 transition-colors">
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </button>
            </div>
          )}

          {/* Input bar */}
          {state !== "running" && (
            <div className="relative flex items-center rounded-2xl border border-stone-200/80 bg-white shadow-sm transition-shadow focus-within:shadow-md focus-within:border-stone-300">
              <input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Como posso te ajudar hoje?"
                className="flex-1 bg-transparent px-4 py-3 text-[15px] text-stone-800 placeholder:text-stone-400 outline-none"
              />
              <button
                onClick={handleInputSubmit}
                disabled={!inputValue.trim()}
                className="mr-2 flex items-center justify-center w-8 h-8 rounded-full bg-stone-800 text-white transition-all hover:bg-stone-700 disabled:opacity-30 disabled:hover:bg-stone-800"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      <LinkedInLoginModal
        open={showLoginModal}
        onOpenChange={setShowLoginModal}
        onSuccess={() => setShowLoginModal(false)}
      />
    </div>
  );
}
