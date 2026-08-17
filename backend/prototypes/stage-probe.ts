import { PipelineDatabase } from "./pipeline-database.ts";

type StageProbeOptions<Output> = {
  stage: string;
  label: string;
  input: unknown;
  provider?: string;
  companyDomain?: string;
  execute: () => Promise<Output>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runStageProbe<Output>(
  database: PipelineDatabase,
  options: StageProbeOptions<Output>,
): Promise<{ runId: number; output: Output }> {
  const runId = database.createRun({
    mode: "probe",
    label: options.label,
    rootInput: options.input,
  });
  const startedAt = new Date().toISOString();

  try {
    const output = await options.execute();
    database.recordStageArtifact({
      runId,
      stage: options.stage,
      companyDomain: options.companyDomain,
      status: "completed",
      input: options.input,
      output,
      provider: options.provider,
      startedAt,
    });
    database.completeRun(runId);
    return { runId, output };
  } catch (error) {
    const message = errorMessage(error);
    database.recordStageArtifact({
      runId,
      stage: options.stage,
      companyDomain: options.companyDomain,
      status: "failed",
      input: options.input,
      error: message,
      provider: options.provider,
      startedAt,
    });
    database.failRun(runId, message);
    throw error;
  }
}
