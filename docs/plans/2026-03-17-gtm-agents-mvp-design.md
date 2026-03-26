# GTM Agents MVP — Design Document

**Data:** 2026-03-17
**Status:** Aprovado

---

## Visão Geral

Plataforma SaaS de prospecção outbound B2B automatizada com agentes de IA. O sistema encontra empresas, identifica decisores, valida perfis no LinkedIn e cria leads estruturados com mensagens personalizadas — tudo de forma end-to-end com aprovação mínima do usuário.

Segmentos são genéricos e configuráveis (ISPs, Assessorias, SaaS, etc.).

## Stack Tecnológico

| Camada | Tecnologia |
|---|---|
| Frontend | Next.js 14 (App Router), Tailwind CSS, shadcn/ui |
| Agent Framework | LangGraph.js + Claude API |
| Google Search | SerpAPI |
| LinkedIn Scraping | stickerdaniel/linkedin-mcp-server (Patchright) |
| Database | Supabase (Postgres + Auth + RLS) |
| Auth | Supabase Auth (email + senha) |

## Data Model

### segments
| Campo | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| name | text | "ISPs", "SaaS B2B", etc. |
| description | text | |
| target_roles | text[] | ["CEO", "Diretor Comercial"] |
| search_terms | text[] | ["provedor fibra", "assessoria cobrança"] |
| created_at | timestamptz | |

### companies
| Campo | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| segment_id | uuid FK → segments | |
| name | text | |
| city | text | |
| state | text | |
| size | text | "small", "medium", "large" |
| website | text | |
| linkedin_url | text | |
| metadata | jsonb | dados extras flexíveis |
| created_at | timestamptz | |

### leads
| Campo | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| company_id | uuid FK → companies | |
| name | text | |
| role | text | |
| linkedin_url | text | |
| photo_url | text | |
| connections | int | |
| recent_activity | text | |
| stage | text | 'identified', 'connected', 'in_conversation', 'converted', 'lost' |
| score | text | 'A+', 'A', 'B', 'C' |
| bant | jsonb | {budget, authority, need, timing} |
| message | text | mensagem LinkedIn gerada |
| validation | jsonb | {photo, connections, role_match, activity} |
| created_at | timestamptz | |
| updated_at | timestamptz | |

### agent_runs
| Campo | Tipo | Descrição |
|---|---|---|
| id | uuid PK | |
| segment_id | uuid FK → segments | |
| region | text | |
| quantity | int | |
| status | text | "running", "completed", "failed" |
| leads_found | int | |
| leads_approved | int | |
| log | jsonb[] | array de steps com timestamps |
| started_at | timestamptz | |
| finished_at | timestamptz | |

## Pipeline (5 estágios)

Identificado → Conectado → Em Conversa → Convertido → Perdido

## Fluxo do Agente (LangGraph)

1. **START** — Carrega config do segmento (roles-alvo, search_terms)
2. **STEP 1 — Google Search** — SerpAPI busca empresas por search_terms + região
3. **STEP 2 — Google Dork** — SerpAPI: `site:linkedin.com/in "[empresa]" + target_roles`
4. **STEP 3 — LinkedIn Validate** — MCP server extrai: foto, conexões, cargo, atividade recente
5. **STEP 3b — Decisão** — Se inválido, volta ao STEP 1 (máx 3 retries por slot)
6. **STEP 4 — Create Lead** — Claude gera mensagem + BANT score, salva no Supabase
7. **LOOP** — Se leads_found < quantidade, volta ao STEP 1
8. **END** — Retorna resumo

State persiste em `agent_runs.log`. Progresso via Server-Sent Events.

Rate limits: 5-10 req/min LinkedIn, 30 req/min SerpAPI.

## Páginas

### /login
- Supabase Auth (email + senha)

### /dashboard
- **Pipeline Kanban** — 5 colunas, cards com nome/empresa/cargo/score, drag & drop
- **Tabela de Contatos** — filtros por segmento, estágio, score, região
- **Sidebar** — navegação + seção "Execuções" com runs ativas/recentes

### /prospect
- Formulário: segmento, região, quantidade
- Feed de progresso em tempo real (SSE)
- Lista de leads criados ao final

### /runs (ou sidebar)
- Lista de agent_runs com status em tempo real
- Clique → log de steps expandido
- Badge quando há run ativa

### /settings
- CRUD de segmentos
- Credenciais LinkedIn (encriptadas)
- Config de rate limiting

## Segurança

### Autenticação & Autorização
- Supabase Auth com JWT + refresh
- RLS em todas as tabelas vinculado a auth.uid()
- Middleware Next.js validando sessão em todas as rotas

### Credenciais LinkedIn
- Encriptadas com AES-256 antes de salvar no Supabase
- Chave de encriptação em variável de ambiente server-only
- Nunca expostas ao frontend

### API Keys
- Todas em variáveis de ambiente server-side
- Nunca importadas em componentes client
- Rate limiting por IP nas API routes

### Input Validation
- Zod schemas em todas as API routes e Server Actions
- Sanitização de inputs
- CSP headers configurados

### Infraestrutura
- .env no .gitignore desde o dia 0
- Headers de segurança (HSTS, X-Frame-Options, X-Content-Type-Options)
- npm audit no CI

### LinkedIn Auth
- Usuário insere email + senha em /settings
- Backend encripta e salva no Supabase
- MCP server faz login via Patchright e persiste cookies
- Reutiliza sessão, refaz login só se expirar
- Notifica usuário se LinkedIn pedir CHALLENGE
- Recomendação: conta LinkedIn dedicada, nunca pessoal
