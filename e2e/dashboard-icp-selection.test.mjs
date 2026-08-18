import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { chromium } from "playwright";

import { buildICPSnapshot } from "../backend/prototypes/icp-builder.ts";
import { PipelineDatabase } from "../backend/prototypes/pipeline-database.ts";

test("switching ICPs and opening the ICP builder modal", { timeout: 30_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "instalily-icp-e2e-"));
  const databasePath = join(directory, "pipeline.sqlite");
  const database = new PipelineDatabase(databasePath);
  const graphicsId = createICP(database, "Graphics ICP", "graphics and signage");
  const aerospaceId = createICP(database, "Aerospace ICP", "aircraft cabin interiors");
  const runId = createEventSelectionRun(database, graphicsId);
  database.close();

  const port = await availablePort();
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    {
      env: {
        ...process.env,
        NEXT_TELEMETRY_DISABLED: "1",
        PIPELINE_DATABASE_PATH: databasePath,
      },
      stdio: "ignore",
    },
  );

  try {
    await waitForServer(`http://127.0.0.1:${port}/?icp=${graphicsId}`);
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${port}/?icp=${graphicsId}`);
      assert.match(await page.locator(".icpPreview").textContent(), /graphics and signage/);

      await page.locator('select[name="icpId"]').selectOption(String(aerospaceId));
      await page.waitForURL(`**/?icp=${aerospaceId}`, { timeout: 2_000 });

      assert.match(await page.locator(".icpPreview").textContent(), /aircraft cabin interiors/);
      assert.doesNotMatch(await page.locator(".icpPreview").textContent(), /graphics and signage/);

      await page.getByRole("link", { name: "Add ICP" }).click();
      const dialog = page.getByRole("dialog", { name: "Create a reusable target" });
      await dialog.waitFor();
      assert.equal(await dialog.getByRole("heading", { name: "Define the opportunity" }).isVisible(), true);
      assert.equal(await dialog.getByRole("heading", { name: "Sharpen the fit" }).isVisible(), true);
      assert.equal(await dialog.getByText("Profile preview").isVisible(), true);
      assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow), "hidden");

      await page.keyboard.press("Escape");
      await page.waitForURL(`**/`);
      assert.equal(await dialog.count(), 0);

      await page.goto(`http://127.0.0.1:${port}/runs/${runId}?tab=events`);
      assert.equal(
        await page.getByRole("button", { name: "Enrich again" }).isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Enrich companies" }).isVisible(),
        true,
      );
      const eventForms = page.locator('form[action="/api/runs"]:has(input[name="eventRunId"])');
      assert.equal(await eventForms.count(), 2);
      assert.equal(
        await page.getByText("No company directory found", { exact: true }).isVisible(),
        true,
      );
    } finally {
      await browser.close();
    }
  } finally {
    server.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => server.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 1_000)),
    ]);
    if (server.exitCode === null) server.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

function createEventSelectionRun(database, icpId) {
  const runId = database.createRun({
    mode: "pipeline",
    label: "Event selection fixture",
    rootInput: {
      icp: "durable graphics",
      icp_id: icpId,
      event_threshold: 0.5,
      enrichment_limit: 10,
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "event_sourcing",
    status: "completed",
    input: { icp: "durable graphics", threshold: 0.5 },
    output: {
      events: [
        {
          name: "Previously used expo",
          discovery_url: "https://events.example/used",
          summary: "The event selected by the automatic pipeline.",
          relevance_score: 0.9,
          company_source: {
            type: "exhibitor_directory",
            url: "https://events.example/used/directory",
          },
        },
        {
          name: "Alternative expo",
          discovery_url: "https://events.example/alternative",
          summary: "Another event the user can select.",
          relevance_score: 0.4,
          company_source: {
            type: "exhibitor_directory",
            url: "https://events.example/alternative/directory",
          },
        },
        {
          name: "Event without directory",
          discovery_url: "https://events.example/unavailable",
          summary: "This event cannot be selected.",
          relevance_score: 0.8,
          company_source: null,
        },
      ],
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "company_sourcing",
    status: "completed",
    input: {
      event: "Previously used expo",
      directory_url: "https://events.example/used/directory",
    },
    output: {
      event: {
        name: "Previously used expo",
        exhibitor_directory_url: "https://events.example/used/directory",
      },
      companies: [],
    },
  });
  database.completeRun(runId);
  return runId;
}

function createICP(database, name, market) {
  return database.createICP({
    name,
    snapshot: buildICPSnapshot({
      offering: `Protective films for ${market}`,
      targetCompanies: `Manufacturers serving ${market}`,
      applications: `Durable surfaces for ${market}`,
    }),
  });
}

async function availablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(url) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The development server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Dashboard did not start: ${url}`);
}
