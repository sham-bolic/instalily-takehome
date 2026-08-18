import { PipelineDatabase } from "./pipeline-database.ts";

function parseRunId(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`Run ID must be a positive integer: ${value}`);
  }

  return id;
}

const database = new PipelineDatabase();

try {
  const runId = parseRunId(process.argv[2]);
  if (runId === null) {
    console.table(database.listRuns());
  } else {
    const run = database.getRun(runId);
    if (!run) {
      console.error(`Run ${runId} was not found.`);
      process.exitCode = 1;
    } else {
      console.log(
        JSON.stringify(
          {
            run,
            artifacts: database.listStageArtifacts(runId),
            profiles: database.listCompanyProfiles(runId),
          },
          null,
          2,
        ),
      );
    }
  }
} finally {
  database.close();
}
