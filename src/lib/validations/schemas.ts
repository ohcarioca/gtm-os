import { z } from "zod";

export const stageEnum = z.enum(["identified", "connected", "in_conversation", "converted", "lost"]);
export const scoreEnum = z.enum(["A+", "A", "B", "C", "D"]);
export const companySizeEnum = z.enum(["small", "medium", "large"]);

export const updateLeadStageSchema = z.object({
  id: z.string().uuid(),
  stage: stageEnum,
});

export const prospectRequestSchema = z.object({
  method: z.enum(["full", "linkedin_direct"]),
  quantity: z.number().int().min(1).max(20),
  company_ids: z.array(z.string().uuid()).min(1).max(50),
  target_roles: z.array(z.string().min(1)).min(1),
  min_score_threshold: z.number().int().min(0).max(100).default(70),
});

export const linkedinCredentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const createLeadSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório"),
  company_name: z.string().min(1, "Empresa é obrigatória"),
  linkedin_url: z.string().url("URL do LinkedIn inválida"),
  role: z.string().optional(),
  stage: stageEnum.optional().default("identified"),
  score: scoreEnum.optional(),
  phone: z.string().optional(),
  email: z.string().email("Email inválido").optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const updateLeadSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).optional(),
  role: z.string().optional(),
  linkedin_url: z.string().url().optional(),
  stage: stageEnum.optional(),
  score: scoreEnum.optional(),
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  notes: z.string().optional(),
});

export const companyProfileSchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200),
  sector: z.string().min(1, "Setor é obrigatório").max(500),
  value_proposition: z.string().min(1, "Proposta de valor é obrigatória").max(2000),
  icp: z.string().min(1, "ICP é obrigatório").max(2000),
});

export const enrichLeadSchema = z.object({
  lead_id: z.string().uuid(),
});

export const companyDiscoveryRequestSchema = z.object({
  sector: z.string().min(1).max(200),
  region: z.string().min(1).max(100),
  sizes: z.array(z.string()).optional().default([]),
  keywords: z.array(z.string()).optional().default([]),
  freeText: z.string().max(500).optional().default(""),
  quantity: z.number().int().min(1).max(20),
});

export const updateProspectCompanySchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "approved", "rejected"]),
});

export const createProspectCompanySchema = z.object({
  name: z.string().min(1, "Nome é obrigatório").max(200),
  website: z.string().url("URL inválida").optional().or(z.literal("")),
  sector: z.string().max(200).optional().or(z.literal("")),
  size: z.string().max(100).optional().or(z.literal("")),
  region: z.string().max(200).optional().or(z.literal("")),
  description: z.string().max(1000).optional().or(z.literal("")),
});

export const importProspectCompaniesSchema = z.object({
  companies: z.array(createProspectCompanySchema).min(1).max(50),
});

export const linkedinLeadRequestSchema = z.object({
  urls: z.array(
    z.string().url().regex(/linkedin\.com\/in\//, "URL deve ser um perfil LinkedIn válido")
  ).min(1, "Adicione pelo menos 1 URL").max(10, "Máximo 10 URLs por vez"),
});

export const saveLinkedinLeadsSchema = z.object({
  leads: z.array(z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    company_name: z.string().min(1),
    linkedin_url: z.string().url(),
    score: scoreEnum.optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().optional(),
    connections: z.number().optional(),
    about: z.string().optional(),
    message: z.string().optional(),
    bant: z.record(z.string(), z.unknown()).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
  })).min(1).max(10),
});

export type CompanyProfileInput = z.infer<typeof companyProfileSchema>;
export type EnrichLeadInput = z.infer<typeof enrichLeadSchema>;
export type CompanyDiscoveryRequestInput = z.infer<typeof companyDiscoveryRequestSchema>;
export type UpdateProspectCompanyInput = z.infer<typeof updateProspectCompanySchema>;

export type UpdateLeadStageInput = z.infer<typeof updateLeadStageSchema>;
export type ProspectRequestInput = z.infer<typeof prospectRequestSchema>;
export type LinkedInCredentialsInput = z.infer<typeof linkedinCredentialsSchema>;
export type CreateLeadInput = z.infer<typeof createLeadSchema>;
export type UpdateLeadInput = z.infer<typeof updateLeadSchema>;
export type CreateProspectCompanyInput = z.infer<typeof createProspectCompanySchema>;
export type ImportProspectCompaniesInput = z.infer<typeof importProspectCompaniesSchema>;
export type LinkedinLeadRequestInput = z.infer<typeof linkedinLeadRequestSchema>;
export type SaveLinkedinLeadsInput = z.infer<typeof saveLinkedinLeadsSchema>;
