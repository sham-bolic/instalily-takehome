import assert from "node:assert/strict";
import { test } from "node:test";

import { createDashboardServer } from "./dashboard.ts";
import { buildICPSnapshot } from "./icp-builder.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import { startPipeline } from "./pipeline.ts";

test("shows an empty database without failing", async () => {
  const database = new PipelineDatabase(":memory:");
  const server = createDashboardServer(database);
  const url = await startServer(server);

  try {
    const response = await fetch(url);
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /No pipeline runs yet/);
    assert.match(html, /Runs<\/span><strong>0/);
    assert.match(html, /No ICPs yet/);
    assert.match(html, /Add New ICP/);
    assert.doesNotMatch(html, /<form method="post" action="\/icps"/);
  } finally {
    await closeServer(server);
    database.close();
  }
});

test("creates a named ICP and makes it available in the run dropdown", async () => {
  const database = new PipelineDatabase(":memory:");
  const server = createDashboardServer(database);
  const url = await startServer(server);

  try {
    const formHtml = await (await fetch(`${url}/?new-icp=1`)).text();
    assert.match(formHtml, /<form method="post" action="\/icps"/);
    assert.match(formHtml, /name="name"/);

    const response = await fetch(`${url}/icps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Graphics and signage",
        offering: "Protective films",
        targetCompanies: "Sign manufacturers",
        applications: "Outdoor graphics",
        strongFitSignals: "Weather exposure",
      }),
      redirect: "manual",
    });

    assert.equal(response.status, 303);
    const location = response.headers.get("location");
    assert.match(location ?? "", /^\/?\?icp=\d+$/);

    const html = await (await fetch(new URL(location ?? "/", url))).text();
    assert.match(html, /<option value="1" selected>Graphics and signage<\/option>/);
    assert.match(html, /Run pipeline/);
    assert.match(html, /Offering: Protective films/);
  } finally {
    await closeServer(server);
    database.close();
  }
});

test("shows missing required ICP fields", async () => {
  const database = new PipelineDatabase(":memory:");
  const server = createDashboardServer(database);
  const url = await startServer(server);

  try {
    const response = await fetch(`${url}/icps`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        name: "Incomplete ICP",
        targetCompanies: "Sign manufacturers",
      }),
    });

    assert.equal(response.status, 400);
    assert.match(await response.text(), /Complete the required fields: offering, applications/);
    assert.match(await (await fetch(`${url}/?new-icp=1`)).text(), /Add an ICP/);
  } finally {
    await closeServer(server);
    database.close();
  }
});

test("runs the complete pipeline with the selected persisted ICP", async () => {
  const database = new PipelineDatabase(":memory:");
  const firstId = database.createICP({
    name: "First ICP",
    snapshot: buildICPSnapshot({
      offering: "First offering",
      targetCompanies: "First companies",
      applications: "First applications",
    }),
  });
  const selectedSnapshot = buildICPSnapshot({
    offering: "Selected offering",
    targetCompanies: "Selected companies",
    applications: "Selected applications",
  });
  const selectedId = database.createICP({ name: "Selected ICP", snapshot: selectedSnapshot });
  let completion: Promise<unknown> | null = null;
  let receivedICP = "";
  const server = createDashboardServer(database, (pipelineDatabase, icp) => {
    receivedICP = icp.snapshot.text;
    const execution = startPipeline(
      pipelineDatabase,
      {
        icp: icp.snapshot.text,
        icpId: icp.id,
        icpName: icp.name,
        icpSnapshot: icp.snapshot,
      },
      {
        findEvents: async (icp) => ({
          searched_at: "2026-08-17T00:00:00.000Z",
          icp,
          query: "fixed test query",
          request_id: "fixed-request",
          events: [{
            name: "Fixed Expo",
            discovery_url: "https://events.example/expo",
            summary: "A fixed event response",
            relevance_score: 0.9,
            company_source: {
              type: "exhibitor_directory",
              url: "https://events.example/directory",
            },
          }],
        }),
        findCompanies: async () => ({
          sourced_at: "2026-08-17T00:00:00.000Z",
          event: {
            name: "Fixed Expo",
            exhibitor_directory_url: "https://events.example/directory",
          },
          companies: [{
            name: "Fixed Graphics",
            booth: "12",
            profile_url: null,
            company_url: "https://fixed.example",
            attendance_evidence: {
              type: "official_exhibitor_directory",
              url: "https://events.example/directory",
            },
          }],
        }),
        enrichCompany: async (companyUrl) => ({
          enriched_at: "2026-08-17T00:00:00.000Z",
          provider: { name: "fixed-apollo" },
          provider_response: { organization: { website_url: companyUrl } },
        }),
        qualifyCompany: async () => ({
          fit: "high",
          confidence: "high",
          rationale: "Fixed qualification response.",
          evidence: ["Fixed evidence."],
        }),
      },
    );
    completion = execution.completion;
    return execution.runId;
  });
  const url = await startServer(server);

  try {
    const response = await fetch(`${url}/runs`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ icpId: String(selectedId) }),
      redirect: "manual",
    });

    assert.equal(response.status, 303);
    assert.notEqual(firstId, selectedId);
    assert.equal(receivedICP, selectedSnapshot.text);
    assert.ok(completion);
    await completion;

    const [run] = database.listRuns();
    assert.ok(run);
    assert.equal(run.status, "completed");
    assert.deepEqual(run.rootInput, {
      icp: selectedSnapshot.text,
      icp_id: selectedId,
      icp_name: "Selected ICP",
      icp_snapshot: selectedSnapshot,
      event_threshold: 0.7,
      enrichment_limit: 5,
    });
    assert.deepEqual(
      database.listStageArtifacts(run.id).map((artifact) => artifact.stage),
      ["event_sourcing", "company_sourcing", "company_enrichment", "company_qualification"],
    );
    assert.equal(database.listCompanyProfiles(run.id).length, 1);
    assert.equal(response.headers.get("location"), `/?run=${run.id}&icp=${selectedId}`);
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
