# Code Quality Improvements — Design

**Date:** 2026-03-25
**Context:** Solo/MVP, surgical changes, zero risk of breaking existing functionality
**Approach:** By-layer — each layer is independent, commits small and isolated

---

## Camada 1 — Dados

### 1.1 Batch load de URLs processadas (find-lead.ts)
- **Problema:** `isAlreadyProcessed()` faz 2 queries sequenciais por candidato (leads + rejected_leads). 10 candidatos = 20 queries.
- **Fix:** Carregar todos os URLs processados uma vez no início do node com `Promise.all()`, guardar num `Set`, checar in-memory.

### 1.2 Adicionar user_id checks nas mutations (contacts/actions.ts, dashboard/actions.ts)
- **Problema:** `deleteLead()` e `updateLeadStage()` não filtram por `user_id`. RLS protege, mas é defense-in-depth.
- **Fix:** Adicionar `.eq("user_id", user.id)` nas mutations que estão sem.

### 1.3 Eliminar serviceSupabase do enrich route (api/enrich/route.ts)
- **Problema:** Usa `SUPABASE_SERVICE_ROLE_KEY` sem necessidade — bypassa RLS.
- **Fix:** Usar o client autenticado do usuário ao invés do service client.

---

## Camada 2 — Agente

### 2.1 Validar JSON.parse com try-catch (save-company.ts, analyze-company.ts)
- **Problema:** `JSON.parse(state.currentMarkdown)` sem try-catch. JSON malformado do Claude crasha o run inteiro.
- **Fix:** Wrap em try-catch, logar erro, skip company e continuar.

### 2.2 Timeout no fetch do Firecrawl (scrape-company.ts)
- **Problema:** `fetch()` sem timeout. Firecrawl travado = discovery pendurado.
- **Fix:** `signal: AbortSignal.timeout(30_000)`.

### 2.3 Sanitizar erros do Claude CLI (claude-cli.ts)
- **Problema:** Erros incluem stderr raw do subprocess — pode vazar env vars ou paths.
- **Fix:** Logar erro completo server-side, retornar mensagem genérica pro client.

### 2.4 Backoff exponencial nos retries do CLI (claude-cli.ts)
- **Problema:** Retry delay linear (3s, 6s, 9s). Rate-limit do CLI causa falhas repetidas.
- **Fix:** `base * 2^attempt` com jitter aleatório.

### 2.5 Dedup de companies por nome normalizado (save-company.ts)
- **Problema:** "Acme Corp" e "ACME Corp" são salvas como empresas separadas.
- **Fix:** Normalizar nome (lowercase, trim) antes do insert, checar duplicata.

---

## Camada 3 — Integração

### 3.1 Salt aleatório na encryption (encryption.ts)
- **Problema:** `scryptSync(secret, "salt", 32)` usa salt fixo. Todas as credentials derivam a mesma chave.
- **Fix:** Gerar salt aleatório por credential, formato `salt:iv:tag:encrypted`. Manter backward-compatibility com formato antigo.

### 3.2 Timeout no fetch do Google Search (google-search.ts)
- **Problema:** fetch sem timeout.
- **Fix:** `AbortSignal.timeout(15_000)`.

### 3.3 Retry com backoff no auth wall do LinkedIn (linkedin-playwright.ts)
- **Problema:** `isAuthWall()` pode dar falso positivo por latência de rede.
- **Fix:** Retry `page.goto()` 2x antes de declarar auth wall.

### 3.4 Fechar browser context em caso de erro (linkedin-playwright.ts)
- **Problema:** `launchPersistentContext()` falha pode criar Chromium zumbi.
- **Fix:** `browser.close()` no catch block.

---

## Camada 4 — UI

### 4.1 Extrair step config duplicado (agent-feed.tsx + chat-dashboard.tsx)
- **Problema:** Config de ícones/labels dos steps copiada em dois arquivos.
- **Fix:** Criar `lib/agent/step-config.ts`, importar nos dois lugares.

### 4.2 Error toasts nos catch blocks vazios
- **Problema:** Catches silenciosos em prospect-form.tsx, company-list.tsx, contacts-table.tsx. Operação falha sem feedback.
- **Fix:** `toast({ title: "Erro", description: error.message, variant: "destructive" })`.

### 4.3 Validar env vars no startup (lib/env.ts)
- **Problema:** Env vars obrigatórias checadas só quando usadas. Falha tardia e confusa.
- **Fix:** Criar `lib/env.ts` que valida no import e faz throw claro.

---

## Fora de Escopo (futuro)
- Split do chat-dashboard.tsx (requer apetite "moderado")
- Pagination nas queries de leads/companies (nice-to-have, volume baixo no MVP)
- Virtualização de listas (volume baixo no MVP)
- Rate limiting persistente (solo/MVP, desnecessário)
- CSRF tokens (Next.js Server Actions já protegem)
- i18n (solo user, mix PT/EN é aceitável)
- Suspense boundaries / skeleton loaders (nice-to-have)
