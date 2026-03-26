# Company Profile & Lead Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add company profile settings that improve prospecting queries + LinkedIn messages, and add lead enrichment via Serper (Google Search + Maps) both in the pipeline and manually.

**Architecture:** Two independent features sharing the Serper API. Feature 1 adds a `company_profiles` table + Settings UI + agent state injection. Feature 2 adds a Serper enrichment utility, a new `enrich_lead` pipeline node, a `/api/enrich` route, and UI buttons.

**Tech Stack:** Next.js 14, Supabase, LangGraph.js, Serper API, Claude API, Zod, shadcn/ui, Tailwind CSS

---

## Task 1: Database Migration — `company_profiles` table

**Files:**
- Create: `supabase/migrations/004_add_company_profiles.sql`

**Step 1: Write the migration**

```sql
-- Company profiles table (one per user)
CREATE TABLE company_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sector TEXT NOT NULL,
  value_proposition TEXT NOT NULL,
  icp TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER company_profiles_updated_at
  BEFORE UPDATE ON company_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own company_profiles"
  ON company_profiles FOR ALL USING (auth.uid() = user_id);
```

**Step 2: Apply migration**

Run: `npx supabase db push` or apply via Supabase dashboard.

**Step 3: Commit**

```bash
git add supabase/migrations/004_add_company_profiles.sql
git commit -m "feat: add company_profiles table migration"
```

---

## Task 2: Database Migration — `leads.metadata` column

**Files:**
- Create: `supabase/migrations/005_add_leads_metadata.sql`

**Step 1: Write the migration**

```sql
-- Add metadata JSONB to leads for enrichment data
ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}' NOT NULL;
```

**Step 2: Apply migration**

**Step 3: Commit**

```bash
git add supabase/migrations/005_add_leads_metadata.sql
git commit -m "feat: add metadata column to leads table"
```

---

## Task 3: TypeScript Types & Zod Schemas

**Files:**
- Modify: `src/lib/types/database.ts` — add `CompanyProfile` interface, add `metadata` to `Lead`
- Modify: `src/lib/validations/schemas.ts` — add `companyProfileSchema`, `enrichLeadSchema`

**Step 1: Add CompanyProfile type to `src/lib/types/database.ts`**

After the `LinkedInCredentials` interface (line 85), add:

```typescript
export interface CompanyProfile {
  id: string;
  user_id: string;
  name: string;
  sector: string;
  value_proposition: string;
  icp: string;
  created_at: string;
  updated_at: string;
}
```

Also add `metadata` field to the `Lead` interface (after `notes: string | null;` at line 47):

```typescript
  metadata: Record<string, unknown>;
```

**Step 2: Add Zod schemas to `src/lib/validations/schemas.ts`**

After `updateSegmentSchema` (line 62), add:

```typescript
export const companyProfileSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(100),
  sector: z.string().min(1, "Setor é obrigatório").max(200),
  value_proposition: z.string().min(1, "Proposta de valor é obrigatória").max(500),
  icp: z.string().min(1, "ICP é obrigatório").max(500),
});

export const enrichLeadSchema = z.object({
  lead_id: z.string().uuid(),
});

export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type EnrichLeadInput = z.infer<typeof enrichLeadSchema>;
```

**Step 3: Commit**

```bash
git add src/lib/types/database.ts src/lib/validations/schemas.ts
git commit -m "feat: add CompanyProfile type, Lead metadata, and validation schemas"
```

---

## Task 4: Company Profile Server Action

**Files:**
- Modify: `src/app/(app)/settings/actions.ts` — add `saveCompanyProfile` and `getCompanyProfile`

**Step 1: Add server actions**

After the existing `saveLinkedInCredentials` function, add:

```typescript
import { companyProfileSchema } from "@/lib/validations/schemas";

export async function saveCompanyProfile(formData: FormData) {
  const parsed = companyProfileSchema.safeParse({
    name: formData.get("company_name"),
    sector: formData.get("sector"),
    value_proposition: formData.get("value_proposition"),
    icp: formData.get("icp"),
  });
  if (!parsed.success) throw new Error("Invalid input");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { error } = await supabase.from("company_profiles").upsert({
    user_id: user.id,
    ...parsed.data,
  }, { onConflict: "user_id" });

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
```

**Step 2: Commit**

```bash
git add src/app/(app)/settings/actions.ts
git commit -m "feat: add saveCompanyProfile server action"
```

---

## Task 5: Company Profile UI in Settings

**Files:**
- Modify: `src/app/(app)/settings/page.tsx` — add "Minha Empresa" card above LinkedIn card

**Step 1: Update imports**

Add to imports at line 7:

```typescript
import { saveLinkedInCredentials, saveCompanyProfile } from "./actions";
import { Textarea } from "@/components/ui/textarea";
import type { LinkedInCredentials, CompanyProfile } from "@/lib/types/database";
```

**Step 2: Fetch company profile**

After the LinkedIn credentials fetch (line 23), add:

```typescript
  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("*")
    .eq("user_id", user.id)
    .single();

  const typedProfile = companyProfile as CompanyProfile | null;
```

**Step 3: Add "Minha Empresa" card in JSX**

Before the LinkedIn card (line 42), add:

```tsx
      {/* Company Profile */}
      <Card>
        <CardHeader>
          <CardTitle>Minha Empresa</CardTitle>
          <CardDescription>
            Informações usadas para melhorar buscas e personalizar mensagens
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {typedProfile && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              Perfil salvo — {typedProfile.name}
            </div>
          )}

          <form action={saveCompanyProfile} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_name">Nome da Empresa</Label>
              <Input
                id="company_name"
                name="company_name"
                placeholder="Ex: Debtify"
                defaultValue={typedProfile?.name ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sector">Setor</Label>
              <Input
                id="sector"
                name="sector"
                placeholder="Ex: Cobrança digital"
                defaultValue={typedProfile?.sector ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="value_proposition">Proposta de Valor</Label>
              <Textarea
                id="value_proposition"
                name="value_proposition"
                placeholder="Ex: Plataforma de recuperação de crédito com IA"
                defaultValue={typedProfile?.value_proposition ?? ""}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="icp">Perfil do Cliente Ideal (ICP)</Label>
              <Textarea
                id="icp"
                name="icp"
                placeholder="Ex: Empresas de telecom com +500 clientes inadimplentes"
                defaultValue={typedProfile?.icp ?? ""}
                required
              />
            </div>
            <Button type="submit">
              {typedProfile ? "Atualizar Perfil" : "Salvar Perfil"}
            </Button>
          </form>
        </CardContent>
      </Card>
```

**Step 4: Commit**

```bash
git add src/app/(app)/settings/page.tsx
git commit -m "feat: add company profile form to settings page"
```

---

## Task 6: Inject Company Profile into Agent State

**Files:**
- Modify: `src/lib/agent/state.ts` — add `companyProfile` field
- Modify: `src/app/api/prospect/route.ts` — fetch and pass company profile to graph

**Step 1: Add companyProfile to AgentState**

In `src/lib/agent/state.ts`, after `searchTerms` (line 8), add:

```typescript
  companyProfile: Annotation<{
    name: string;
    sector: string;
    value_proposition: string;
    icp: string;
  } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
```

**Step 2: Fetch and pass company profile in `/api/prospect/route.ts`**

After fetching segment (line 29), add:

```typescript
  // Fetch company profile for context
  const { data: companyProfile } = await supabase
    .from("company_profiles")
    .select("name, sector, value_proposition, icp")
    .eq("user_id", user.id)
    .single();
```

Then add `companyProfile` to the graph.stream input (line 57):

```typescript
            companyProfile: companyProfile ?? null,
```

**Step 3: Commit**

```bash
git add src/lib/agent/state.ts src/app/api/prospect/route.ts
git commit -m "feat: inject company profile into agent pipeline state"
```

---

## Task 7: Use Company Profile in Search Node

**Files:**
- Modify: `src/lib/agent/nodes/search-company.ts` — use sector/ICP to refine queries

**Step 1: Update search query**

Replace line 7:
```typescript
  const query = `${state.searchTerms.join(" ")} ${state.region} empresas`;
```

With:
```typescript
  const profileTerms = state.companyProfile
    ? `${state.companyProfile.sector} ${state.companyProfile.icp}`
    : "";
  const query = `${state.searchTerms.join(" ")} ${profileTerms} ${state.region} empresas`.trim();
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/search-company.ts
git commit -m "feat: use company profile to refine search queries"
```

---

## Task 8: Use Company Profile in LinkedIn Message Generation

**Files:**
- Modify: `src/lib/agent/nodes/create-lead.ts` — personalize messages with company info

**Step 1: Update Claude prompt**

Replace the system prompt (lines 28-30):
```typescript
      content: `You are a B2B sales outreach specialist. Write a personalized LinkedIn connection message in Portuguese (BR).
Max 300 characters. Structure: greeting with name, who you are (Leonardo from Debtify), personalized hook about their company, what you do (1 sentence), soft CTA.
Do NOT use sales language. Be professional and genuine. Return ONLY the message text, nothing else.`,
```

With:
```typescript
      content: `You are a B2B sales outreach specialist. Write a personalized LinkedIn connection message in Portuguese (BR).
Max 300 characters. Be professional and genuine. Return ONLY the message text, nothing else.
${state.companyProfile ? `You represent: ${state.companyProfile.name} — ${state.companyProfile.value_proposition}. Your ideal customer: ${state.companyProfile.icp}. Structure: greeting with name, who you are (from ${state.companyProfile.name}), personalized hook about their company relating to your value proposition, soft CTA.` : "Structure: greeting with name, personalized hook about their company, what you offer (1 sentence), soft CTA."}
Do NOT use sales language.`,
```

Also update the user prompt (lines 34-38) to include company profile context:
```typescript
      content: `Write a LinkedIn connection message for:
Name: ${dm.name}
Company: ${company.name}
Role: ${dm.snippet || "Decision maker"}
Industry context: ${state.searchTerms.join(", ")}
${state.companyProfile ? `My company: ${state.companyProfile.name} (${state.companyProfile.sector})` : ""}`,
```

**Step 2: Commit**

```bash
git add src/lib/agent/nodes/create-lead.ts
git commit -m "feat: personalize LinkedIn messages with company profile"
```

---

## Task 9: Serper Enrichment Utility

**Files:**
- Create: `src/lib/serper-enrich.ts` — shared enrichment logic (Search + Maps + contact search)

**Step 1: Create the enrichment utility**

```typescript
import { ChatAnthropic } from "@langchain/anthropic";
import { getApiKey } from "@/lib/claude-auth";

interface EnrichmentResult {
  company: {
    phone: string | null;
    email: string | null;
    address: string | null;
    rating: number | null;
    reviews_count: number | null;
    category: string | null;
    business_hours: string | null;
    description: string | null;
  };
  contact: {
    email: string | null;
    phone: string | null;
  };
}

async function serperSearch(query: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("SERPER_API_KEY must be set");

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: "br", hl: "pt", num: 5 }),
  });
  if (!response.ok) throw new Error(`Serper error: ${response.statusText}`);
  return response.json();
}

async function serperMaps(query: string): Promise<Record<string, unknown>> {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) throw new Error("SERPER_API_KEY must be set");

  const response = await fetch("https://google.serper.dev/places", {
    method: "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, gl: "br", hl: "pt" }),
  });
  if (!response.ok) throw new Error(`Serper Maps error: ${response.statusText}`);
  return response.json();
}

export async function enrichLead(
  companyName: string,
  companyCity: string | null,
  contactName: string,
): Promise<EnrichmentResult> {
  // 1. Google Search for company info
  const searchData = await serperSearch(`"${companyName}" telefone email contato site`);

  // 2. Google Maps for company details
  const mapsQuery = companyCity
    ? `${companyName} ${companyCity}`
    : companyName;
  const mapsData = await serperMaps(mapsQuery);

  // 3. Google Search for contact info
  const contactData = await serperSearch(`"${contactName}" "${companyName}" email telefone linkedin`);

  // Use Claude to extract structured data from raw results
  const llm = new ChatAnthropic({
    model: "claude-sonnet-4-20250514",
    temperature: 0,
    anthropicApiKey: getApiKey(),
  });

  const extractionResponse = await llm.invoke([
    {
      role: "system",
      content: `Extract structured data from search results. Return ONLY valid JSON, no markdown. If a field is not found, use null.
Return format:
{
  "company": { "phone": string|null, "email": string|null, "address": string|null, "rating": number|null, "reviews_count": number|null, "category": string|null, "business_hours": string|null, "description": string|null },
  "contact": { "email": string|null, "phone": string|null }
}`,
    },
    {
      role: "user",
      content: `Company: ${companyName}
Contact: ${contactName}

Google Search results for company:
${JSON.stringify(searchData.organic ?? [], null, 2).slice(0, 2000)}

Knowledge Graph:
${JSON.stringify(searchData.knowledgeGraph ?? {}, null, 2).slice(0, 1000)}

Google Maps results:
${JSON.stringify(mapsData.places ?? [], null, 2).slice(0, 2000)}

Google Search results for contact:
${JSON.stringify(contactData.organic ?? [], null, 2).slice(0, 1000)}`,
    },
  ]);

  const content = typeof extractionResponse.content === "string"
    ? extractionResponse.content
    : "";

  try {
    return JSON.parse(content) as EnrichmentResult;
  } catch {
    return {
      company: { phone: null, email: null, address: null, rating: null, reviews_count: null, category: null, business_hours: null, description: null },
      contact: { email: null, phone: null },
    };
  }
}
```

**Step 2: Commit**

```bash
git add src/lib/serper-enrich.ts
git commit -m "feat: add Serper enrichment utility (Search + Maps)"
```

---

## Task 10: Pipeline Node — `enrich_lead`

**Files:**
- Create: `src/lib/agent/nodes/enrich-lead.ts`
- Modify: `src/lib/agent/graph.ts` — insert node between validate_profile and create_lead

**Step 1: Create the enrich-lead node**

```typescript
import { enrichLead } from "@/lib/serper-enrich";
import type { AgentStateType } from "../state";

export async function enrichLeadNode(
  state: AgentStateType
): Promise<Partial<AgentStateType>> {
  const company = state.currentCompany;
  const dm = state.currentDecisionMaker;

  if (!company || !dm) {
    return {
      log: [{
        step: "enrich_lead",
        message: "Skipped: no company or decision maker",
        timestamp: new Date().toISOString(),
      }],
    };
  }

  try {
    const enrichment = await enrichLead(
      company.name as string,
      (company.city as string) || null,
      dm.name as string,
    );

    return {
      currentCompany: {
        ...company,
        enrichment: enrichment.company,
      },
      currentDecisionMaker: {
        ...dm,
        enrichment: enrichment.contact,
      },
      log: [{
        step: "enrich_lead",
        message: `Enriched: ${company.name} — phone: ${enrichment.company.phone ?? "N/A"}, rating: ${enrichment.company.rating ?? "N/A"}`,
        timestamp: new Date().toISOString(),
      }],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Enrichment failed";
    return {
      log: [{
        step: "enrich_lead",
        message: `Enrichment error (skipped): ${msg}`,
        timestamp: new Date().toISOString(),
      }],
    };
  }
}
```

**Step 2: Update `src/lib/agent/graph.ts`**

Add import:
```typescript
import { enrichLeadNode } from "./nodes/enrich-lead";
```

Add node and update edges. Replace the graph building (lines 26-37) with:
```typescript
export function buildProspectingGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("search_company", searchCompany)
    .addNode("find_decision_maker", findDecisionMaker)
    .addNode("validate_profile", validateProfile)
    .addNode("enrich_lead", enrichLeadNode)
    .addNode("create_lead", createLead)
    .addEdge(START, "search_company")
    .addEdge("search_company", "find_decision_maker")
    .addEdge("find_decision_maker", "validate_profile")
    .addConditionalEdges("validate_profile", isValid, {
      create_lead: "enrich_lead",
      search_company: "search_company",
    })
    .addEdge("enrich_lead", "create_lead")
    .addConditionalEdges("create_lead", shouldContinue);

  return graph.compile();
}
```

Note: The conditional edge from validate_profile now routes to `enrich_lead` instead of `create_lead` when valid.

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/enrich-lead.ts src/lib/agent/graph.ts
git commit -m "feat: add enrich_lead node to prospecting pipeline"
```

---

## Task 11: Save Enrichment Data in create-lead Node

**Files:**
- Modify: `src/lib/agent/nodes/create-lead.ts` — save enrichment data to company metadata and lead fields

**Step 1: Update company insert**

Replace the company insert (lines 63-73) with:
```typescript
  // Extract enrichment data if available
  const companyEnrichment = (company.enrichment as Record<string, unknown>) ?? {};
  const dmEnrichment = (dm.enrichment as Record<string, unknown>) ?? {};

  // Save company
  const { data: savedCompany } = await supabase
    .from("companies")
    .insert({
      user_id: state.userId,
      segment_id: state.segmentId,
      name: company.name as string,
      website: (company.website as string) || null,
      metadata: {
        snippet: company.snippet,
        ...companyEnrichment,
        enriched_at: Object.keys(companyEnrichment).length > 0
          ? new Date().toISOString()
          : null,
      },
    })
    .select("id")
    .single();
```

**Step 2: Update lead insert**

Replace the lead insert (lines 77-88) with:
```typescript
  if (savedCompany) {
    await supabase.from("leads").insert({
      user_id: state.userId,
      company_id: savedCompany.id,
      name: dm.name as string,
      linkedin_url: (dm.linkedinUrl as string) || null,
      email: (dmEnrichment.email as string) || null,
      phone: (dmEnrichment.phone as string) || null,
      stage: "identified",
      score,
      bant,
      message,
      validation,
      metadata: {
        enriched_at: Object.keys(dmEnrichment).length > 0
          ? new Date().toISOString()
          : null,
      },
    });
  }
```

**Step 3: Commit**

```bash
git add src/lib/agent/nodes/create-lead.ts
git commit -m "feat: save enrichment data in lead and company records"
```

---

## Task 12: Manual Enrichment API Route

**Files:**
- Create: `src/app/api/enrich/route.ts`

**Step 1: Create the API route**

```typescript
import { createClient } from "@/lib/supabase/server";
import { enrichLeadSchema } from "@/lib/validations/schemas";
import { enrichLead } from "@/lib/serper-enrich";
import { createClient as createServiceClient } from "@supabase/supabase-js";

const serviceSupabase = createServiceClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const body = await request.json();
  const parsed = enrichLeadSchema.safeParse(body);
  if (!parsed.success) return new Response("Invalid input", { status: 400 });

  // Fetch lead with company
  const { data: lead } = await supabase
    .from("leads")
    .select("*, company:companies(*)")
    .eq("id", parsed.data.lead_id)
    .single();

  if (!lead) return new Response("Lead not found", { status: 404 });

  try {
    const result = await enrichLead(
      lead.company.name,
      lead.company.city,
      lead.name,
    );

    // Update company metadata
    const existingMetadata = lead.company.metadata ?? {};
    await serviceSupabase
      .from("companies")
      .update({
        metadata: {
          ...existingMetadata,
          ...result.company,
          enriched_at: new Date().toISOString(),
        },
      })
      .eq("id", lead.company.id);

    // Update lead contact info
    const leadUpdate: Record<string, unknown> = {
      metadata: {
        ...(lead.metadata ?? {}),
        enriched_at: new Date().toISOString(),
      },
    };
    if (result.contact.email && !lead.email) leadUpdate.email = result.contact.email;
    if (result.contact.phone && !lead.phone) leadUpdate.phone = result.contact.phone;

    await serviceSupabase
      .from("leads")
      .update(leadUpdate)
      .eq("id", lead.id);

    return Response.json({ success: true, data: result });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Enrichment failed";
    return Response.json({ success: false, error: msg }, { status: 500 });
  }
}
```

**Step 2: Commit**

```bash
git add src/app/api/enrich/route.ts
git commit -m "feat: add manual enrichment API route"
```

---

## Task 13: Enrich Button in Contacts Table

**Files:**
- Modify: `src/components/contacts-table.tsx` — add "Enriquecer" button per lead row

**Step 1: Add enrichment state and handler**

After `deleteLoading` state (line 39), add:

```typescript
  const [enrichingId, setEnrichingId] = useState<string | null>(null);

  async function handleEnrich(e: React.MouseEvent, leadId: string) {
    e.stopPropagation();
    setEnrichingId(leadId);
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_id: leadId }),
      });
      if (!res.ok) throw new Error("Enrichment failed");
      window.location.reload();
    } catch {
      // error handled silently
    } finally {
      setEnrichingId(null);
    }
  }
```

**Step 2: Add import**

Add `Sparkles` to lucide imports (line 11):

```typescript
import { Plus, Pencil, Trash2, Sparkles, Loader2 } from "lucide-react";
```

**Step 3: Add button in actions column**

In the actions `<div>` (line 119), before the Pencil button, add:

```tsx
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => handleEnrich(e, lead.id)}
                      disabled={enrichingId === lead.id}
                      title="Enriquecer lead"
                    >
                      {enrichingId === lead.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Sparkles className="h-4 w-4 text-amber-500" />}
                    </Button>
```

**Step 4: Add enrichment badge**

In the "Data" TableCell (line 115), show an enrichment indicator:

```tsx
                <TableCell className="text-gray-500">
                  <div className="flex items-center gap-1">
                    {new Date(lead.created_at).toLocaleDateString("pt-BR")}
                    {(lead.metadata as Record<string, unknown>)?.enriched_at && (
                      <Sparkles className="h-3 w-3 text-amber-500" />
                    )}
                  </div>
                </TableCell>
```

**Step 5: Commit**

```bash
git add src/components/contacts-table.tsx
git commit -m "feat: add enrich button to contacts table"
```

---

## Task 14: Enrich Button in Pipeline Kanban

**Files:**
- Modify: `src/components/lead-card.tsx` — add enrich button to card (or pass through from kanban)

First, check the LeadCard component. If it's simple, add the enrich action there. The button should:
- Show Sparkles icon
- Call `/api/enrich` with the lead ID
- Show loading state
- Reload on success

Follow the same pattern as Task 13 but adapted to the card layout.

**Step 1: Add enrich button to LeadCard**

Add the Sparkles icon + fetch logic to the card's actions area. Keep it minimal — just an icon button.

**Step 2: Commit**

```bash
git add src/components/lead-card.tsx
git commit -m "feat: add enrich button to pipeline lead cards"
```

---

## Task 15: Show Enrichment Data in Lead Detail Modal

**Files:**
- Modify: `src/components/lead-detail-modal.tsx` — display enriched fields

**Step 1: Add enrichment section**

In the lead detail modal, after existing fields, add a section that shows:
- Company: phone, email, address, rating, reviews, category, business hours, description
- Contact: email, phone (from lead fields)
- Only show fields that have values (not null)
- Show "Não enriquecido" message with enrich button if no enrichment data

Use the company's `metadata` and lead's `metadata` to check for `enriched_at`.

**Step 2: Commit**

```bash
git add src/components/lead-detail-modal.tsx
git commit -m "feat: display enrichment data in lead detail modal"
```

---

## Task 16: Build & Lint Check

**Step 1: Run lint**

```bash
npm run lint
```

Fix any issues.

**Step 2: Run build**

```bash
npm run build
```

Fix any type errors or build issues.

**Step 3: Commit fixes if needed**

```bash
git add -A
git commit -m "fix: resolve lint and build issues"
```

---

## Summary of Changes

| # | Task | Files |
|---|------|-------|
| 1 | Migration: company_profiles | `supabase/migrations/004_add_company_profiles.sql` |
| 2 | Migration: leads.metadata | `supabase/migrations/005_add_leads_metadata.sql` |
| 3 | Types & Schemas | `src/lib/types/database.ts`, `src/lib/validations/schemas.ts` |
| 4 | Company Profile Action | `src/app/(app)/settings/actions.ts` |
| 5 | Company Profile UI | `src/app/(app)/settings/page.tsx` |
| 6 | Agent State + Route | `src/lib/agent/state.ts`, `src/app/api/prospect/route.ts` |
| 7 | Search Node Update | `src/lib/agent/nodes/search-company.ts` |
| 8 | Message Generation Update | `src/lib/agent/nodes/create-lead.ts` |
| 9 | Serper Enrichment Utility | `src/lib/serper-enrich.ts` |
| 10 | Enrich Pipeline Node + Graph | `src/lib/agent/nodes/enrich-lead.ts`, `src/lib/agent/graph.ts` |
| 11 | Save Enrichment in create-lead | `src/lib/agent/nodes/create-lead.ts` |
| 12 | Manual Enrichment API | `src/app/api/enrich/route.ts` |
| 13 | Enrich Button (Contacts) | `src/components/contacts-table.tsx` |
| 14 | Enrich Button (Kanban) | `src/components/lead-card.tsx` |
| 15 | Enrichment in Detail Modal | `src/components/lead-detail-modal.tsx` |
| 16 | Build & Lint | All files |

### Parallelization Groups

These tasks can run in parallel via subagents:
- **Group A (Company Profile):** Tasks 1, 3 (types only), 4, 5
- **Group B (Pipeline):** Tasks 6, 7, 8
- **Group C (Enrichment):** Tasks 2, 9, 10, 11, 12
- **Group D (UI):** Tasks 13, 14, 15
- **Sequential:** Task 16 (after all others)

Dependencies: Group B depends on Task 3. Group C depends on Tasks 3 and 9. Group D depends on Task 12.
