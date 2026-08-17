import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { tavily } from "@tavily/core";

const SEARCH_DEPTH = "basic";
const MAX_RESULTS = 3;
const RESULTS_PATH = "backend/prototypes/results/event-sourcing.json";

type SearchResult = Awaited<ReturnType<typeof searchTavily>>["results"][number];
type CompanySourceType =
  | "exhibitor_directory"
  | "sponsor_list"
  | "speaker_directory"
  | "participant_list";

const COMPANY_SOURCE_PATTERNS: ReadonlyArray<{
  type: CompanySourceType;
  pattern: RegExp;
}> = [
  { type: "exhibitor_directory", pattern: /exhibitor/i },
  { type: "sponsor_list", pattern: /sponsor|partner/i },
  { type: "speaker_directory", pattern: /speaker/i },
  { type: "participant_list", pattern: /participant|attendee/i },
];

async function searchTavily(apiKey: string, query: string) {
  return tavily({ apiKey }).search(query, {
    searchDepth: SEARCH_DEPTH,
    maxResults: MAX_RESULTS,
    includeAnswer: false,
    includeRawContent: false,
  });
}

function findCompanySource(result: SearchResult) {
  const url = new URL(result.url);
  const urlPath = `${url.pathname} ${url.search}`;
  const titleIdentifiesList = /directory|list/i.test(result.title);
  const match = COMPANY_SOURCE_PATTERNS.find(
    ({ pattern }) =>
      pattern.test(urlPath) ||
      (titleIdentifiesList && pattern.test(result.title)),
  );

  return match
    ? {
        type: match.type,
        url: result.url,
      }
    : null;
}

function toEventCandidate(result: SearchResult) {
  return {
    name: result.title,
    discovery_url: result.url,
    summary: result.content,
    relevance_score: result.score,
    company_source: findCompanySource(result),
  };
}

async function findEvents(apiKey: string, icp: string) {
  const now = new Date();
  const start = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  const dateRange = `${start} through ${now.getUTCFullYear() + 1}`;
  const query =
    `Official exhibitor directories for upcoming ${dateRange} trade shows ` +
    `relevant to this target market: ${icp}`;
  const response = await searchTavily(apiKey, query);

  return {
    searched_at: now.toISOString(),
    icp,
    query,
    request_id: response.requestId,
    events: response.results.map(toEventCandidate),
  };
}

async function saveResults(results: Awaited<ReturnType<typeof findEvents>>) {
  await mkdir(dirname(RESULTS_PATH), { recursive: true });
  await writeFile(RESULTS_PATH, `${JSON.stringify(results, null, 2)}\n`);
}

async function main(): Promise<void> {
  const icp = process.argv.slice(2).join(" ").trim();
  if (!icp) {
    console.error(
      'Usage: npm run event-sourcing -- "<ideal customer profile>"',
    );
    process.exitCode = 2;
    return;
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    console.error("Set the TAVILY_API_KEY environment variable.");
    process.exitCode = 2;
    return;
  }

  const results = await findEvents(apiKey, icp);
  await saveResults(results);
  console.log(`Saved ${results.events.length} results to ${RESULTS_PATH}`);
}

await main();
