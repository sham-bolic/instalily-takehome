import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ENRICHMENT_RESULTS_DIRECTORY =
  "backend/prototypes/results/company-enrichment";
const APOLLO_ENRICHMENT_URL =
  "https://api.apollo.io/api/v1/organizations/enrich";

type ApolloMatchInput = {
  domain: string;
  website: string;
};

function normalizeCompanyUrl(companyUrl: string): string {
  const url = new URL(companyUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Company URL must use HTTP or HTTPS: ${companyUrl}`);
  }

  url.hash = "";
  return url.href;
}

function extractDomain(companyUrl: string): string {
  const hostname = new URL(companyUrl).hostname.toLowerCase();
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

function enrichmentPath(domain: string): string {
  return `${ENRICHMENT_RESULTS_DIRECTORY}/${domain}.json`;
}

async function loadCachedEnrichment(path: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }

    throw error;
  }
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

async function saveEnrichment(
  path: string,
  enrichment: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(enrichment, null, 2)}\n`);
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
  const resultsPath = enrichmentPath(domain);

  if (!refresh) {
    const cached = await loadCachedEnrichment(resultsPath);
    if (cached) {
      console.log(`Using cached enrichment at ${resultsPath}`);
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
  const providerResponse = await fetchApolloOrganization(apiKey, request);

  await saveEnrichment(resultsPath, {
    enriched_at: new Date().toISOString(),
    provider: {
      name: "apollo",
      endpoint: APOLLO_ENRICHMENT_URL,
      request,
    },
    provider_response: providerResponse,
  });
  console.log(`Saved Apollo enrichment to ${resultsPath}`);
}

await main();
