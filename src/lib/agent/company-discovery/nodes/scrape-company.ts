import { CompanyDiscoveryStateType } from "../state";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL ?? "http://localhost:3002";

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function scrapeCompany(
  state: CompanyDiscoveryStateType
): Promise<Partial<CompanyDiscoveryStateType>> {
  const log = { step: "scrape_company", message: "", timestamp: new Date().toISOString() };

  const next = state.triageApprovedUrls[0];
  if (!next) {
    return {
      currentUrl: null,
      currentMarkdown: null,
      log: [{ ...log, message: "Nenhuma URL pendente para scraping" }],
    };
  }
  const url = next.url;

  try {
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
      signal: AbortSignal.timeout(30_000),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: 30000,
      }),
    });

    if (!response.ok) {
      console.error(`[scrape-company] Firecrawl error: ${response.status} for ${url}`);
      const domain = extractDomain(url);
      return {
        currentUrl: null,
        currentMarkdown: null,
        triageApprovedUrls: state.triageApprovedUrls.slice(1),
        companiesProcessed: [domain],
        log: [{ ...log, message: `Falha ao scraping de ${domain} (HTTP ${response.status})` }],
      };
    }

    const data = await response.json();
    const markdown: string | null = data?.data?.markdown ?? null;

    if (!markdown || markdown.trim().length < 100) {
      const domain = extractDomain(url);
      return {
        currentUrl: null,
        currentMarkdown: null,
        triageApprovedUrls: state.triageApprovedUrls.slice(1),
        companiesProcessed: [domain],
        log: [{ ...log, message: `Conteúdo insuficiente de ${domain}` }],
      };
    }

    return {
      currentUrl: url,
      currentMarkdown: markdown,
      triageApprovedUrls: state.triageApprovedUrls.slice(1),
      companiesProcessed: [extractDomain(url)],
      log: [{ ...log, message: `Scraping concluído: ${extractDomain(url)} (${markdown.length} chars)` }],
    };
  } catch (err) {
    console.error("[scrape-company] Error:", err);
    const domain = extractDomain(url);
    return {
      currentUrl: null,
      currentMarkdown: null,
      triageApprovedUrls: state.triageApprovedUrls.slice(1),
      companiesProcessed: [domain],
      errorRetries: state.errorRetries + 1,
      log: [{ ...log, message: `Erro no scraping de ${domain}: ${err instanceof Error ? err.message : "unknown"}` }],
    };
  }
}
