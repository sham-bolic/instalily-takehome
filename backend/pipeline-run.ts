import {
  PipelineDatabase,
  type CompanyProfile,
  type StageArtifact,
} from "./pipeline-database.ts";

type Stage = {
  name: string;
  input: unknown;
  provider?: string;
  companyDomain?: string;
};

export class PipelineRun {
  readonly id: number;
  readonly #database: PipelineDatabase;

  constructor(
    database: PipelineDatabase,
    input: { label: string; rootInput: unknown },
  ) {
    this.#database = database;
    this.id = database.createRun({
      mode: "pipeline",
      label: input.label,
      rootInput: input.rootInput,
    });
  }

  async stage<Output>(stage: Stage, execute: () => Promise<Output>): Promise<Output> {
    const startedAt = new Date().toISOString();
    try {
      const output = await execute();
      this.#record(stage, { status: "completed", output, startedAt });
      return output;
    } catch (error) {
      this.#record(stage, {
        status: "failed",
        error: errorMessage(error),
        startedAt,
      });
      throw error;
    }
  }

  completed(stage: Stage, output: unknown): void {
    this.#record(stage, { status: "completed", output });
  }

  cachedEnrichment(domain: string): StageArtifact | null {
    return this.#database.findLatestCompletedStageArtifact({
      stage: "company_enrichment",
      companyDomain: domain,
    });
  }

  profiles(): CompanyProfile[] {
    return this.#database.listCompanyProfiles(this.id);
  }

  saveProfile(input: {
    domain: string;
    companyUrl: string;
    profile: unknown;
  }): void {
    this.#database.upsertCompanyProfile({ runId: this.id, ...input });
  }

  complete(): void {
    this.#database.completeRun(this.id);
  }

  fail(error: unknown): void {
    this.#database.failRun(this.id, errorMessage(error));
  }

  #record(
    stage: Stage,
    result:
      | { status: "completed"; output: unknown; startedAt?: string }
      | { status: "failed"; error: string; startedAt?: string },
  ): void {
    this.#database.recordStageArtifact({
      runId: this.id,
      stage: stage.name,
      companyDomain: stage.companyDomain,
      input: stage.input,
      provider: stage.provider,
      ...result,
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
