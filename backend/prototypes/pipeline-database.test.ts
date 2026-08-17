import assert from "node:assert/strict";
import { test } from "node:test";

import { PipelineDatabase } from "./pipeline-database.ts";

test("records an independently executed stage as a probe run", () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const runId = database.createRun({
      mode: "probe",
      label: "Test event sourcing",
      rootInput: { icp: "durable graphics manufacturers" },
    });

    database.recordStageArtifact({
      runId,
      stage: "event_sourcing",
      status: "completed",
      input: { icp: "durable graphics manufacturers" },
      output: { events: [{ name: "ISA Sign Expo" }] },
      provider: "tavily",
    });
    database.completeRun(runId);

    const run = database.getRun(runId);
    assert.ok(run);
    assert.match(run.startedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(run.finishedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(
      { ...run, startedAt: "timestamp", finishedAt: "timestamp" },
      {
        id: runId,
        mode: "probe",
        label: "Test event sourcing",
        rootInput: { icp: "durable graphics manufacturers" },
        status: "completed",
        error: null,
        startedAt: "timestamp",
        finishedAt: "timestamp",
      },
    );

    const [artifact] = database.listStageArtifacts(runId);
    assert.deepEqual(
      { ...artifact, startedAt: "timestamp", finishedAt: "timestamp" },
      {
        id: 1,
        runId,
        stage: "event_sourcing",
        companyDomain: null,
        status: "completed",
        input: { icp: "durable graphics manufacturers" },
        output: { events: [{ name: "ISA Sign Expo" }] },
        error: null,
        provider: "tavily",
        startedAt: "timestamp",
        finishedAt: "timestamp",
      },
    );
  } finally {
    database.close();
  }
});

test("preserves flexible provider output while updating the assembled profile", () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const runId = database.createRun({ mode: "pipeline" });
    const providerOutput = {
      organization: { name: "Example", fields_that_may_change: [1, "two"] },
      unexpected_top_level_field: true,
    };

    database.recordStageArtifact({
      runId,
      stage: "company_enrichment",
      companyDomain: "example.com",
      status: "completed",
      input: { domain: "example.com" },
      output: providerOutput,
      provider: "apollo",
    });
    database.upsertCompanyProfile({
      runId,
      domain: "example.com",
      companyUrl: "https://example.com/",
      profile: { name: "Example" },
    });
    database.upsertCompanyProfile({
      runId,
      domain: "example.com",
      companyUrl: "https://example.com/",
      profile: { name: "Example", employeeCount: null },
    });

    assert.deepEqual(
      database.listStageArtifacts(runId)[0]?.output,
      providerOutput,
    );
    const profile = database.getCompanyProfile(runId, "example.com");
    assert.deepEqual(
      { ...profile, updatedAt: "timestamp" },
      {
        id: 1,
        runId,
        domain: "example.com",
        companyUrl: "https://example.com/",
        profile: { name: "Example", employeeCount: null },
        updatedAt: "timestamp",
      },
    );
  } finally {
    database.close();
  }
});

test("finds the latest completed artifact for a company", () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const firstRunId = database.createRun({ mode: "probe" });
    database.recordStageArtifact({
      runId: firstRunId,
      stage: "company_enrichment",
      companyDomain: "example.com",
      status: "completed",
      input: { domain: "example.com" },
      output: { version: 1 },
      provider: "apollo",
    });
    database.completeRun(firstRunId);

    const secondRunId = database.createRun({ mode: "probe" });
    database.recordStageArtifact({
      runId: secondRunId,
      stage: "company_enrichment",
      companyDomain: "example.com",
      status: "completed",
      input: { domain: "example.com" },
      output: { version: 2, optional: [null, "value"] },
      provider: "apollo",
    });
    database.completeRun(secondRunId);

    assert.deepEqual(
      database.findLatestCompletedStageArtifact({
        stage: "company_enrichment",
        companyDomain: "example.com",
      })?.output,
      { version: 2, optional: [null, "value"] },
    );
    assert.equal(
      database.findLatestCompletedStageArtifact({
        stage: "company_enrichment",
        companyDomain: "missing.example",
      }),
      null,
    );
  } finally {
    database.close();
  }
});

test("keeps failed stages inspectable", () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const runId = database.createRun({ mode: "probe" });
    database.recordStageArtifact({
      runId,
      stage: "company_enrichment",
      status: "failed",
      input: { domain: "missing.example" },
      error: "Apollo returned 404",
      provider: "apollo",
    });
    database.failRun(runId, "Company enrichment failed");

    assert.equal(database.getRun(runId)?.status, "failed");
    const [artifact] = database.listStageArtifacts(runId);
    assert.deepEqual(
      { ...artifact, startedAt: "timestamp", finishedAt: "timestamp" },
      {
        id: 1,
        runId,
        stage: "company_enrichment",
        companyDomain: null,
        status: "failed",
        input: { domain: "missing.example" },
        output: null,
        error: "Apollo returned 404",
        provider: "apollo",
        startedAt: "timestamp",
        finishedAt: "timestamp",
      },
    );
  } finally {
    database.close();
  }
});
