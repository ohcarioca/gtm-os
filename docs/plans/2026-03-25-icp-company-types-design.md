# ICP Company Types para Prospecção Aberta

## Problema

Na prospecção aberta, o ICP (texto livre nas configurações) é injetado diretamente no prompt do Claude para gerar dork queries, mas o usuário não tem visibilidade nem controle sobre quais tipos de empresa o agente vai buscar.

## Solução

Ao salvar o ICP nas configurações, o Claude CLI (Haiku) extrai tipos/categorias de empresa do texto livre e salva como array no `company_profiles`. No formulário de prospecção aberta, esses tipos aparecem como chips selecionáveis. O usuário pode desmarcar tipos irrelevantes e adicionar novos (que são persistidos de volta).

## Decisões

- **Geração:** No momento do save do ICP nas configurações (Server Action + Claude CLI Haiku)
- **Armazenamento:** Campo `icp_company_types text[]` na tabela `company_profiles` existente
- **UI no formulário:** Chips/tags com checkbox — seleciona quais quer, pode adicionar novos
- **Persistência de tipos manuais:** Tipos adicionados no formulário são salvos de volta no `company_profiles`
- **Abordagem:** LLM no servidor via Server Action (padrão existente do projeto)

## Banco de Dados

- Migration 014: adiciona `icp_company_types text[] DEFAULT '{}'` na tabela `company_profiles`
- Array de strings simples: `["Fintechs", "Bancos digitais", "Empresas de cobrança"]`

## Fluxo: Configurações (geração dos tipos)

1. Usuário preenche/edita o campo ICP e clica "Salvar"
2. Server Action `saveCompanyProfile` chama Claude CLI (Haiku) com prompt:
   - "Dado este ICP: '{icp}', liste 5-10 tipos/categorias de empresa que se encaixam. Retorne JSON array de strings curtas em português."
3. Tipos gerados são salvos em `icp_company_types` junto com os demais campos
4. Se o ICP não mudou desde o último save, não regenera os tipos (evita custo desnecessário)

## Fluxo: Formulário de Prospecção Aberta

1. Ao montar o formulário, busca `company_profiles` do usuário (já feito hoje)
2. Se `icp_company_types` tem itens, renderiza seção "Tipos de Empresa" com chips
3. Todos os chips vêm selecionados por padrão
4. Usuário pode desmarcar chips que não quer nessa execução
5. Input para adicionar novos tipos → ao adicionar, faz update no `company_profiles.icp_company_types` (append)
6. Tipos selecionados são enviados no request como `company_types: string[]`

## Fluxo: Uso no Agente

1. `/api/prospect` recebe `company_types` do formulário
2. Passa para o graph state como novo campo `companyTypes: string[]`
3. Em `find-lead.ts`, quando monta o prompt de dork queries, inclui os tipos selecionados:
   - "Buscar profissionais em empresas dos seguintes tipos: {companyTypes.join(', ')}"
4. Substitui a injeção genérica do ICP por tipos específicos — queries mais focadas

## Componente: Chips de Tipos de Empresa

- Chips com checkbox visual (estilo shadcn Badge + check icon)
- Input de texto com "Enter" ou "," para adicionar novo tipo
- Sem tipo selecionado = prospecção aberta normal (sem filtro por tipo, comportamento atual)

## Tratamento de Erros

- Se Claude CLI falhar na geração: salva o perfil normalmente, `icp_company_types` fica vazio, log warning
- Se ICP está vazio: não tenta gerar tipos
- Se o formulário não tem tipos (perfil sem ICP): seção de tipos não aparece
