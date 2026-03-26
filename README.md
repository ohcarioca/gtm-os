# GTM OS

Plataforma de prospeccao B2B com agentes de IA. Encontra empresas, identifica decisores, valida perfis no LinkedIn e cria leads qualificados com scoring automatico.

## Stack

- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Agente:** LangGraph.js + Claude Code CLI (subprocess)
- **Busca:** Serper (Google Search API)
- **LinkedIn:** Playwright (browser persistente, scraping direto)
- **Enrichment:** Firecrawl self-hosted (scraping de sites de empresas)
- **Database:** Supabase (Postgres + Auth + RLS)
- **Validacao:** Zod

## Pre-requisitos

| Ferramenta | Versao | Onde obter |
|------------|--------|------------|
| Node.js | v18+ | [nodejs.org](https://nodejs.org/) |
| Docker Desktop | Qualquer | [docker.com](https://www.docker.com/) |
| Claude Code CLI | Ultima | [docs.anthropic.com](https://docs.anthropic.com/en/docs/claude-code) |
| Git | Qualquer | [git-scm.com](https://git-scm.com/) |

Contas necessarias:

| Servico | Para que | Onde criar |
|---------|----------|------------|
| Supabase | Banco de dados + autenticacao | [supabase.com](https://supabase.com/) |
| Serper.dev | Google Search API (2500 buscas gratis) | [serper.dev](https://serper.dev/) |
| LinkedIn | Conta para scraping de perfis | [linkedin.com](https://www.linkedin.com/) |

## Instalacao passo a passo

### 1. Clonar o repositorio

```bash
git clone https://github.com/ohcarioca/gtm-os.git
cd gtm-os
```

### 2. Instalar dependencias do Node.js

```bash
npm install
```

### 3. Instalar Playwright (Chromium)

O Playwright e usado para scraping do LinkedIn. Instale o navegador Chromium:

```bash
npx playwright install chromium
```

### 4. Configurar variaveis de ambiente

Crie o arquivo `.env.local` na raiz do projeto:

```env
# =============================================
# SUPABASE
# Dashboard > Settings > API
# =============================================
NEXT_PUBLIC_SUPABASE_URL=https://SEU_PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua_anon_key_aqui
SUPABASE_SERVICE_ROLE_KEY=sua_service_role_key_aqui

# =============================================
# ENCRYPTION
# Usado para criptografar credenciais do LinkedIn (AES-256-GCM)
# Gere com: openssl rand -hex 32
# No Windows (PowerShell): [System.BitConverter]::ToString((1..32 | ForEach-Object { Get-Random -Max 256 })).Replace('-','').ToLower()
# =============================================
LINKEDIN_ENCRYPTION_KEY=sua_chave_hex_64_caracteres

# =============================================
# APP
# =============================================
NEXT_PUBLIC_APP_URL=http://localhost:3000

# =============================================
# FIRECRAWL (opcional — para enrichment de empresas)
# =============================================
FIRECRAWL_URL=http://localhost:3002
```

> **Nota:** A chave da API do Serper e configurada pela interface em **Settings > Integrations**, nao em variaveis de ambiente.

### 5. Configurar Supabase

#### Opcao A: Supabase Cloud (recomendado)

1. Crie um projeto em [supabase.com](https://supabase.com/)
2. Va em **Settings > API** e copie as 3 chaves para o `.env.local`:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` → `SUPABASE_SERVICE_ROLE_KEY`
3. Va no **SQL Editor** e execute o arquivo de schema:

```
supabase/migrations/001_initial_schema.sql
```

Esse arquivo unico cria todas as tabelas, triggers, RLS policies e indexes necessarios.

#### Opcao B: Supabase local (Docker)

```bash
npx supabase start
# Use as credenciais exibidas no terminal para preencher o .env.local
```

#### Configurar autenticacao

1. No dashboard do Supabase, va em **Authentication > Providers**
2. Ative pelo menos **Email** (ou Google/GitHub)
3. Configure o redirect URL: `http://localhost:3000/auth/callback`

### 6. Instalar e configurar Claude Code CLI

O agente usa o Claude Code CLI como subprocess para chamadas LLM (custo zero com plano Max/Pro).

```bash
# Instalar globalmente
npm install -g @anthropic-ai/claude-code

# Autenticar (abre o browser para login)
claude auth login
```

Verifique que funciona:

```bash
claude --print "Hello world"
```

Se o comando retornar uma resposta, esta funcionando.

### 7. Configurar Firecrawl (opcional)

Firecrawl e usado para enriquecer dados de empresas (scraping de sites corporativos para extrair descricao, setor, tecnologias, etc). Se nao precisar de enrichment, pule este passo.

```bash
docker compose -f docker-compose.firecrawl.yml up -d
```

Isso sobe 3 containers:
- **Redis** — cache e fila de jobs
- **Playwright service** — renderizacao de paginas
- **Firecrawl API** — endpoint na porta `3002`

Verifique que funciona:

```bash
curl http://localhost:3002
```

> **Requisitos de hardware:** Firecrawl consome bastante memoria. O docker-compose limita a API a 8GB RAM e 4 CPUs. Maquinas com menos de 16GB RAM podem ter problemas.

### 8. Configurar LinkedIn (primeira vez)

O scraping do LinkedIn usa um browser persistente Chromium. Na primeira vez, faca login manualmente:

**Linux/macOS:**
```bash
npx playwright open --user-data-dir="$HOME/.gtm-agent/linkedin-browser" https://www.linkedin.com/login
```

**Windows (PowerShell):**
```powershell
npx playwright open --user-data-dir="$env:USERPROFILE\.gtm-agent\linkedin-browser" https://www.linkedin.com/login
```

1. Faca login no LinkedIn no browser que abrir
2. Feche o browser — a sessao fica salva em `~/.gtm-agent/linkedin-browser/`
3. Se a sessao expirar durante prospeccao, a app mostra um modal para re-login

**Limites diarios:** 50 scrapes e 30 buscas (persistidos no banco de dados).

### 9. Executar a aplicacao

```bash
npm run dev
```

Acesse [http://localhost:3000](http://localhost:3000) no navegador.

### 10. Configurar API Key do Serper (na interface)

1. Faca login na aplicacao
2. Va em **Settings > Integrations**
3. Adicione sua chave da API do Serper.dev

## Comandos

| Comando | Descricao |
|---------|-----------|
| `npm run dev` | Servidor de desenvolvimento (porta 3000) |
| `npm run build` | Build de producao |
| `npm run start` | Servidor de producao (requer build) |
| `npm run lint` | Linting com ESLint |

## Estrutura do projeto

```
src/
├── app/                       # Next.js App Router
│   ├── (app)/                 # Rotas protegidas (requer login)
│   │   ├── dashboard/         # Dashboard principal
│   │   ├── companies/         # Descoberta e gestao de empresas
│   │   ├── contacts/          # Gestao de contatos
│   │   ├── pipeline/          # Pipeline Kanban (drag & drop)
│   │   ├── prospect/          # Formulario de prospeccao
│   │   ├── runs/              # Historico de execucoes do agente
│   │   └── settings/          # Configuracoes
│   │       └── integrations/  # LinkedIn login + API keys
│   ├── api/
│   │   ├── prospect/          # SSE streaming do agente de leads
│   │   ├── companies/
│   │   │   ├── discover/      # SSE streaming de descoberta de empresas
│   │   │   └── autofill/      # Autofill de dados de empresa
│   │   ├── chat/parse/        # Parsing de texto com IA
│   │   ├── enrich/            # Enrichment de empresas via Firecrawl
│   │   ├── leads/from-linkedin/ # Criar leads a partir de URLs do LinkedIn
│   │   └── linkedin/
│   │       ├── login/         # Abrir browser para login manual
│   │       └── status/        # Verificar status da sessao LinkedIn
│   ├── login/                 # Pagina publica de autenticacao
│   └── auth/callback/         # Callback OAuth do Supabase
├── components/                # Componentes React (shadcn/ui)
│   └── ui/                    # Primitivos shadcn/ui
├── hooks/                     # React hooks customizados
├── lib/
│   ├── agent/                 # Pipeline LangGraph (prospeccao de leads)
│   │   ├── nodes/             # Steps: find-lead, validate, score, create
│   │   └── company-discovery/ # Pipeline de descoberta de empresas
│   ├── supabase/              # Clients Supabase (server + browser)
│   ├── types/                 # TypeScript types
│   ├── validations/           # Schemas Zod
│   ├── security/              # Rate limiting
│   ├── claude-cli.ts          # Wrapper Claude Code CLI (subprocess)
│   ├── linkedin-playwright.ts # Scraping LinkedIn via Playwright
│   ├── firecrawl-enrich.ts    # Enrichment via Firecrawl
│   ├── google-search.ts       # Wrapper Serper API
│   ├── encryption.ts          # AES-256-GCM para credenciais
│   └── env.ts                 # Validacao de env vars
└── middleware.ts               # Auth middleware
```

## Pipelines do agente

### Prospeccao de leads

Dois modos disponiveis no formulario:

- **Companies:** Busca direcionada em empresas previamente aprovadas
- **ICP:** Busca ampla baseada em tipos de empresa e regiao

Fluxo: `find_lead` → `validate_profile` → `score_and_enrich` → `create_lead` → loop

### Descoberta de empresas

Fluxo: `build_queries` → `search_companies` → `triage_snippets` → `scrape_company` → `analyze_company` → `save_company` → loop

## Troubleshooting

### LinkedIn sessao expirou

Re-faca o login manualmente:

```bash
npx playwright open --user-data-dir="$HOME/.gtm-agent/linkedin-browser" https://www.linkedin.com/login
```

Ou use o botao de re-login na pagina **Settings > Integrations**.

### Firecrawl nao conecta

```bash
# Verificar se os containers estao rodando
docker compose -f docker-compose.firecrawl.yml ps

# Reiniciar se necessario
docker compose -f docker-compose.firecrawl.yml down
docker compose -f docker-compose.firecrawl.yml up -d

# Testar
curl http://localhost:3002
```

### Claude CLI nao funciona

```bash
# Re-autenticar
claude auth login

# Testar
claude --print "test"
```

### Erro de migracao no Supabase

Execute o arquivo `supabase/migrations/001_initial_schema.sql` no SQL Editor. Ele contem o schema completo em um unico arquivo.

### Porta 3000 ja em uso

```bash
# Encontrar o processo
# Linux/macOS:
lsof -i :3000
# Windows:
netstat -ano | findstr :3000

# Ou rodar em outra porta
PORT=3001 npm run dev
```

### Firecrawl consome muita memoria

O Firecrawl precisa de bastante RAM. Se sua maquina tem menos de 16GB, edite os limites no `docker-compose.firecrawl.yml`:

```yaml
deploy:
  resources:
    limits:
      memory: 4G  # Reduza conforme necessario
```
