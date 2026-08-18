import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { test } from "node:test";

import { chromium } from "playwright";

import { buildICPSnapshot } from "../backend/icp-builder.ts";
import { PipelineDatabase } from "../backend/pipeline-database.ts";

test("switching ICPs and opening the ICP builder modal", { timeout: 45_000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "instalily-icp-e2e-"));
  const databasePath = join(directory, "pipeline.sqlite");
  const database = new PipelineDatabase(databasePath);
  const graphicsId = createICP(database, "Graphics ICP", "graphics and signage");
  const aerospaceId = createICP(database, "Aerospace ICP", "aircraft cabin interiors");
  const runId = createEventSelectionRun(database, graphicsId);
  const decisionMakerRunId = createDecisionMakerRun(
    database,
    runId,
    graphicsId,
  );
  const outreachRunId = createOutreachRun(
    database,
    decisionMakerRunId,
    graphicsId,
  );
  const fullPipelineRunId = createOutreachRun(
    database,
    decisionMakerRunId,
    graphicsId,
    true,
  );
  const runningRunId = createRunningRun(database, aerospaceId);
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
      assert.equal(await page.title(), "Lead Generation and Outbound");
      assert.equal(
        await page.getByText("Lead Generation and Outbound", { exact: true }).isVisible(),
        true,
      );
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
        await page.getByRole("button", { name: "Find decision-makers" }).isVisible(),
        true,
      );
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

      await page.locator(`a[href="/runs/${runId}?tab=companies#results"]`).click();
      const companyWebsite = page.getByRole("link", { name: "Check website" });
      assert.equal(
        await companyWebsite.getAttribute("href"),
        "https://official-company.example/",
      );

      await page.goto(
        `http://127.0.0.1:${port}/runs/${decisionMakerRunId}`,
      );
      assert.match(
        await page.locator(".runHeading").textContent(),
        new RegExp(`Qualified leads from\\s+run #${runId}`),
      );
      assert.equal(
        await page.getByRole("heading", { name: "Decision-maker search by company" }).isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Generate outreach" }).isVisible(),
        true,
      );
      assert.equal(await page.locator(".decisionMakerGroup").count(), 3);
      const matchedCompany = page.locator(".decisionMakerGroup", { hasText: "Official Company" });
      assert.match(await matchedCompany.locator("summary").textContent(), /1 matching person/);
      assert.equal(await matchedCompany.locator(".companyPersonRow").count(), 1);
      assert.equal(
        await matchedCompany.getByRole("link", { name: "LinkedIn profile ↗" }).getAttribute("href"),
        "https://www.linkedin.com/in/dana-director",
      );
      assert.match(
        await matchedCompany.locator(".companyPersonRow").textContent(),
        /Dana Director.*Director of Product Development/s,
      );
      const emptyCompany = page.locator(".decisionMakerGroup", { hasText: "No Match Company" });
      assert.match(await emptyCompany.locator("summary").textContent(), /0 matches/);
      assert.equal(await emptyCompany.getAttribute("open"), null);
      const failedCompany = page.locator(".decisionMakerGroup", { hasText: "Failed Search Company" });
      assert.match(await failedCompany.locator("summary").textContent(), /API error/);
      await failedCompany.locator("summary").click();
      assert.match(await failedCompany.textContent(), /Surfe unavailable/);

      await page.getByRole("link", { name: /Qualified companies/ }).click();
      assert.equal(
        await page.getByRole("link", { name: "Dana Director ↗" }).getAttribute("href"),
        "https://www.linkedin.com/in/dana-director",
      );

      await page.goto(`http://127.0.0.1:${port}/runs/${outreachRunId}`);
      assert.equal(
        await page.getByRole("heading", { name: "Outreach drafts by company" }).isVisible(),
        true,
      );
      assert.match(
        await page.locator(".runHeading").textContent(),
        new RegExp(`People from\\s+run #${decisionMakerRunId}`),
      );
      const outreach = page.getByRole("region", { name: "Outreach for Dana Director" });
      assert.equal(await outreach.isVisible(), true);
      assert.match(
        await outreach.getByLabel("Editable outreach message for Dana Director").inputValue(),
        /Tedlar Clear Protection film/,
      );
      assert.equal(
        await outreach.getByRole("button", { name: "Copy message" }).isVisible(),
        true,
      );
      assert.match(await outreach.textContent(), /Why this person.*Why this company/s);
      await outreach.getByText("Evidence used", { exact: false }).click();
      assert.equal(
        await outreach.getByRole("link", { name: "Outdoor graphics launch ↗" }).getAttribute("href"),
        "https://official-company.example/outdoor-graphics",
      );

      await page.goto(
        `http://127.0.0.1:${port}/runs/${fullPipelineRunId}?tab=people`,
      );
      assert.equal(
        await page.getByRole("heading", { name: "Outreach drafts by company" }).isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("region", { name: "Outreach for Dana Director" }).isVisible(),
        true,
      );
      assert.equal(
        await page.getByRole("button", { name: "Generate outreach" }).count(),
        0,
      );
      assert.equal(
        await page.getByRole("link", { name: /Events/ }).isVisible(),
        true,
      );

      await page.goto(`http://127.0.0.1:${port}/runs/${runningRunId}`);
      const runProgress = page.getByRole("status", { name: "Pipeline progress" });
      assert.equal(await runProgress.isVisible(), true);
      assert.match(await runProgress.textContent(), /Pipeline is working/);
      assert.match(await page.locator(".stage.active").textContent(), /Source companies/);
      assert.notEqual(
        await page.locator(".runProgressSpinner").evaluate(
          (element) => getComputedStyle(element).animationName,
        ),
        "none",
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

function createDecisionMakerRun(database, sourceRunId, icpId) {
  const runId = database.createRun({
    mode: "pipeline",
    label: "Decision-makers: Event selection fixture",
    rootInput: {
      icp: "durable graphics",
      icp_id: icpId,
      decision_makers_from_run_id: sourceRunId,
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "decision_maker_search",
    companyDomain: "official-company.example",
    status: "completed",
    provider: "surfe",
    input: {
      company_name: "Official Company",
      company_domain: "official-company.example",
    },
    output: { total: 1 },
  });
  database.upsertCompanyProfile({
    runId,
    domain: "official-company.example",
    companyUrl: "https://official-company.example/",
    profile: {
      name: "Official Company",
      event: "Previously used expo",
      qualification: {
        fit: "high",
        confidence: "high",
        rationale: "The company matches the durable graphics ICP.",
        evidence: ["The company manufactures durable graphics."],
      },
      rank: 1,
      decision_makers: [{
        firstName: "Dana",
        lastName: "Director",
        companyName: "Official Company",
        companyDomain: "official-company.example",
        jobTitle: "Director of Product Development",
        seniorities: ["Director"],
        departments: ["Product Development"],
        country: "United States",
        linkedInUrl: "https://www.linkedin.com/in/dana-director",
      }],
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "decision_maker_search",
    companyDomain: "no-match.example",
    status: "completed",
    provider: "surfe",
    input: {
      company_name: "No Match Company",
      company_domain: "no-match.example",
    },
    output: { total: 0 },
  });
  database.upsertCompanyProfile({
    runId,
    domain: "no-match.example",
    companyUrl: "https://no-match.example/",
    profile: {
      name: "No Match Company",
      qualification: { fit: "high", confidence: "high", rationale: "Test", evidence: [] },
      decision_makers: [],
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "decision_maker_search",
    companyDomain: "failed-search.example",
    status: "failed",
    provider: "surfe",
    input: {
      company_name: "Failed Search Company",
      company_domain: "failed-search.example",
    },
    error: "Surfe unavailable",
  });
  database.upsertCompanyProfile({
    runId,
    domain: "failed-search.example",
    companyUrl: "https://failed-search.example/",
    profile: {
      name: "Failed Search Company",
      qualification: { fit: "high", confidence: "high", rationale: "Test", evidence: [] },
    },
  });
  database.completeRun(runId);
  return runId;
}

function createOutreachRun(database, sourceRunId, icpId, embedded = false) {
  const runId = database.createRun({
    mode: "pipeline",
    label: embedded
      ? "Complete pipeline with outreach"
      : "Outreach: Decision-makers fixture",
    rootInput: {
      icp: "durable graphics",
      icp_id: icpId,
      ...(embedded ? {} : { outreach_from_run_id: sourceRunId }),
      outreach_relevance_threshold: 70,
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "outreach_candidate_evaluation",
    companyDomain: "official-company.example",
    status: "completed",
    provider: "google",
    input: { relevance_threshold: 70 },
    output: { assessments: 1 },
  });
  database.recordStageArtifact({
    runId,
    stage: "outreach_research",
    companyDomain: "official-company.example",
    status: "completed",
    provider: "tavily",
    input: { company_domain: "official-company.example" },
    output: { evidence: 1 },
  });
  database.recordStageArtifact({
    runId,
    stage: "outreach_drafting",
    companyDomain: "official-company.example",
    status: "completed",
    provider: "google",
    input: { person_linkedin_url: "https://www.linkedin.com/in/dana-director" },
    output: { confidence: "high" },
  });
  database.upsertCompanyProfile({
    runId,
    domain: "official-company.example",
    companyUrl: "https://official-company.example/",
    profile: {
      name: "Official Company",
      event: "Previously used expo",
      qualification: {
        fit: "high",
        confidence: "high",
        rationale: "The company matches the durable graphics ICP.",
        evidence: ["The company manufactures durable graphics."],
      },
      decision_makers: [{
        firstName: "Dana",
        lastName: "Director",
        companyName: "Official Company",
        companyDomain: "official-company.example",
        jobTitle: "Director of Product Development",
        seniorities: ["Director"],
        departments: ["Product Development"],
        country: "United States",
        linkedInUrl: "https://www.linkedin.com/in/dana-director",
      }],
      outreach_selection: {
        relevance_threshold: 70,
        evaluations: [{
          personLinkedInUrl: "https://www.linkedin.com/in/dana-director",
          relevanceScore: 92,
          confidence: "high",
          rationale: "The product development role is directly relevant to the durable graphics ICP.",
        }],
        selected_person_linkedin_urls: [
          "https://www.linkedin.com/in/dana-director",
        ],
        excluded: [],
      },
      outreach_research: {
        evidence: [{
          id: "company_signal_1",
          title: "Outdoor graphics launch",
          url: "https://official-company.example/outdoor-graphics",
          excerpt: "Official Company develops outdoor graphics films.",
        }],
      },
      outreach_drafts: [{
        personLinkedInUrl: "https://www.linkedin.com/in/dana-director",
        message: "Hi Dana - I saw Official Company's work in outdoor graphics films. Given your product development role, surface durability may be relevant. Tedlar Clear Protection film is designed to protect graphics against harsh UV exposure and fading. Would exploring its fit for the outdoor films your team develops be relevant?",
        whyThisPerson: "Their product development role is relevant to evaluating differentiated graphics materials.",
        whyThisCompany: "The company matches the durable graphics ICP.",
        evidenceIds: ["company_signal_1"],
        productClaimId: "tedlar_uv_fading",
        productClaim: "Tedlar Clear Protection film is designed to protect outdoor graphics against harsh UV exposure and fading.",
        productClaimSourceUrl: "https://www.dupont.com/tedlar/tedlar-signage-applications.html",
        confidence: "high",
        warnings: [],
      }],
    },
  });
  database.completeRun(runId);
  return runId;
}

function createRunningRun(database, icpId) {
  const runId = database.createRun({
    mode: "pipeline",
    label: "Running pipeline fixture",
    rootInput: {
      icp: "aircraft cabin interiors",
      icp_id: icpId,
      icp_name: "Aerospace ICP",
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "event_sourcing",
    status: "completed",
    input: { icp: "aircraft cabin interiors", threshold: 0.5 },
    output: { events: [] },
  });
  return runId;
}

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
      companies: [{
        name: "Official Company",
        booth: "42",
        profile_url: "https://events.example/used/exhibitors/official-company",
        company_url: "https://website-vendor.example/client",
        attendance_evidence: {
          type: "official_exhibitor_directory",
          url: "https://events.example/used/directory",
        },
      }],
    },
  });
  database.recordStageArtifact({
    runId,
    stage: "company_research",
    status: "completed",
    provider: "tavily",
    input: {
      event: "Previously used expo",
      company: {
        name: "Official Company",
        website: "https://website-vendor.example/client",
      },
    },
    output: {
      company_url: "https://official-company.example/",
      identity_confidence: "high",
    },
  });
  database.upsertCompanyProfile({
    runId,
    domain: "official-company.example",
    companyUrl: "https://official-company.example/",
    profile: {
      name: "Official Company",
      event: "Previously used expo",
      qualification: {
        fit: "high",
        confidence: "high",
        rationale: "The company matches the durable graphics ICP.",
        evidence: ["The company manufactures durable graphics."],
      },
      rank: 1,
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
