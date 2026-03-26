import { Annotation } from "@langchain/langgraph";

export const CompanyDiscoveryState = Annotation.Root({
  userId: Annotation<string>(),
  sector: Annotation<string>(),
  region: Annotation<string>(),
  sizes: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  keywords: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  freeText: Annotation<string>({
    reducer: (_a, b) => b,
    default: () => "",
  }),
  quantity: Annotation<number>(),
  companyProfile: Annotation<{
    name: string;
    sector: string;
    value_proposition: string;
    icp: string;
  } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),

  // Working state
  searchQueries: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  pendingUrls: Annotation<{ url: string; title: string; snippet: string }[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  triageApprovedUrls: Annotation<{ url: string; title: string; snippet: string }[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  currentUrl: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  currentMarkdown: Annotation<string | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  companiesSaved: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  companiesProcessed: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  searchRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  errorRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  log: Annotation<
    Array<{ step: string; message: string; timestamp: string }>
  >({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type CompanyDiscoveryStateType = typeof CompanyDiscoveryState.State;
