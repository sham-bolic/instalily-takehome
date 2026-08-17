import assert from "node:assert/strict";
import { test } from "node:test";

import { createDashboardServer } from "./dashboard.ts";
import { PipelineDatabase } from "./pipeline-database.ts";

test("shows an empty database without failing", async () => {
  const database = new PipelineDatabase(":memory:");
  const server = createDashboardServer(database);
  const url = await startServer(server);

  try {
    const response = await fetch(url);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /The database is empty/);
    assert.match(html, /Runs<\/span><strong>0/);
  } finally {
    await closeServer(server);
    database.close();
  }
});

test("renders the selected run, artifacts, failures, and profiles", async () => {
  const database = new PipelineDatabase(":memory:");
  const runId = database.createRun({
    mode: "pipeline",
    label: "Unsafe <label>",
    rootInput: { icp: "durable graphics" },
  });
  database.recordStageArtifact({
    runId,
    stage: "event_sourcing",
    status: "completed",
    input: { icp: "durable graphics" },
    output: { events: [{ name: "ISA Sign Expo" }] },
    provider: "tavily",
  });
  database.recordStageArtifact({
    runId,
    stage: "company_enrichment",
    companyDomain: "example.com",
    status: "failed",
    input: { domain: "example.com" },
    error: "Provider unavailable",
    provider: "apollo",
  });
  database.upsertCompanyProfile({
    runId,
    domain: "example.com",
    companyUrl: "https://example.com",
    profile: { name: "Example Graphics", employeeCount: 120 },
  });
  database.failRun(runId, "Enrichment did not complete");

  const server = createDashboardServer(database);
  const url = await startServer(server);

  try {
    const response = await fetch(`${url}/?run=${runId}`);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /Unsafe &lt;label&gt;/);
    assert.doesNotMatch(html, /Unsafe <label>/);
    assert.match(html, /Event Sourcing/);
    assert.match(html, /Provider unavailable/);
    assert.match(html, /Example Graphics/);
    assert.match(html, /Profiles in view<\/span><strong>1/);
  } finally {
    await closeServer(server);
    database.close();
  }
});

test("rejects an invalid run identifier", async () => {
  const database = new PipelineDatabase(":memory:");
  const server = createDashboardServer(database);
  const url = await startServer(server);

  try {
    const response = await fetch(`${url}/?run=not-a-number`);
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Run ID must be a positive integer/);
  } finally {
    await closeServer(server);
    database.close();
  }
});

function startServer(server: ReturnType<typeof createDashboardServer>): Promise<string> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function closeServer(server: ReturnType<typeof createDashboardServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
