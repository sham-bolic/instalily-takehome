import { enrichCompany } from "../../backend/prototypes/company-enrichment.ts";
import { qualifyCompany } from "../../backend/prototypes/company-qualification.ts";
import { findCompanies } from "../../backend/prototypes/company-sourcing.ts";
import { findEvents } from "../../backend/prototypes/event-sourcing.ts";
import type { SavedICP } from "../../backend/prototypes/pipeline-database.ts";
import { startPipeline } from "../../backend/prototypes/pipeline.ts";
import { getDatabase } from "./database.ts";

export function startLivePipeline(icp: SavedICP): number {
  const tavilyApiKey = requiredKey("TAVILY_API_KEY");
  const apolloApiKey = requiredKey("APOLLO_API_KEY");
  const geminiApiKey = requiredKey("GOOGLE_GENERATIVE_AI_API_KEY");
  const database = getDatabase();

  const execution = startPipeline(
    database,
    {
      icp: icp.snapshot.text,
      icpId: icp.id,
      icpName: icp.name,
      icpSnapshot: icp.snapshot,
    },
    {
      findEvents: (value) => findEvents(tavilyApiKey, value),
      findCompanies,
      enrichCompany: (companyUrl) => enrichCompany(apolloApiKey, companyUrl),
      qualifyCompany: (input) => qualifyCompany(geminiApiKey, input),
    },
  );

  void execution.completion.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Pipeline run ${execution.runId} failed: ${message}`);
  });

  return execution.runId;
}

function requiredKey(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before starting a live run.`);
  return value;
}
