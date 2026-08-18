import { tavily } from "@tavily/core";

import { normalizeCompanyUrl } from "./company-enrichment.ts";

const MAX_RESULTS = 5;

export type CompanyResearchInput = {
  name: string;
  event: string;
  knownWebsite: string | null;
};

type SearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

type SearchResponse = {
  requestId: string;
  answer?: string;
  results: SearchResult[];
};

export type CompanyResearch = {
  researched_at: string;
  query: string;
  request_id: string;
  company_url: string | null;
  identity_confidence: "high" | "medium" | "unresolved";
  summary: string | null;
  sources: Array<{
    title: string;
    url: string;
    excerpt: string;
    score: number;
  }>;
};

export type CompanySearchClient = (
  apiKey: string,
  query: string,
) => Promise<SearchResponse>;

const NON_COMPANY_HOSTS = [
  "bloomberg.com",
  "crunchbase.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "mapyourshow.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "zoominfo.com",
];

const COMPANY_SUFFIXES = new Set([
  "and",
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "limited",
  "ltd",
  "the",
]);

async function searchTavily(
  apiKey: string,
  query: string,
): Promise<SearchResponse> {
  const response = await tavily({ apiKey }).search(query, {
    searchDepth: "basic",
    maxResults: MAX_RESULTS,
    includeAnswer: "basic",
    includeRawContent: false,
  });

  return {
    requestId: response.requestId,
    answer: response.answer,
    results: response.results,
  };
}

export async function researchCompany(
  apiKey: string,
  input: CompanyResearchInput,
  search: CompanySearchClient = searchTavily,
): Promise<CompanyResearch> {
  const query = buildCompanyResearchQuery(input);
  const response = await search(apiKey, query);
  const resolved = input.knownWebsite
    ? {
        url: normalizeCompanyUrl(input.knownWebsite),
        confidence: "high" as const,
      }
    : resolveOfficialWebsite(input.name, response.results);

  return {
    researched_at: new Date().toISOString(),
    query,
    request_id: response.requestId,
    company_url: resolved?.url ?? null,
    identity_confidence: resolved?.confidence ?? "unresolved",
    summary: response.answer?.trim() || null,
    sources: response.results.map((result) => ({
      title: result.title,
      url: result.url,
      excerpt: result.content,
      score: result.score,
    })),
  };
}

export function buildCompanyResearchQuery(input: CompanyResearchInput): string {
  return `"${input.name}" "${input.event}" official website company products services headquarters employees`;
}

function resolveOfficialWebsite(
  companyName: string,
  results: SearchResult[],
): { url: string; confidence: "high" | "medium" } | null {
  const companyTokens = identityTokens(companyName);
  const compactName = companyTokens.join("");
  const candidates = results
    .map((result) => {
      try {
        const url = new URL(result.url);
        if (!isHttp(url) || isNonCompanyHost(url.hostname)) return null;

        const host = url.hostname.replace(/^www\./, "").toLocaleLowerCase("en-US");
        const compactHost = host.replace(/[^a-z0-9]/g, "");
        const titleTokens = new Set(identityTokens(result.title));
        const titleMatches = companyTokens.filter((token) => titleTokens.has(token));
        const domainMatch =
          compactName.length >= 4 && compactHost.includes(compactName);
        const tokenDomainMatch = companyTokens.some(
          (token) => token.length >= 4 && compactHost.includes(token),
        );
        const strongTitleMatch =
          companyTokens.length > 0 && titleMatches.length === companyTokens.length;

        if (!domainMatch && !(tokenDomainMatch && strongTitleMatch)) return null;
        return {
          url: `${url.protocol}//${url.host}/`,
          confidence: domainMatch ? ("high" as const) : ("medium" as const),
          score: result.score,
        };
      } catch {
        return null;
      }
    })
    .filter(
      (candidate): candidate is {
        url: string;
        confidence: "high" | "medium";
        score: number;
      } => candidate !== null,
    )
    .sort((left, right) => {
      const confidenceDifference =
        Number(right.confidence === "high") - Number(left.confidence === "high");
      return confidenceDifference || right.score - left.score;
    });

  return candidates[0] ?? null;
}

function identityTokens(value: string): string[] {
  return value
    .toLocaleLowerCase("en-US")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !COMPANY_SUFFIXES.has(token));
}

function isHttp(url: URL): boolean {
  return url.protocol === "http:" || url.protocol === "https:";
}

function isNonCompanyHost(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLocaleLowerCase("en-US");
  return NON_COMPANY_HOSTS.some(
    (blocked) => host === blocked || host.endsWith(`.${blocked}`),
  );
}
