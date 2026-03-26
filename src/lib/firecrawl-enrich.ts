import { z } from "zod";
import { callClaudeJSON } from "./claude-cli";
import { googleSearch } from "./google-search";

const FIRECRAWL_URL = process.env.FIRECRAWL_URL ?? "http://localhost:3002";

export interface CompanyEnrichment {
  description: string | null;
  sector: string | null;
  employeeCount: string | null;
  products: string[];
  techStack: string[];
  isHiring: boolean;
  contactEmail: string | null;
  contactPhone: string | null;
  address: string | null;
  linkedinUrl: string | null;
  website: string;
}

const enrichmentSchema = z.object({
  description: z.string().nullable(),
  sector: z.string().nullable(),
  employeeCount: z.string().nullable(),
  products: z.array(z.string()).nullable().transform((v) => v ?? []),
  techStack: z.array(z.string()).nullable().transform((v) => v ?? []),
  isHiring: z.boolean().nullable().transform((v) => v ?? false),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  address: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
});

export async function enrichCompany(
  companyName: string,
  websiteUrl: string | null,
  companyCity?: string,
  userId?: string
): Promise<CompanyEnrichment | null> {
  try {
    let url = websiteUrl;
    if (!url) {
      url = await findCompanyWebsite(companyName, companyCity, userId);
      if (!url) return null;
    }

    const markdown = await scrapeWithFirecrawl(url);
    if (!markdown) return null;

    const prompt = `Analyze this company website content and extract structured information.

Company: ${companyName}

Website content (markdown):
${markdown.slice(0, 4000)}

Extract the following (use null if not found):
- description: one-sentence company description
- sector: industry/sector (e.g. "fintech", "healthtech", "SaaS")
- employeeCount: approximate employee count or range (e.g. "50-200", "500+")
- products: list of main products/services (max 5)
- techStack: technologies mentioned (max 5)
- isHiring: true if there are job postings or "careers" section
- contactEmail: main contact email
- contactPhone: main contact phone
- address: physical address
- linkedinUrl: company LinkedIn page URL (e.g. "https://www.linkedin.com/company/acme-corp") or null if not found. Look for LinkedIn links in the page footer, header, or social media section.`;

    const data = await callClaudeJSON(prompt, enrichmentSchema, { timeout: 30_000, model: "haiku" });

    return { ...data, website: url };
  } catch (err) {
    console.error("[firecrawl-enrich] Error:", err);
    return null;
  }
}

async function scrapeWithFirecrawl(url: string): Promise<string | null> {
  try {
    const response = await fetch(`${FIRECRAWL_URL}/v1/scrape`, {
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
      console.error(`[firecrawl] Scrape failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data?.data?.markdown ?? null;
  } catch (err) {
    console.error("[firecrawl] Connection error:", err);
    return null;
  }
}

async function findCompanyWebsite(
  companyName: string,
  city?: string,
  userId?: string
): Promise<string | null> {
  const query = city
    ? `"${companyName}" ${city} site oficial`
    : `"${companyName}" site oficial`;

  const results = await googleSearch(query, userId);

  for (const r of results) {
    const link = r.link.toLowerCase();
    if (
      !link.includes("linkedin.com") &&
      !link.includes("facebook.com") &&
      !link.includes("instagram.com") &&
      !link.includes("twitter.com") &&
      !link.includes("glassdoor.com")
    ) {
      return r.link;
    }
  }

  return null;
}
