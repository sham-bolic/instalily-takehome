import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { type ICPSnapshot } from "./icp-builder.ts";

export const DEFAULT_DATABASE_PATH =
  "backend/prototypes/results/pipeline.sqlite";

export type RunMode = "pipeline" | "probe" | "demo";
export type RunStatus = "running" | "completed" | "failed";
export type ArtifactStatus = "completed" | "failed";

type JsonValue = unknown;

export type Run = {
  id: number;
  mode: RunMode;
  label: string | null;
  rootInput: JsonValue;
  status: RunStatus;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type StageArtifact = {
  id: number;
  runId: number;
  stage: string;
  companyDomain: string | null;
  status: ArtifactStatus;
  input: JsonValue;
  output: JsonValue | null;
  error: string | null;
  provider: string | null;
  startedAt: string;
  finishedAt: string;
};

export type CompanyProfile = {
  id: number;
  runId: number;
  domain: string;
  companyUrl: string;
  profile: JsonValue;
  updatedAt: string;
};

export type SavedICP = {
  id: number;
  name: string;
  snapshot: ICPSnapshot;
  createdAt: string;
  updatedAt: string;
};

type StageArtifactInput = {
  runId: number;
  stage: string;
  companyDomain?: string;
  input: JsonValue;
  provider?: string;
  startedAt?: string;
  finishedAt?: string;
} & (
  | { status: "completed"; output: JsonValue; error?: never }
  | { status: "failed"; output?: JsonValue; error: string }
);

function json(value: JsonValue): string {
  return JSON.stringify(value);
}

function parse(value: string | null): JsonValue | null {
  return value === null ? null : (JSON.parse(value) as JsonValue);
}

export class PipelineDatabase {
  readonly #database: DatabaseSync;

  constructor(
    path = process.env.PIPELINE_DATABASE_PATH ?? DEFAULT_DATABASE_PATH,
  ) {
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.#database = new DatabaseSync(path);
    this.#database.exec("PRAGMA foreign_keys = ON");
    this.#database.exec("PRAGMA journal_mode = WAL");
    this.#initializeSchema();
  }

  close(): void {
    this.#database.close();
  }

  createRun({
    mode,
    label = null,
    rootInput = {},
  }: {
    mode: RunMode;
    label?: string | null;
    rootInput?: JsonValue;
  }): number {
    const startedAt = new Date().toISOString();
    return Number(
      this.#database
        .prepare(
          `
          INSERT INTO runs (mode, label, root_input_json, status, started_at)
          VALUES (?, ?, ?, 'running', ?)
          RETURNING id
        `,
        )
        .get(mode, label, json(rootInput), startedAt)?.id,
    );
  }

  completeRun(id: number): void {
    this.#finishRun(id, "completed", null);
  }

  failRun(id: number, error: string): void {
    this.#finishRun(id, "failed", error);
  }

  getRun(id: number): Run | null {
    const row = this.#database
      .prepare("SELECT * FROM runs WHERE id = ?")
      .get(id) as RunRow | undefined;

    return row ? toRun(row) : null;
  }

  listRuns(): Run[] {
    return (
      this.#database.prepare("SELECT * FROM runs ORDER BY id").all() as RunRow[]
    ).map(toRun);
  }

  createICP({ name, snapshot }: { name: string; snapshot: ICPSnapshot }): number {
    const cleanName = name.trim();
    if (!cleanName) throw new Error("Enter an ICP name.");

    const now = new Date().toISOString();
    return Number(
      this.#database
        .prepare(
          `
          INSERT INTO icps (name, snapshot_json, created_at, updated_at)
          VALUES (?, ?, ?, ?)
          RETURNING id
        `,
        )
        .get(cleanName, json(snapshot), now, now)?.id,
    );
  }

  getICP(id: number): SavedICP | null {
    const row = this.#database
      .prepare("SELECT * FROM icps WHERE id = ?")
      .get(id) as ICPRow | undefined;
    return row ? toSavedICP(row) : null;
  }

  listICPs(): SavedICP[] {
    return (
      this.#database.prepare("SELECT * FROM icps ORDER BY id").all() as ICPRow[]
    ).map(toSavedICP);
  }

  recordStageArtifact(artifact: StageArtifactInput): number {
    const now = new Date().toISOString();
    return Number(
      this.#database
        .prepare(
          `
          INSERT INTO stage_artifacts (
            run_id, stage, company_domain, status, input_json, output_json,
            error, provider, started_at, finished_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id
        `,
        )
        .get(
          artifact.runId,
          artifact.stage,
          artifact.companyDomain ?? null,
          artifact.status,
          json(artifact.input),
          artifact.output === undefined ? null : json(artifact.output),
          artifact.error ?? null,
          artifact.provider ?? null,
          artifact.startedAt ?? now,
          artifact.finishedAt ?? now,
        )?.id,
    );
  }

  listStageArtifacts(runId: number): StageArtifact[] {
    return (
      this.#database
        .prepare("SELECT * FROM stage_artifacts WHERE run_id = ? ORDER BY id")
        .all(runId) as StageArtifactRow[]
    ).map(toStageArtifact);
  }

  findLatestCompletedStageArtifact({
    stage,
    companyDomain,
  }: {
    stage: string;
    companyDomain: string;
  }): StageArtifact | null {
    const row = this.#database
      .prepare(
        `
        SELECT stage_artifacts.*
        FROM stage_artifacts
        JOIN runs ON runs.id = stage_artifacts.run_id
        WHERE stage_artifacts.stage = ?
          AND stage_artifacts.company_domain = ?
          AND stage_artifacts.status = 'completed'
          AND runs.status = 'completed'
        ORDER BY stage_artifacts.id DESC
        LIMIT 1
      `,
      )
      .get(stage, companyDomain) as StageArtifactRow | undefined;

    return row ? toStageArtifact(row) : null;
  }

  upsertCompanyProfile({
    runId,
    domain,
    companyUrl,
    profile,
  }: {
    runId: number;
    domain: string;
    companyUrl: string;
    profile: JsonValue;
  }): number {
    const updatedAt = new Date().toISOString();
    return Number(
      this.#database
        .prepare(
          `
          INSERT INTO company_profiles (
            run_id, domain, company_url, profile_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (run_id, domain) DO UPDATE SET
            company_url = excluded.company_url,
            profile_json = excluded.profile_json,
            updated_at = excluded.updated_at
          RETURNING id
        `,
        )
        .get(runId, domain, companyUrl, json(profile), updatedAt)?.id,
    );
  }

  getCompanyProfile(runId: number, domain: string): CompanyProfile | null {
    const row = this.#database
      .prepare("SELECT * FROM company_profiles WHERE run_id = ? AND domain = ?")
      .get(runId, domain) as CompanyProfileRow | undefined;

    return row ? toCompanyProfile(row) : null;
  }

  listCompanyProfiles(runId: number): CompanyProfile[] {
    return (
      this.#database
        .prepare("SELECT * FROM company_profiles WHERE run_id = ? ORDER BY domain")
        .all(runId) as CompanyProfileRow[]
    ).map(toCompanyProfile);
  }

  #finishRun(
    id: number,
    status: Exclude<RunStatus, "running">,
    error: string | null,
  ): void {
    const result = this.#database
      .prepare(
        `
        UPDATE runs
        SET status = ?, error = ?, finished_at = ?
        WHERE id = ? AND status = 'running'
      `,
      )
      .run(status, error, new Date().toISOString(), id);

    if (result.changes !== 1) {
      throw new Error(`Running pipeline run ${id} was not found.`);
    }
  }

  #initializeSchema(): void {
    this.#database.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id INTEGER PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('pipeline', 'probe', 'demo')),
        label TEXT,
        root_input_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
        error TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT
      );

      CREATE TABLE IF NOT EXISTS active_icp (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        snapshot_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS icps (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO icps (name, snapshot_json, created_at, updated_at)
      SELECT 'Imported ICP', snapshot_json, updated_at, updated_at
      FROM active_icp
      WHERE NOT EXISTS (SELECT 1 FROM icps);

      CREATE TABLE IF NOT EXISTS stage_artifacts (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        company_domain TEXT,
        status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
        input_json TEXT NOT NULL,
        output_json TEXT,
        error TEXT,
        provider TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS company_profiles (
        id INTEGER PRIMARY KEY,
        run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        domain TEXT NOT NULL,
        company_url TEXT NOT NULL,
        profile_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (run_id, domain)
      );

      CREATE INDEX IF NOT EXISTS stage_artifacts_run_id
        ON stage_artifacts(run_id);
    `);
  }
}

type ICPRow = {
  id: number;
  name: string;
  snapshot_json: string;
  created_at: string;
  updated_at: string;
};

type RunRow = {
  id: number;
  mode: RunMode;
  label: string | null;
  root_input_json: string;
  status: RunStatus;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

type StageArtifactRow = {
  id: number;
  run_id: number;
  stage: string;
  company_domain: string | null;
  status: ArtifactStatus;
  input_json: string;
  output_json: string | null;
  error: string | null;
  provider: string | null;
  started_at: string;
  finished_at: string;
};

type CompanyProfileRow = {
  id: number;
  run_id: number;
  domain: string;
  company_url: string;
  profile_json: string;
  updated_at: string;
};

function toSavedICP(row: ICPRow): SavedICP {
  return {
    id: row.id,
    name: row.name,
    snapshot: parse(row.snapshot_json) as ICPSnapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: RunRow): Run {
  return {
    id: row.id,
    mode: row.mode,
    label: row.label,
    rootInput: parse(row.root_input_json),
    status: row.status,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toStageArtifact(row: StageArtifactRow): StageArtifact {
  return {
    id: row.id,
    runId: row.run_id,
    stage: row.stage,
    companyDomain: row.company_domain,
    status: row.status,
    input: parse(row.input_json),
    output: parse(row.output_json),
    error: row.error,
    provider: row.provider,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

function toCompanyProfile(row: CompanyProfileRow): CompanyProfile {
  return {
    id: row.id,
    runId: row.run_id,
    domain: row.domain,
    companyUrl: row.company_url,
    profile: parse(row.profile_json),
    updatedAt: row.updated_at,
  };
}
