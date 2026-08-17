import assert from "node:assert/strict";
import { test } from "node:test";

import { PipelineDatabase } from "./pipeline-database.ts";
import { runStageProbe } from "./stage-probe.ts";

test("persists a successful standalone stage execution", async () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const result = await runStageProbe(database, {
      stage: "event_sourcing",
      label: "Event sourcing",
      input: { icp: "graphics manufacturers" },
      provider: "tavily",
      execute: async () => ({ events: [{ name: "Sign Expo" }] }),
    });

    assert.deepEqual(result.output, { events: [{ name: "Sign Expo" }] });
    assert.equal(database.getRun(result.runId)?.status, "completed");
    assert.deepEqual(database.listStageArtifacts(result.runId)[0]?.output, {
      events: [{ name: "Sign Expo" }],
    });
  } finally {
    database.close();
  }
});

test("persists a failed standalone stage execution", async () => {
  const database = new PipelineDatabase(":memory:");

  try {
    await assert.rejects(
      runStageProbe(database, {
        stage: "company_sourcing",
        label: "Company sourcing",
        input: { directoryUrl: "https://example.com/exhibitors" },
        execute: async () => {
          throw new Error("Directory returned 503");
        },
      }),
      /Directory returned 503/,
    );

    const [run] = database.listRuns();
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "Directory returned 503");
    assert.equal(
      database.listStageArtifacts(run?.id ?? 0)[0]?.error,
      "Directory returned 503",
    );
  } finally {
    database.close();
  }
});
