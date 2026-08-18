import { tavily } from "@tavily/core";

const MAX_RESULTS = 5;
const MAX_EXCERPT_LENGTH = 700;

export type OutreachResearchInput = {
  companyName: string;
  companyDomain: string;
  icp: string;
};

export type OutreachEvidence = {
  id: string;
  title: string;
  url: string;
  excerpt: string;
  score: number;
};

export type OutreachResearchResult = {
  researched_at: string;
  query: string;
  request_id: string;
  company_domain: string;
  evidence: OutreachEvidence[];
  warnings: string[];
};

type SearchResponse = {
  requestId: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    rawContent?: string;
    score: number;
  }>;
};

export type OutreachSearchClient = (
  apiKey: string,
  query: string,
  companyDomain: string,
) => Promise<SearchResponse>;

async function searchTavily(
  apiKey: string,
  query: string,
  companyDomain: string,
): Promise<SearchResponse> {
  const response = await tavily({ apiKey }).search(query, {
    searchDepth: "advanced",
    maxResults: MAX_RESULTS,
    includeDomains: [companyDomain],
    includeRawContent: "text",
    includeAnswer: false,
  });
  return {
    requestId: response.requestId,
    results: response.results,
  };
}

export async function researchOutreachSignals(
  apiKey: string,
  input: OutreachResearchInput,
  search: OutreachSearchClient = searchTavily,
): Promise<OutreachResearchResult> {
  const companyName = input.companyName.trim();
  const companyDomain = normalizeDomain(input.companyDomain);
  if (!companyName) throw new Error("Outreach research requires a company name.");

  const aerospace = /aircraft|aerospace|cabin interior/i.test(input.icp);
  const marketTerms = aerospace
    ? "(aircraft OR aerospace OR aviation OR cabin OR composite OR laminate)"
    : "(graphics OR signage OR wrap OR laminate OR film OR coating OR surface)";
  const query =
    `site:${companyDomain} ${companyName} ${marketTerms} ` +
    "(product OR application OR launch OR news OR durability OR protection)";
  const response = await search(apiKey, query, companyDomain);
  const evidence = response.results.flatMap((result, index) => {
    if (!belongsToDomain(result.url, companyDomain)) return [];
    const excerpt = cleanExcerpt(result.content || result.rawContent || "");
    if (!excerpt) return [];
    return [{
      id: `company_signal_${index + 1}`,
      title: result.title.trim() || companyName,
      url: result.url,
      excerpt,
      score: result.score,
    }];
  });

  return {
    researched_at: new Date().toISOString(),
    query,
    request_id: response.requestId,
    company_domain: companyDomain,
    evidence,
    warnings: evidence.length
      ? []
      : ["No relevant first-party company signal was found; use role and qualification context only."],
  };
}

function cleanExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_LENGTH);
}

function belongsToDomain(value: string, expectedDomain: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLocaleLowerCase("en-US");
    return hostname === expectedDomain || hostname.endsWith(`.${expectedDomain}`);
  } catch {
    return false;
  }
}

function normalizeDomain(value: string): string {
  const clean = value.trim().toLocaleLowerCase("en-US");
  if (!clean) throw new Error("Outreach research requires a company domain.");
  const hostname = clean.includes("://") ? new URL(clean).hostname : clean;
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}
