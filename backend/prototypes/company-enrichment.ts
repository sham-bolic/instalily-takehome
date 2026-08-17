import { pathToFileURL } from "node:url";

import { PipelineDatabase } from "./pipeline-database.ts";
import { runStageProbe } from "./stage-probe.ts";

const APOLLO_ENRICHMENT_URL =
  "https://api.apollo.io/api/v1/organizations/enrich";

type ApolloMatchInput = {
  domain: string;
  website: string;
};

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

async function fetchApolloOrganization(
  apiKey: string,
  matchInput: ApolloMatchInput,
): Promise<unknown> {
  const url = new URL(APOLLO_ENRICHMENT_URL);
  url.search = new URLSearchParams(matchInput).toString();

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "x-api-key": apiKey,
    },
  });
  const body: unknown = await response.json();

  if (!response.ok) {
    const message = JSON.stringify(body).slice(0, 500);
    throw new Error(
      `Apollo enrichment failed (${response.status}): ${message}`,
    );
  }

  return body;
}

export async function enrichCompany(apiKey: string, companyUrl: string) {
  const website = normalizeCompanyUrl(companyUrl);
  const domain = extractDomain(website);
  const request = { domain, website };
  const providerResponse = await fetchApolloOrganization(apiKey, request);

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

    const request = { domain, website: companyUrl };
    const { runId } = await runStageProbe(database, {
      stage: "company_enrichment",
      label: `Company enrichment: ${domain}`,
      companyDomain: domain,
      input: request,
      provider: "apollo",
      execute: () => enrichCompany(apiKey, companyUrl),
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
