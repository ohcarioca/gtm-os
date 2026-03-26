import { END, START, StateGraph } from "@langchain/langgraph";
import { AgentState, AgentStateType } from "./state";
import { findLead } from "./nodes/find-lead";
import { validateProfile } from "./nodes/validate-profile";
import { scoreAndEnrich } from "./nodes/score-and-enrich";
import { createLead } from "./nodes/create-lead";
import { createClient } from "@supabase/supabase-js";

const MAX_SEARCH_RETRIES = 8;
const MAX_ERROR_RETRIES = 3;

function saveRejectedLead(state: AgentStateType, reason: string): void {
  const dm = state.currentDecisionMaker;
  if (!dm?.linkedinUrl) return;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  supabase.from("rejected_leads").upsert(
    {
      user_id: state.userId,
      linkedin_url: dm.linkedinUrl,
      name: dm.name,
      company: dm.company,
      reason,
      score: state.currentScore?.total ?? null,
    },
    { onConflict: "user_id,linkedin_url" }
  ).then(() => {}, () => {});
}

function shouldRetryOrStop(state: AgentStateType): "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (state.searchRetries >= MAX_SEARCH_RETRIES) return END;
  return "find_lead";
}

function hasCandidate(state: AgentStateType): "validate_profile" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  if (!state.currentDecisionMaker) return shouldRetryOrStop(state);
  return "validate_profile";
}

function isValid(state: AgentStateType): "score_and_enrich" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const v = state.currentValidation;
  // Match validate-profile logic: name + (active OR experience matches ICP) + company matches
  if (v && v.photo && (v.activity || v.experience_match) && v.company_match !== false) return "score_and_enrich";
  saveRejectedLead(state, v?.company_match === false ? "company_mismatch" : "validation_failed");
  return shouldRetryOrStop(state);
}

function meetsThreshold(state: AgentStateType): "create_lead" | "find_lead" | "__end__" {
  if (state.errorRetries >= MAX_ERROR_RETRIES) return END;
  const score = state.currentScore?.total ?? 0;
  if (score >= state.minScoreThreshold) return "create_lead";
  saveRejectedLead(state, "low_score");
  return shouldRetryOrStop(state);
}

function shouldContinue(state: AgentStateType): "find_lead" | "__end__" {
  if (state.leadsCreated >= state.quantity) return END;
  return "find_lead";
}

export function buildProspectingGraph() {
  const graph = new StateGraph(AgentState)
    .addNode("find_lead", findLead)
    .addNode("validate_profile", validateProfile)
    .addNode("score_and_enrich", scoreAndEnrich)
    .addNode("create_lead", createLead)
    .addEdge(START, "find_lead")
    .addConditionalEdges("find_lead", hasCandidate)
    .addConditionalEdges("validate_profile", isValid)
    .addConditionalEdges("score_and_enrich", meetsThreshold)
    .addConditionalEdges("create_lead", shouldContinue);

  return graph.compile();
}
