import { enrichCompany } from "../../backend/prototypes/company-enrichment.ts";
import { qualifyCompany } from "../../backend/prototypes/company-qualification.ts";
import { researchCompany } from "../../backend/prototypes/company-research.ts";
import { findCompanies } from "../../backend/prototypes/company-sourcing.ts";
import { findEvents } from "../../backend/prototypes/event-sourcing.ts";
import type { SavedICP } from "../../backend/prototypes/pipeline-database.ts";
import {
  startPipeline,
  startPipelineForEvent,
  startResumedPipeline,
} from "../../backend/prototypes/pipeline.ts";
import { getDatabase } from "./database.ts";

export function startLivePipeline(icp: SavedICP): number {
  const keys = providerKeys();
  const execution = startPipeline(
    getDatabase(),
    {
      icp: icp.snapshot.text,
      icpId: icp.id,
      icpName: icp.name,
      icpSnapshot: icp.snapshot,
    },
    {
      findEvents: (value) =>
        findEvents(keys.tavily, value, icp.snapshot.criteria),
      findCompanies,
      researchCompany: (company) => researchCompany(keys.tavily, company),
      enrichCompany: (company) => enrichCompany(keys.apollo, company),
      qualifyCompany: (input) => qualifyCompany(keys.gemini, input),
    },
  );
  return observe(execution);
}

export function startLivePipelineForEvent(
  sourceRunId: number,
  eventName: string,
): number {
  const keys = providerKeys();
  const execution = startPipelineForEvent(
    getDatabase(),
    sourceRunId,
    eventName,
    {
      findEvents: async () => {
        throw new Error("An event-selected run must reuse persisted discovery.");
      },
      findCompanies,
      researchCompany: (company) => researchCompany(keys.tavily, company),
      enrichCompany: (company) => enrichCompany(keys.apollo, company),
      qualifyCompany: (input) => qualifyCompany(keys.gemini, input),
    },
  );
  return observe(execution);
}

export function resumeLivePipeline(sourceRunId: number): number {
  const tavilyApiKey = requiredKey("TAVILY_API_KEY");
  const apolloApiKey = requiredKey("APOLLO_API_KEY");
  const geminiApiKey = requiredKey("GOOGLE_GENERATIVE_AI_API_KEY");
  const execution = startResumedPipeline(getDatabase(), sourceRunId, {
    findEvents: async () => {
      throw new Error("A resumed run must reuse persisted event discovery.");
    },
    findCompanies,
    researchCompany: (company) => researchCompany(tavilyApiKey, company),
    enrichCompany: (company) => enrichCompany(apolloApiKey, company),
    qualifyCompany: (input) => qualifyCompany(geminiApiKey, input),
  });
  return observe(execution);
}

function observe(execution: {
  runId: number;
  completion: Promise<unknown>;
}): number {
  void execution.completion.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Pipeline run ${execution.runId} failed: ${message}`);
  });
  return execution.runId;
}

function providerKeys() {
  return {
    tavily: requiredKey("TAVILY_API_KEY"),
    apollo: requiredKey("APOLLO_API_KEY"),
    gemini: requiredKey("GOOGLE_GENERATIVE_AI_API_KEY"),
  };
}

function requiredKey(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting a live run.`);
  return value;
}
