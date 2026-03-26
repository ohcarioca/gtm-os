import { END, START, StateGraph } from "@langchain/langgraph";
import { CompanyDiscoveryState, CompanyDiscoveryStateType } from "./state";
import { buildQueries } from "./nodes/build-queries";
import { searchCompanies } from "./nodes/search-companies";
import { scrapeCompany } from "./nodes/scrape-company";
import { analyzeCompany } from "./nodes/analyze-company";
import { saveCompany } from "./nodes/save-company";
import { triageSnippets } from "./nodes/triage-snippets";

const MAX_SEARCH_RETRIES = 5;
const MAX_ERROR_RETRIES = 3;

function afterSearch(
  state: CompanyDiscoveryStateType
): "triage_snippets" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.searchRetries >= MAX_SEARCH_RETRIES) return END;
  if (state.pendingUrls.length === 0) return END;
  return "triage_snippets";
}

function afterTriage(
  state: CompanyDiscoveryStateType
): "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.triageApprovedUrls.length === 0) return END;
  return "scrape_company";
}

function afterScrape(
  state: CompanyDiscoveryStateType
): "analyze_company" | "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.companiesSaved >= state.quantity) return END;

  // If scrape succeeded, analyze
  if (state.currentUrl && state.currentMarkdown) return "analyze_company";

  // Scrape failed — try next URL
  if (state.triageApprovedUrls.length > 0) return "scrape_company";

  return END;
}

function afterAnalyze(
  state: CompanyDiscoveryStateType
): "save_company" | "scrape_company" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.companiesSaved >= state.quantity) return END;

  // If analysis identified a company, save it
  if (state.currentUrl && state.currentMarkdown) return "save_company";

  // Not a company — try next URL
  if (state.triageApprovedUrls.length > 0) return "scrape_company";

  return END;
}

function afterSave(
  state: CompanyDiscoveryStateType
): "scrape_company" | "search_companies" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.companiesSaved >= state.quantity) return END;

  // More URLs to process
  if (state.triageApprovedUrls.length > 0) return "scrape_company";

  // No more URLs — try searching again
  if (state.searchRetries < MAX_SEARCH_RETRIES) return "search_companies";

  return END;
}

export function buildCompanyDiscoveryGraph() {
  const graph = new StateGraph(CompanyDiscoveryState)
    .addNode("build_queries", buildQueries)
    .addNode("search_companies", searchCompanies)
    .addNode("triage_snippets", triageSnippets)
    .addNode("scrape_company", scrapeCompany)
    .addNode("analyze_company", analyzeCompany)
    .addNode("save_company", saveCompany)
    .addEdge(START, "build_queries")
    .addEdge("build_queries", "search_companies")
    .addConditionalEdges("search_companies", afterSearch)
    .addConditionalEdges("triage_snippets", afterTriage)
    .addConditionalEdges("scrape_company", afterScrape)
    .addConditionalEdges("analyze_company", afterAnalyze)
    .addConditionalEdges("save_company", afterSave);

  return graph.compile();
}
