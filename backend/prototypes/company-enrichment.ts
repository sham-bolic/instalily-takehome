import { pathToFileURL } from "node:url";

import { PipelineDatabase } from "./pipeline-database.ts";
import { runStageProbe } from "./stage-probe.ts";

const APOLLO_ENRICHMENT_URL =
  "https://api.apollo.io/api/v1/organizations/enrich";

export type CompanyMatchInput = {
  name?: string;
  website?: string | null;
};

type ApolloMatchInput = {
  name?: string;
  domain?: string;
  website?: string;
};

type Fetcher = typeof fetch;

export function normalizeCompanyUrl(companyUrl: string): string {
  const url = new URL(companyUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Company URL must use HTTP or HTTPS: ${companyUrl}`);
  }

  url.hash = "";
  return url.href;
}

export function extractDomain(companyUrl: string): string {
  const hostname = new URL(companyUrl).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function apolloMatchInput(input: CompanyMatchInput): ApolloMatchInput {
  const name = input.name?.trim() || undefined;
  const website = input.website ? normalizeCompanyUrl(input.website) : undefined;
  if (!name && !website) {
    throw new Error("Company enrichment requires a company name or website.");
  }

  return {
    ...(name ? { name } : {}),
    ...(website ? { domain: extractDomain(website), website } : {}),
  };
}

export async function enrichCompany(
  apiKey: string,
  input: CompanyMatchInput,
  fetcher: Fetcher = fetch,
) {
  const request = apolloMatchInput(input);
  const url = new URL(APOLLO_ENRICHMENT_URL);
  url.search = new URLSearchParams(request).toString();
  const response = await fetcher(url, {
    headers: {
      accept: "application/json",
      "x-api-key": apiKey,
    },
  });
  const providerResponse: unknown = await response.json();

  if (!response.ok) {
    const message = JSON.stringify(providerResponse).slice(0, 500);
    throw new Error(
      `Apollo enrichment failed (${response.status}): ${message}`,
    );
  }

  return {
    enriched_at: new Date().toISOString(),
    provider: {
      name: "apollo",
      endpoint: APOLLO_ENRICHMENT_URL,
      request,
    },
    provider_response: providerResponse,
  };
}

async function main(): Promise<void> {
  const argumentsWithoutRefresh = process.argv
    .slice(2)
    .filter((argument) => argument !== "--refresh");
  const refresh = process.argv.slice(2).includes("--refresh");

  if (argumentsWithoutRefresh.length !== 1) {
    console.error(
      'Usage: npm run company-enrichment -- "<company URL>" [--refresh]',
    );
    process.exitCode = 2;
    return;
  }

  const companyUrl = normalizeCompanyUrl(argumentsWithoutRefresh[0]);
  const domain = extractDomain(companyUrl);
  const database = new PipelineDatabase(process.env.PIPELINE_DATABASE_PATH);

  try {
    if (!refresh) {
      const cached = database.findLatestCompletedStageArtifact({
        stage: "company_enrichment",
        companyDomain: domain,
      });
      if (cached) {
        console.log(`Using cached Apollo enrichment from run ${cached.runId}`);
        return;
      }
    }

    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
      console.error("Set APOLLO_API_KEY in .env before requesting enrichment.");
      process.exitCode = 2;
      return;
    }

    const request = { website: companyUrl };
    const { runId } = await runStageProbe(database, {
      stage: "company_enrichment",
      label: `Company enrichment: ${domain}`,
      companyDomain: domain,
      input: request,
      provider: "apollo",
      execute: () => enrichCompany(apiKey, request),
    });
    console.log(`Saved Apollo enrichment to SQLite run ${runId}`);
  } finally {
    database.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
