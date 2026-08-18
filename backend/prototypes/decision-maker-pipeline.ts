import { pathToFileURL } from "node:url";

import { searchDecisionMakers } from "./decision-maker-search.ts";
import { PipelineDatabase, type CompanyProfile } from "./pipeline-database.ts";
import { PipelineRun } from "./pipeline-run.ts";
import {
  sourceDecisionMakers,
  type DecisionMakerSearchCounts,
  type PipelineDependencies,
} from "./pipeline-stages.ts";

export type DecisionMakerPipelineResult = DecisionMakerSearchCounts & {
  runId: number;
  sourceRunId: number;
  importedQualifiedLeads: number;
};

export function startDecisionMakerPipeline(
  database: PipelineDatabase,
  sourceRunId: number,
  search: NonNullable<PipelineDependencies["searchDecisionMakers"]>,
): { runId: number; completion: Promise<DecisionMakerPipelineResult> } {
  const sourceRun = database.getRun(sourceRunId);
  if (!sourceRun || sourceRun.status !== "completed") {
    throw new Error(`Run ${sourceRunId} is not a completed pipeline run.`);
  }

  const qualifiedProfiles = database
    .listCompanyProfiles(sourceRunId)
    .filter(isHighFitProfile);
  if (qualifiedProfiles.length === 0) {
    throw new Error(`Run ${sourceRunId} does not contain any high-fit leads.`);
  }

  const sourceInput = objectValue(sourceRun.rootInput);
  const run = new PipelineRun(database, {
    label: `Decision-makers: ${sourceRun.label ?? `run ${sourceRunId}`}`,
    rootInput: {
      ...(textValue(sourceInput.icp) ? { icp: textValue(sourceInput.icp) } : {}),
      ...(positiveInteger(sourceInput.icp_id) !== null
        ? { icp_id: positiveInteger(sourceInput.icp_id) }
        : {}),
      ...(textValue(sourceInput.icp_name)
        ? { icp_name: textValue(sourceInput.icp_name) }
        : {}),
      decision_makers_from_run_id: sourceRunId,
    },
  });

  for (const profile of qualifiedProfiles) {
    run.saveProfile({
      domain: profile.domain,
      companyUrl: profile.companyUrl,
      profile: {
        ...objectValue(profile.profile),
        source_profile: {
          run_id: sourceRunId,
          profile_id: profile.id,
        },
      },
    });
  }
  run.completed(
    {
      name: "qualified_lead_import",
      provider: "sqlite",
      input: { source_run_id: sourceRunId },
    },
    {
      imported_companies: qualifiedProfiles.map((profile) => ({
        domain: profile.domain,
        company_name: profileName(profile),
        source_profile_id: profile.id,
      })),
    },
  );

  return {
    runId: run.id,
    completion: executeDecisionMakerPipeline(
      run,
      sourceRunId,
      qualifiedProfiles.length,
      search,
    ),
  };
}

async function executeDecisionMakerPipeline(
  run: PipelineRun,
  sourceRunId: number,
  importedQualifiedLeads: number,
  search: NonNullable<PipelineDependencies["searchDecisionMakers"]>,
): Promise<DecisionMakerPipelineResult> {
  try {
    const result = await sourceDecisionMakers(run, search);
    run.complete();
    return {
      runId: run.id,
      sourceRunId,
      importedQualifiedLeads,
      ...result,
    };
  } catch (error) {
    run.fail(error);
    throw error;
  }
}

function isHighFitProfile(profile: CompanyProfile): boolean {
  const value = objectValue(profile.profile);
  return objectValue(value.qualification).fit === "high";
}

function profileName(profile: CompanyProfile): string {
  const name = objectValue(profile.profile).name;
  return typeof name === "string" && name.trim() ? name : profile.domain;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

async function main(): Promise<void> {
  const sourceRunId = Number(process.argv[2]);
  if (!Number.isInteger(sourceRunId) || sourceRunId < 1) {
    console.error("Usage: npm run decision-makers -- <completed run ID>");
    process.exitCode = 2;
    return;
  }

  const apiKey = process.env.SURFE_API_KEY;
  if (!apiKey) {
    console.error("Set SURFE_API_KEY in .env before searching decision-makers.");
    process.exitCode = 2;
    return;
  }

  const database = new PipelineDatabase();
  try {
    const execution = startDecisionMakerPipeline(
      database,
      sourceRunId,
      (input) => searchDecisionMakers(apiKey, input),
    );
    const result = await execution.completion;
    console.log(
      `Decision-maker run ${result.runId} completed from run ${sourceRunId}: ` +
        `${result.decisionMakersFound} people found across ${result.searchedQualifiedLeads} high-fit leads.`,
    );
    console.log(`Open /runs/${result.runId}?tab=people in the dashboard.`);
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
