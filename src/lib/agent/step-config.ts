import {
  Search, User, CheckCircle, Target, ClipboardList,
  AlertTriangle, Globe, FileText, Building2, Zap,
} from "lucide-react";

export const stepConfig: Record<string, { icon: React.ElementType; bg: string; text: string }> = {
  search_company: { icon: Search, bg: "bg-indigo-100", text: "text-indigo-600" },
  find_decision_maker: { icon: User, bg: "bg-amber-100", text: "text-amber-600" },
  validate_profile: { icon: CheckCircle, bg: "bg-emerald-100", text: "text-emerald-600" },
  score_lead: { icon: Target, bg: "bg-cyan-100", text: "text-cyan-600" },
  create_lead: { icon: ClipboardList, bg: "bg-purple-100", text: "text-purple-600" },
  linkedin_auth_required: { icon: AlertTriangle, bg: "bg-red-100", text: "text-red-600" },
  build_queries: { icon: Search, bg: "bg-blue-100", text: "text-blue-600" },
  search_companies: { icon: Globe, bg: "bg-indigo-100", text: "text-indigo-600" },
  scrape_company: { icon: FileText, bg: "bg-orange-100", text: "text-orange-600" },
  analyze_company: { icon: Target, bg: "bg-cyan-100", text: "text-cyan-600" },
  save_company: { icon: Building2, bg: "bg-green-100", text: "text-green-600" },
  find_lead: { icon: Search, bg: "bg-indigo-100", text: "text-indigo-600" },
  google_search: { icon: Globe, bg: "bg-blue-100", text: "text-blue-600" },
  triage_snippets: { icon: Target, bg: "bg-amber-100", text: "text-amber-600" },
};

export const defaultStepConfig = { icon: Zap, bg: "bg-slate-100", text: "text-slate-600" };
