import { pathToFileURL } from "node:url";

import { tavily } from "@tavily/core";

import { type ICPFormInput } from "./icp-builder.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import { runStageProbe } from "./stage-probe.ts";

const SEARCH_DEPTH = "basic";
const MAX_RESULTS = 3;
const EVENT_QUERY_TARGET_CHARACTERS = 500;

type SearchResult = Awaited<ReturnType<typeof searchTavily>>["results"][number];
export type CompanySourceType =
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

export function buildEventSearchQuery(
  icp: string,
  now: Date,
  criteria?: ICPFormInput,
): string {
  const start = new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  const dateRange = `${start} through ${now.getUTCFullYear() + 1}`;
  const prefix =
    `Upcoming ${dateRange} trade shows with official exhibitor directories. `;
  const target = criteria
    ? structuredSearchTarget(criteria)
    : `Target market: ${compact(icp)}`;

  return truncate(prefix + target, EVENT_QUERY_TARGET_CHARACTERS);
}

function structuredSearchTarget(criteria: ICPFormInput): string {
  const parts = [
    `Industries: ${truncate(compact(criteria.targetCompanies), 180)}`,
    `Applications: ${truncate(compact(criteria.applications), 140)}`,
  ];
  const geography = compact(criteria.geography ?? "");
  if (geography && !/^no geographic restriction[.]?$/i.test(geography)) {
    parts.push(`Region: ${truncate(geography, 60)}`);
  }
  return parts.join(". ");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxCharacters: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) {
    return value;
  }

  return characters.slice(0, maxCharacters - 1).join("").trimEnd() + "…";
}

export async function findEvents(
  apiKey: string,
  icp: string,
  criteria?: ICPFormInput,
) {
  const now = new Date();
  const query = buildEventSearchQuery(icp, now, criteria);
  const response = await searchTavily(apiKey, query);

  return {
    searched_at: now.toISOString(),
    icp,
    query,
    request_id: response.requestId,
    events: response.results.map(toEventCandidate),
  };
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

  const database = new PipelineDatabase(process.env.PIPELINE_DATABASE_PATH);
  try {
    const { runId, output } = await runStageProbe(database, {
      stage: "event_sourcing",
      label: "Event sourcing",
      input: { icp },
      provider: "tavily",
      execute: () => findEvents(apiKey, icp),
    });
    console.log(
      `Saved ${output.events.length} event candidates to SQLite run ${runId}`,
    );
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
