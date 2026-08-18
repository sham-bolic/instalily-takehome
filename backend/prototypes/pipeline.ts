import { pathToFileURL } from "node:url";

import { enrichCompany } from "./company-enrichment.ts";
import { type ICPSnapshot } from "./icp-builder.ts";
import { findCompanies } from "./company-sourcing.ts";
import { qualifyCompany } from "./company-qualification.ts";
import { researchCompany } from "./company-research.ts";
import { findEvents } from "./event-sourcing.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import { PipelineRun } from "./pipeline-run.ts";
import {
  discoverEvents,
  enrichCompanies,
  qualifyCompanies,
  sourceCompanies,
  sourceSelectedEvent,
  type EnrichmentCounts,
  type PipelineDependencies,
  type QualificationResult,
} from "./pipeline-stages.ts";

export const DEFAULT_EVENT_THRESHOLD = 0.5;
export const DEFAULT_ENRICHMENT_LIMIT = 10;

export type PipelineOptions = {
  icp: string;
  icpId?: number;
  icpName?: string;
  icpSnapshot?: ICPSnapshot;
  eventThreshold?: number;
  enrichmentLimit?: number;
};

export type PipelineResult = {
  runId: number;
  selectedEvent: string;
  discoveredCompanies: number;
} & EnrichmentCounts &
  QualificationResult;

export function startPipeline(
  database: PipelineDatabase,
  options: PipelineOptions,
  dependencies: PipelineDependencies,
): { runId: number; completion: Promise<PipelineResult> } {
  const eventThreshold = options.eventThreshold ?? DEFAULT_EVENT_THRESHOLD;
  const enrichmentLimit = options.enrichmentLimit ?? DEFAULT_ENRICHMENT_LIMIT;
  const run = new PipelineRun(database, {
    label: `Lead pipeline: ${options.icp}`,
    rootInput: pipelineRootInput(options, eventThreshold, enrichmentLimit),
  });
  const completion = executePipeline(
    run,
    options.icp,
    eventThreshold,
    enrichmentLimit,
    dependencies,
  );
  return { runId: run.id, completion };
}

export function startResumedPipeline(
  database: PipelineDatabase,
  sourceRunId: number,
  dependencies: PipelineDependencies,
): { runId: number; completion: Promise<PipelineResult> } {
  const sourceRun = database.getRun(sourceRunId);
  if (!sourceRun || sourceRun.mode !== "pipeline" || sourceRun.status !== "failed") {
    throw new Error(`Run ${sourceRunId} is not a failed pipeline run.`);
  }

  const sourceInput = objectValue(sourceRun.rootInput);
  const icp = textValue(sourceInput.icp);
  if (!icp) {
    throw new Error(`Run ${sourceRunId} does not contain an ICP snapshot.`);
  }

  const discoveryArtifact = database
    .listStageArtifacts(sourceRunId)
    .toReversed()
    .find(
      (artifact) =>
        artifact.stage === "event_sourcing" && artifact.status === "completed",
    );
  if (!discoveryArtifact) {
    throw new Error(
      `Run ${sourceRunId} does not have a completed event discovery artifact.`,
    );
  }
  const resumedDiscovery = eventDiscovery(discoveryArtifact.output, sourceRunId);
  const options: PipelineOptions = {
    icp,
    ...(integerValue(sourceInput.icp_id) === null
      ? {}
      : { icpId: integerValue(sourceInput.icp_id) ?? undefined }),
    ...(textValue(sourceInput.icp_name)
      ? { icpName: textValue(sourceInput.icp_name) ?? undefined }
      : {}),
    ...(isICPSnapshot(sourceInput.icp_snapshot)
      ? { icpSnapshot: sourceInput.icp_snapshot }
      : {}),
  };
  const eventThreshold = DEFAULT_EVENT_THRESHOLD;
  const enrichmentLimit =
    integerValue(sourceInput.enrichment_limit) ?? DEFAULT_ENRICHMENT_LIMIT;
  const run = new PipelineRun(database, {
    label: sourceRun.label ?? `Lead pipeline: ${icp}`,
    rootInput: {
      ...pipelineRootInput(options, eventThreshold, enrichmentLimit),
      resumed_from_run_id: sourceRunId,
    },
  });
  const completion = executePipeline(
    run,
    icp,
    eventThreshold,
    enrichmentLimit,
    dependencies,
    {
      sourceRunId,
      sourceArtifactId: discoveryArtifact.id,
      discovery: resumedDiscovery,
    },
  );
  return { runId: run.id, completion };
}

export function startPipelineForEvent(
  database: PipelineDatabase,
  sourceRunId: number,
  eventName: string,
  dependencies: PipelineDependencies,
): { runId: number; completion: Promise<PipelineResult> } {
  const sourceRun = database.getRun(sourceRunId);
  if (!sourceRun || sourceRun.mode !== "pipeline" || sourceRun.status === "running") {
    throw new Error(`Run ${sourceRunId} is not available for event selection.`);
  }

  const sourceInput = objectValue(sourceRun.rootInput);
  const icp = textValue(sourceInput.icp);
  if (!icp) {
    throw new Error(`Run ${sourceRunId} does not contain an ICP snapshot.`);
  }

  const discoveryArtifact = database
    .listStageArtifacts(sourceRunId)
    .toReversed()
    .find(
      (artifact) =>
        artifact.stage === "event_sourcing" && artifact.status === "completed",
    );
  if (!discoveryArtifact) {
    throw new Error(
      `Run ${sourceRunId} does not have a completed event discovery artifact.`,
    );
  }

  const discovery = eventDiscovery(discoveryArtifact.output, sourceRunId);
  const selectedEvent = selectableEvent(discovery, eventName, sourceRunId);
  const eventThreshold =
    finiteNumberValue(sourceInput.event_threshold) ?? DEFAULT_EVENT_THRESHOLD;
  const enrichmentLimit =
    integerValue(sourceInput.enrichment_limit) ?? DEFAULT_ENRICHMENT_LIMIT;
  const options: PipelineOptions = {
    icp,
    ...(integerValue(sourceInput.icp_id) === null
      ? {}
      : { icpId: integerValue(sourceInput.icp_id) ?? undefined }),
    ...(textValue(sourceInput.icp_name)
      ? { icpName: textValue(sourceInput.icp_name) ?? undefined }
      : {}),
    ...(isICPSnapshot(sourceInput.icp_snapshot)
      ? { icpSnapshot: sourceInput.icp_snapshot }
      : {}),
  };
  const run = new PipelineRun(database, {
    label: `${sourceRun.label ?? `Lead pipeline: ${icp}`} - ${selectedEvent.name}`,
    rootInput: {
      ...pipelineRootInput(options, eventThreshold, enrichmentLimit),
      selected_event: selectedEvent.name,
      continued_from_run_id: sourceRunId,
    },
  });
  const completion = executePipeline(
    run,
    icp,
    eventThreshold,
    enrichmentLimit,
    dependencies,
    {
      sourceRunId,
      sourceArtifactId: discoveryArtifact.id,
      discovery,
      selectedEvent,
    },
  );
  return { runId: run.id, completion };
}

export function runPipeline(
  database: PipelineDatabase,
  options: PipelineOptions,
  dependencies: PipelineDependencies,
): Promise<PipelineResult> {
  return startPipeline(database, options, dependencies).completion;
}

async function executePipeline(
  run: PipelineRun,
  icp: string,
  eventThreshold: number,
  enrichmentLimit: number,
  dependencies: PipelineDependencies,
  resume?: {
    sourceRunId: number;
    sourceArtifactId: number;
    discovery: Awaited<ReturnType<typeof findEvents>>;
    selectedEvent?: SelectableEvent;
  },
): Promise<PipelineResult> {
  try {
    const discovery = resume
      ? reuseEventDiscovery(run, icp, eventThreshold, resume)
      : await discoverEvents(
          run,
          icp,
          eventThreshold,
          dependencies.findEvents,
        );
    const { event, sourcing } = resume?.selectedEvent
      ? await sourceSelectedEvent(
          run,
          resume.selectedEvent,
          dependencies.findCompanies,
        )
      : await sourceCompanies(
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
      dependencies.researchCompany,
      dependencies.enrichCompany,
    );
    const qualification = await qualifyCompanies(
      run,
      icp,
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

function reuseEventDiscovery(
  run: PipelineRun,
  icp: string,
  threshold: number,
  resume: {
    sourceRunId: number;
    sourceArtifactId: number;
    discovery: Awaited<ReturnType<typeof findEvents>>;
    selectedEvent?: SelectableEvent;
  },
): Awaited<ReturnType<typeof findEvents>> {
  run.completed(
    {
      name: "event_sourcing",
      provider: "sqlite",
      input: {
        icp,
        threshold,
        ...(resume.selectedEvent
          ? { selected_event: resume.selectedEvent.name }
          : {}),
        [resume.selectedEvent ? "continued_from" : "resumed_from"]: {
          run_id: resume.sourceRunId,
          artifact_id: resume.sourceArtifactId,
        },
      },
    },
    resume.discovery,
  );
  return resume.discovery;
}

function pipelineRootInput(
  options: PipelineOptions,
  eventThreshold: number,
  enrichmentLimit: number,
): Record<string, unknown> {
  return {
    icp: options.icp,
    ...(options.icpId === undefined ? {} : { icp_id: options.icpId }),
    ...(options.icpName === undefined ? {} : { icp_name: options.icpName }),
    ...(options.icpSnapshot === undefined
      ? {}
      : { icp_snapshot: options.icpSnapshot }),
    event_threshold: eventThreshold,
    enrichment_limit: enrichmentLimit,
  };
}

function eventDiscovery(
  value: unknown,
  sourceRunId: number,
): Awaited<ReturnType<typeof findEvents>> {
  const candidate = objectValue(value);
  if (!Array.isArray(candidate.events)) {
    throw new Error(
      `Run ${sourceRunId} has an invalid event discovery artifact.`,
    );
  }
  return value as Awaited<ReturnType<typeof findEvents>>;
}

type EventDiscovery = Awaited<ReturnType<typeof findEvents>>;
type SelectableEvent = EventDiscovery["events"][number] & {
  company_source: NonNullable<EventDiscovery["events"][number]["company_source"]>;
};

function selectableEvent(
  discovery: EventDiscovery,
  eventName: string,
  sourceRunId: number,
): SelectableEvent {
  const normalizedName = normalizeName(eventName);
  const event = discovery.events.find(
    (candidate) => normalizeName(candidate.name) === normalizedName,
  );
  if (!event) {
    throw new Error(`Event "${eventName}" was not discovered in run ${sourceRunId}.`);
  }
  if (!event.company_source) {
    throw new Error(`Event "${event.name}" does not have a company directory.`);
  }
  return event as SelectableEvent;
}

function normalizeName(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function integerValue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function finiteNumberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isICPSnapshot(value: unknown): value is ICPSnapshot {
  const snapshot = objectValue(value);
  return snapshot.version === 1 && typeof snapshot.text === "string";
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
        researchCompany: (company) => researchCompany(tavilyApiKey, company),
        enrichCompany: (company) => {
          const apiKey = process.env.APOLLO_API_KEY;
          if (!apiKey) {
            throw new Error("Set APOLLO_API_KEY before uncached enrichment.");
          }
          return enrichCompany(apiKey, company);
        },
        qualifyCompany: (input) => qualifyCompany(geminiApiKey, input),
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
