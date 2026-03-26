import { z } from "zod";
import { CompanyDiscoveryStateType } from "../state";
import { callClaudeJSON } from "@/lib/claude-cli";

const triageSchema = z.object({
  approved: z.array(z.number()),
});

export async function triageSnippets(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "triage_snippets", message: "", timestamp: new Date().toISOString() };

  if (state.pendingUrls.length === 0) {
    return {
      triageApprovedUrls: [],
      log: [{ ...log, message: "Nenhuma URL para triar" }],
    };
  }

  try {
    const snippetList = state.pendingUrls
      .map((item, i) => `[${i}] ${item.title}\n    ${item.url}\n    ${item.snippet}`)
      .join("\n\n");

    const prompt = `You are filtering Google search results to find actual company websites.

For each result below, decide if the URL is likely a real company website (homepage or about page).

APPROVE: company homepages, company about pages, company product pages
REJECT: blog posts, news articles, directory listings, job boards, review sites, social media, Wikipedia, lists of companies, aggregator pages

Results:
${snippetList}

Return JSON with the indices of approved results: {"approved": [0, 2, 5]}
If none are companies, return: {"approved": []}`;

    const result = await callClaudeJSON(prompt, triageSchema, {
      timeout: 30_000,
      model: "haiku",
    });

    const approved = result.approved
      .filter((i) => i >= 0 && i < state.pendingUrls.length)
      .map((i) => state.pendingUrls[i]);

    const rejected = state.pendingUrls.length - approved.length;

    return {
      triageApprovedUrls: approved,
      log: [{
        ...log,
        message: `Triagem: ${approved.length} aprovadas, ${rejected} rejeitadas de ${state.pendingUrls.length} URLs`,
      }],
    };
  } catch (err) {
    // Fail open — pass all URLs through on error
    console.error("[triage-snippets] Error, failing open:", err);
    return {
      triageApprovedUrls: state.pendingUrls,
      log: [{
        ...log,
        message: `Erro na triagem, passando todas ${state.pendingUrls.length} URLs: ${err instanceof Error ? err.message : "unknown"}`,
      }],
    };
  }
}
