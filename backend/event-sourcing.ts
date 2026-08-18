import { pathToFileURL } from "node:url";

import { tavily } from "@tavily/core";

import { type ICPFormInput } from "./icp-builder.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import { runStageProbe } from "./stage-probe.ts";

const SEARCH_DEPTH = "advanced";
const MAX_RESULTS = 10;
const DIRECTORY_MAX_RESULTS = 5;
const MAX_DIRECTORY_LOOKUPS = 5;
const EVENT_QUERY_MAX_CHARACTERS = 260;

export type CompanySourceType =
  | "exhibitor_directory"
  | "sponsor_list"
  | "speaker_directory"
  | "participant_list";

type SearchResult = {
  title: string;
  url: string;
  content: string;
  score: number;
};

type SearchResponse = {
  requestId: string;
  results: SearchResult[];
};

type SearchClient = (
  apiKey: string,
  query: string,
  maxResults?: number,
) => Promise<SearchResponse>;

const COMPANY_SOURCE_PATTERNS: ReadonlyArray<{
  type: CompanySourceType;
  pattern: RegExp;
}> = [
  { type: "exhibitor_directory", pattern: /exhibitor/i },
  { type: "sponsor_list", pattern: /sponsor|partner/i },
  { type: "speaker_directory", pattern: /speaker/i },
  { type: "participant_list", pattern: /participant|attendee/i },
];

const EVENT_PATTERN =
  /\b(?:conference|convention|event|expo|exposition|summit|trade[ -]?show)\b/i;
const STOP_WORDS = new Set([
  "about",
  "active",
  "also",
  "and",
  "are",
  "broad",
  "can",
  "capable",
  "companies",
  "company",
  "established",
  "for",
  "from",
  "global",
  "has",
  "have",
  "including",
  "into",
  "large",
  "major",
  "markets",
  "multiple",
  "primary",
  "prioritizing",
  "relevant",
  "secondary",
  "serves",
  "strong",
  "that",
  "the",
  "their",
  "they",
  "through",
  "using",
  "with",
]);

async function searchTavily(
  apiKey: string,
  query: string,
  maxResults = MAX_RESULTS,
): Promise<SearchResponse> {
  const response = await tavily({ apiKey }).search(query, {
    searchDepth: SEARCH_DEPTH,
    maxResults,
    includeAnswer: false,
    includeRawContent: false,
  });

  return { requestId: response.requestId, results: response.results };
}

function findCompanySource(result: SearchResult) {
  const url = new URL(result.url);
  const searchable = `${url.pathname} ${url.search} ${result.title}`;
  if (
    /mapyourshow\.com$/i.test(url.hostname) &&
    /floorplan|exhview/i.test(searchable)
  ) {
    return { type: "exhibitor_directory" as const, url: result.url };
  }

  const hasDirectoryIntent =
    /directory|list|floorplan|floor-plan|exhview/i.test(searchable) ||
    /\/(?:exhibitors?|sponsors?|speakers?|participants?|attendees?)\/?$/i.test(
      url.pathname,
    );
  if (!hasDirectoryIntent) return null;

  const match = COMPANY_SOURCE_PATTERNS.find(({ pattern }) =>
    pattern.test(searchable),
  );
  return match ? { type: match.type, url: result.url } : null;
}

function toEventCandidate(
  result: SearchResult,
  companySource = findCompanySource(result),
) {
  return {
    name: result.title,
    discovery_url: result.url,
    summary: result.content,
    relevance_score: result.score,
    company_source: companySource,
  };
}

export function buildEventSearchQueries(
  icp: string,
  now: Date,
  criteria?: ICPFormInput,
): string[] {
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(now);
  const date = `upcoming ${month} ${now.getUTCFullYear()} ${now.getUTCFullYear() + 1}`;
  const sources = criteria
    ? [
        extractKeywords(criteria.targetCompanies, 8),
        extractKeywords(criteria.applications, 8),
        extractEventHints(criteria.strongFitSignals ?? "") ||
          extractKeywords(criteria.strongFitSignals ?? criteria.offering, 8),
      ]
    : [extractKeywords(icp, 8)];

  return [
    ...new Set(
      sources.map((keywords) =>
        truncate(
          `${date} ${keywords} trade show expo exhibitors directory`,
          EVENT_QUERY_MAX_CHARACTERS,
        ),
      ),
    ),
  ];
}

/** Retained for callers that only need one preview query. */
export function buildEventSearchQuery(
  icp: string,
  now: Date,
  criteria?: ICPFormInput,
): string {
  return buildEventSearchQueries(icp, now, criteria)[0] ?? "";
}

function extractEventHints(value: string): string {
  const namedEvents =
    value.match(
      /\b(?:[A-Z][\p{L}\p{N}&-]*\s+){1,4}(?:Expo|United|Conference|Show|Summit)\b/gu,
    ) ?? [];
  const namedEventText = namedEvents.join(" ").toLocaleLowerCase("en-US");
  const acronyms = (value.match(/\b[A-Z]{4,}\b/g) ?? []).filter(
    (acronym) => !namedEventText.includes(acronym.toLocaleLowerCase("en-US")),
  );
  return [...new Set([...namedEvents, ...acronyms])].join(" ");
}

function extractKeywords(value: string, limit: number): string {
  const keywords: string[] = [];
  const seen = new Set<string>();
  for (const token of compact(value).match(
    /[\p{L}\p{N}]+(?:[-/&][\p{L}\p{N}]+)*/gu,
  ) ?? []) {
    const normalized = token.toLocaleLowerCase("en-US");
    if (
      normalized.length < 3 ||
      STOP_WORDS.has(normalized) ||
      seen.has(normalized)
    )
      continue;
    seen.add(normalized);
    keywords.push(truncate(token, 40));
    if (keywords.length === limit) break;
  }
  return keywords.join(" ");
}

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxCharacters: number): string {
  const characters = Array.from(value);
  if (characters.length <= maxCharacters) return value;
  return (
    characters
      .slice(0, maxCharacters - 1)
      .join("")
      .trimEnd() + "…"
  );
}

function uniqueResults(responses: SearchResponse[]): SearchResult[] {
  const byUrl = new Map<string, SearchResult>();
  for (const result of responses.flatMap((response) => response.results)) {
    const existing = byUrl.get(result.url);
    if (!existing || result.score > existing.score)
      byUrl.set(result.url, result);
  }
  return [...byUrl.values()].sort((left, right) => right.score - left.score);
}

function directoryQuery(result: SearchResult, now: Date): string {
  const eventTerms = extractKeywords(result.title, 6);
  return truncate(
    `${now.getUTCFullYear()} ${now.getUTCFullYear() + 1} ${eventTerms} exhibitor list directory floor plan`,
    EVENT_QUERY_MAX_CHARACTERS,
  );
}

function isTrustedDirectory(
  event: SearchResult,
  directory: SearchResult,
): boolean {
  const eventHost = new URL(event.url).hostname.replace(/^www\./, "");
  const directoryHost = new URL(directory.url).hostname.replace(/^www\./, "");
  return (
    directoryHost === eventHost ||
    directoryHost.endsWith(`.${eventHost}`) ||
    /(?:^|\.)mapyourshow\.com$/i.test(directoryHost)
  );
}

export async function findEvents(
  apiKey: string,
  icp: string,
  criteria?: ICPFormInput,
  search: SearchClient = searchTavily,
) {
  const now = new Date();
  const queries = buildEventSearchQueries(icp, now, criteria);
  const discoveryResponses = await Promise.all(
    queries.map((query) => search(apiKey, query, MAX_RESULTS)),
  );
  const results = uniqueResults(discoveryResponses);
  const directoryCandidates = results
    .filter(
      (result) =>
        !findCompanySource(result) &&
        EVENT_PATTERN.test(`${result.title} ${result.content}`),
    )
    .slice(0, MAX_DIRECTORY_LOOKUPS);
  const directoryQueries = directoryCandidates.map((result) =>
    directoryQuery(result, now),
  );
  const directoryResponses = await Promise.all(
    directoryQueries.map((query) =>
      search(apiKey, query, DIRECTORY_MAX_RESULTS),
    ),
  );
  const directoryByEventUrl = new Map<
    string,
    ReturnType<typeof findCompanySource>
  >();

  directoryCandidates.forEach((event, index) => {
    const directory =
      directoryResponses[index]?.results
        .filter((result) => isTrustedDirectory(event, result))
        .map((result) => findCompanySource(result))
        .find((source) => source !== null) ?? null;
    directoryByEventUrl.set(event.url, directory);
  });

  return {
    searched_at: now.toISOString(),
    icp,
    queries: [...queries, ...directoryQueries],
    request_ids: [...discoveryResponses, ...directoryResponses].map(
      (response) => response.requestId,
    ),
    events: results.map((result) =>
      toEventCandidate(
        result,
        findCompanySource(result) ??
          directoryByEventUrl.get(result.url) ??
          null,
      ),
    ),
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
