export type Stage = "identified" | "connected" | "in_conversation" | "converted" | "lost";
export type Score = "A+" | "A" | "B" | "C" | "D";
export type CompanySize = "small" | "medium" | "large";
export type RunStatus = "running" | "completed" | "failed";

export interface Company {
  id: string;
  user_id: string;
  segment_id: string;
  name: string;
  city: string | null;
  state: string | null;
  size: CompanySize | null;
  website: string | null;
  linkedin_url: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Lead {
  id: string;
  user_id: string;
  company_id: string;
  name: string;
  role: string | null;
  linkedin_url: string | null;
  photo_url: string | null;
  connections: number | null;
  recent_activity: string | null;
  stage: Stage;
  score: Score | null;
  bant: { budget?: string; authority?: string; need?: string; timing?: string };
  message: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  validation: { photo?: boolean; connections?: boolean; role_match?: boolean; activity?: boolean };
  created_at: string;
  updated_at: string;
  company?: Company;
}

export interface AgentRun {
  id: string;
  user_id: string;
  segment_id: string;
  region: string;
  quantity: number;
  status: RunStatus;
  leads_found: number;
  leads_approved: number;
  log: AgentLogEntry[];
  started_at: string;
  finished_at: string | null;
}

export interface AgentLogEntry {
  step: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface LinkedInCredentials {
  id: string;
  user_id: string;
  encrypted_email: string;
  encrypted_password: string;
  session_cookies: Record<string, unknown> | null;
  last_login: string | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyProfile {
  id: string;
  user_id: string;
  name: string;
  sector: string;
  value_proposition: string;
  icp: string;
  icp_company_types: string[];
  created_at: string;
  updated_at: string;
}

export type ProspectCompanyStatus = "new" | "approved" | "rejected";

export interface ProspectCompany {
  id: string;
  user_id: string;
  segment_id: string | null;
  name: string;
  website: string | null;
  linkedin_url: string | null;
  sector: string | null;
  size: string | null;
  region: string | null;
  description: string | null;
  tech_stack: string | null;
  products: string | null;
  hiring_status: string | null;
  icp_score: number;
  icp_justification: string | null;
  company_markdown: string | null;
  status: ProspectCompanyStatus;
  source: string;
  created_at: string;
}
