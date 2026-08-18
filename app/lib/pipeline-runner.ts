import { enrichCompany } from "../../backend/company-enrichment.ts";
import { qualifyCompany } from "../../backend/company-qualification.ts";
import { startDecisionMakerPipeline } from "../../backend/decision-maker-pipeline.ts";
import { evaluateOutreachCandidates } from "../../backend/outreach-candidate-evaluation.ts";
import { draftPersonalizedOutreach } from "../../backend/outreach-drafting.ts";
import { startOutreachPipeline } from "../../backend/outreach-pipeline.ts";
import { researchOutreachSignals } from "../../backend/outreach-research.ts";
import { researchCompany } from "../../backend/company-research.ts";
import { searchDecisionMakers } from "../../backend/decision-maker-search.ts";
import { findCompanies } from "../../backend/company-sourcing.ts";
import { findEvents } from "../../backend/event-sourcing.ts";
import type { SavedICP } from "../../backend/pipeline-database.ts";
import {
  startPipeline,
  startPipelineForEvent,
  startResumedPipeline,
} from "../../backend/pipeline.ts";
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
      searchDecisionMakers: (input) => searchDecisionMakers(keys.surfe, input),
      outreach: outreachDependencies(keys),
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
      searchDecisionMakers: (input) => searchDecisionMakers(keys.surfe, input),
      outreach: outreachDependencies(keys),
    },
  );
  return observe(execution);
}

export function startLiveDecisionMakerPipeline(sourceRunId: number): number {
  const surfeApiKey = requiredKey("SURFE_API_KEY");
  const execution = startDecisionMakerPipeline(
    getDatabase(),
    sourceRunId,
    (input) => searchDecisionMakers(surfeApiKey, input),
  );
  return observe(execution);
}

export function startLiveOutreachPipeline(sourceRunId: number): number {
  const tavilyApiKey = requiredKey("TAVILY_API_KEY");
  const geminiApiKey = requiredKey("GOOGLE_GENERATIVE_AI_API_KEY");
  const execution = startOutreachPipeline(getDatabase(), sourceRunId, {
    evaluate: (input) => evaluateOutreachCandidates(geminiApiKey, input),
    research: (input) => researchOutreachSignals(tavilyApiKey, input),
    draft: (input) => draftPersonalizedOutreach(geminiApiKey, input),
  });
  return observe(execution);
}

export function resumeLivePipeline(sourceRunId: number): number {
  const keys = providerKeys();
  const execution = startResumedPipeline(getDatabase(), sourceRunId, {
    findEvents: async () => {
      throw new Error("A resumed run must reuse persisted event discovery.");
    },
    findCompanies,
    researchCompany: (company) => researchCompany(keys.tavily, company),
    enrichCompany: (company) => enrichCompany(keys.apollo, company),
    qualifyCompany: (input) => qualifyCompany(keys.gemini, input),
    searchDecisionMakers: (input) => searchDecisionMakers(keys.surfe, input),
    outreach: outreachDependencies(keys),
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
    surfe: requiredKey("SURFE_API_KEY"),
  };
}

function outreachDependencies(keys: ReturnType<typeof providerKeys>) {
  return {
    evaluate: (input: Parameters<typeof evaluateOutreachCandidates>[1]) =>
      evaluateOutreachCandidates(keys.gemini, input),
    research: (input: Parameters<typeof researchOutreachSignals>[1]) =>
      researchOutreachSignals(keys.tavily, input),
    draft: (input: Parameters<typeof draftPersonalizedOutreach>[1]) =>
      draftPersonalizedOutreach(keys.gemini, input),
  };
}

function requiredKey(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting a live run.`);
  return value;
}
