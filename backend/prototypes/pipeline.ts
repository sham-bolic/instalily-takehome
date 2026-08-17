import { pathToFileURL } from "node:url";

import { enrichCompany } from "./company-enrichment.ts";
import { findCompanies } from "./company-sourcing.ts";
import { createGeminiCompanyQualifier } from "./company-qualification.ts";
import { findEvents } from "./event-sourcing.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import { PipelineRun } from "./pipeline-run.ts";
import {
  discoverEvents,
  enrichCompanies,
  qualifyCompanies,
  sourceCompanies,
  type EnrichmentCounts,
  type PipelineDependencies,
  type QualificationResult,
} from "./pipeline-stages.ts";

export const DEFAULT_EVENT_THRESHOLD = 0.7;
export const DEFAULT_ENRICHMENT_LIMIT = 5;

type PipelineOptions = {
  icp: string;
  eventThreshold?: number;
  enrichmentLimit?: number;
};

export type PipelineResult = {
  runId: number;
  selectedEvent: string;
  discoveredCompanies: number;
} & EnrichmentCounts &
  QualificationResult;

export async function runPipeline(
  database: PipelineDatabase,
  options: PipelineOptions,
  dependencies: PipelineDependencies,
): Promise<PipelineResult> {
  const eventThreshold = options.eventThreshold ?? DEFAULT_EVENT_THRESHOLD;
  const enrichmentLimit = options.enrichmentLimit ?? DEFAULT_ENRICHMENT_LIMIT;
  const run = new PipelineRun(database, {
    label: `Lead pipeline: ${options.icp}`,
    rootInput: {
      icp: options.icp,
      event_threshold: eventThreshold,
      enrichment_limit: enrichmentLimit,
    },
  });

  try {
    const discovery = await discoverEvents(
      run,
      options.icp,
      eventThreshold,
      dependencies.findEvents,
    );
    const { event, sourcing } = await sourceCompanies(
      run,
      discovery.events,
      eventThreshold,
      dependencies.findCompanies,
    );
    const enrichment = await enrichCompanies(
      run,
      event,
      sourcing.companies,
      enrichmentLimit,
      dependencies.enrichCompany,
    );
    const qualification = await qualifyCompanies(
      run,
      options.icp,
      dependencies.qualifyCompany,
    );

    run.complete();
    return {
      runId: run.id,
      selectedEvent: event.name,
      discoveredCompanies: sourcing.companies.length,
      ...enrichment,
      ...qualification,
    };
  } catch (error) {
    run.fail(error);
    throw error;
  }
}

async function main(): Promise<void> {
  const icp = process.argv.slice(2).join(" ").trim();
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;

  if (!icp || !tavilyApiKey || !geminiApiKey) {
    console.error(
      !icp
        ? 'Usage: npm run pipeline -- "<ideal customer profile>"'
        : "Set the Tavily and Gemini API keys in .env.",
    );
    process.exitCode = 2;
    return;
  }

  const database = new PipelineDatabase();
  try {
    const result = await runPipeline(
      database,
      { icp },
      {
        findEvents: (value) => findEvents(tavilyApiKey, value),
        findCompanies,
        enrichCompany: (companyUrl) => {
          const apiKey = process.env.APOLLO_API_KEY;
          if (!apiKey) {
            throw new Error("Set APOLLO_API_KEY before uncached enrichment.");
          }
          return enrichCompany(apiKey, companyUrl);
        },
        qualifyCompany: createGeminiCompanyQualifier({
          apiKey: geminiApiKey,
          model: process.env.GEMINI_MODEL,
        }),
      },
    );
    console.log(
      `Pipeline run ${result.runId} completed: ${result.enrichedCompanies} enriched, ` +
        `${result.qualifiedCompanies} qualified, ${result.failedEnrichments + result.failedQualifications} failed`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
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
