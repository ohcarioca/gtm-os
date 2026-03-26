import { Annotation } from "@langchain/langgraph";

export const AgentState = Annotation.Root({
  region: Annotation<string>(),
  quantity: Annotation<number>(),
  targetRoles: Annotation<string[]>(),
  companySizeTargets: Annotation<string[]>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  minScoreThreshold: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 70,
  }),
  companyProfile: Annotation<{
    name: string;
    sector: string;
    value_proposition: string;
    icp: string;
  } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  runId: Annotation<string>(),
  userId: Annotation<string>(),
  currentCompany: Annotation<{
    name: string;
    linkedinUrl: string | null;
    website: string | null;
    metadata?: Record<string, unknown>;
  } | null>(),
  currentDecisionMaker: Annotation<{
    name: string;
    role: string;
    linkedinUrl: string;
    company: string;
    connections?: number;
    about?: string;
    email?: string | null;
    phone?: string | null;
    lastActivityDate?: string | null;
  } | null>(),
  currentValidation: Annotation<Record<string, boolean> | null>(),
  currentScore: Annotation<{
    total: number;
    dimensions: {
      company_fit: number;
      role_fit: number;
      seniority: number;
      activity: number;
    };
    justification: string;
    message: string;
  } | null>({
    reducer: (_a, b) => b,
    default: () => null,
  }),
  leadsCreated: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  searchRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  errorRetries: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  targetCompanies: Annotation<Array<{
    id: string;
    name: string;
    website: string | null;
    linkedinUrl: string | null;
  }>>({
    reducer: (_a, b) => b,
    default: () => [],
  }),
  currentCompanyIndex: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  currentRoleIndex: Annotation<number>({
    reducer: (_a, b) => b,
    default: () => 0,
  }),
  linkedinOnly: Annotation<boolean>({
    reducer: (_a, b) => b,
    default: () => false,
  }),
  companiesSearched: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  log: Annotation<
    Array<{ step: string; message: string; timestamp: string }>
  >({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

export type AgentStateType = typeof AgentState.State;
