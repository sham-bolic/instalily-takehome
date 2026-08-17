import assert from "node:assert/strict";
import { test } from "node:test";

import { findCompanies } from "./company-sourcing.ts";
import {
  type CompanyQualification,
  type QualificationInput,
} from "./company-qualification.ts";
import { findEvents } from "./event-sourcing.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import { runPipeline } from "./pipeline.ts";

type Discovery = Awaited<ReturnType<typeof findEvents>>;
type Sourcing = Awaited<ReturnType<typeof findCompanies>>;

function discovery(events: Discovery["events"]): Discovery {
  return {
    searched_at: "2026-08-17T00:00:00.000Z",
    icp: "durable graphics",
    query: "test query",
    request_id: "test-request",
    events,
  };
}

function event(
  name: string,
  score: number,
  directoryUrl: string | null,
): Discovery["events"][number] {
  return {
    name,
    discovery_url: `https://events.example/${encodeURIComponent(name)}`,
    summary: `${name} summary`,
    relevance_score: score,
    company_source: directoryUrl
      ? { type: "exhibitor_directory", url: directoryUrl }
      : null,
  };
}

function sourcing(
  eventName: string,
  companies: Sourcing["companies"],
): Sourcing {
  return {
    sourced_at: "2026-08-17T00:00:00.000Z",
    event: {
      name: eventName,
      exhibitor_directory_url: "https://events.example/directory",
    },
    companies,
  };
}

function company(name: string, companyUrl: string | null): Sourcing["companies"][number] {
  return {
    name,
    booth: null,
    profile_url: null,
    company_url: companyUrl,
    attendance_evidence: {
      type: "official_exhibitor_directory",
      url: "https://events.example/directory",
    },
  };
}

function enrichment(companyUrl: string) {
  return {
    enriched_at: "2026-08-17T00:00:00.000Z",
    provider: {
      name: "apollo",
      endpoint: "https://api.apollo.test/enrich",
      request: { domain: new URL(companyUrl).hostname, website: companyUrl },
    },
    provider_response: { organization: { website_url: companyUrl } },
  };
}

function qualification(
  fit: CompanyQualification["fit"] = "high",
  confidence: CompanyQualification["confidence"] = "medium",
): CompanyQualification {
  return {
    fit,
    confidence,
    rationale: "The company fits the supplied ICP.",
    evidence: ["The company makes durable graphics."],
  };
}

function qualifier(
  assess: (input: QualificationInput) => Promise<CompanyQualification> =
    async () => qualification(),
): (input: QualificationInput) => Promise<CompanyQualification> {
  return assess;
}

test("runs the highest-scoring usable event and isolates company failures", async () => {
  const database = new PipelineDatabase(":memory:");
  const sourceAttempts: string[] = [];
  const enrichmentAttempts: string[] = [];
  const companies = [
    company("Missing URL", null),
    ...Array.from({ length: 7 }, (_, index) =>
      company(`Company ${index + 1}`, `https://company-${index + 1}.example`),
    ),
  ];

  try {
    const result = await runPipeline(
      database,
      { icp: "durable graphics" },
      {
        findEvents: async () =>
          discovery([
            event("Below threshold", 0.69, "https://events.example/low"),
            event("No directory", 0.99, null),
            event("Broken directory", 0.95, "https://events.example/broken"),
            event("Working event", 0.9, "https://events.example/working"),
          ]),
        findCompanies: async (eventName) => {
          sourceAttempts.push(eventName);
          if (eventName === "Broken directory") {
            throw new Error("Directory returned 503");
          }
          return sourcing(eventName, companies);
        },
        enrichCompany: async (companyUrl) => {
          enrichmentAttempts.push(companyUrl);
          if (companyUrl.includes("company-2")) {
            throw new Error("Apollo returned 503");
          }
          return enrichment(companyUrl);
        },
        qualifyCompany: qualifier(async ({ company: profile }) => {
          const name = (profile as { name: string }).name;
          if (name === "Company 3") {
            throw new Error("Gemini quota exhausted");
          }
          if (name === "Company 1") {
            return qualification("high", "medium");
          }
          return qualification("medium", name === "Company 5" ? "high" : "low");
        }),
      },
    );

    assert.deepEqual(sourceAttempts, ["Broken directory", "Working event"]);
    assert.equal(enrichmentAttempts.length, 5);
    assert.deepEqual(result, {
      runId: result.runId,
      selectedEvent: "Working event",
      discoveredCompanies: 8,
      enrichedCompanies: 4,
      qualifiedCompanies: 3,
      skippedCompanies: 1,
      failedEnrichments: 1,
      failedQualifications: 1,
      rankedCompanies: [
        {
          rank: 1,
          domain: "company-1.example",
          companyName: "Company 1",
          fit: "high",
          confidence: "medium",
        },
        {
          rank: 2,
          domain: "company-5.example",
          companyName: "Company 5",
          fit: "medium",
          confidence: "high",
        },
        {
          rank: 3,
          domain: "company-4.example",
          companyName: "Company 4",
          fit: "medium",
          confidence: "low",
        },
      ],
    });
    assert.equal(database.getRun(result.runId)?.status, "completed");
    assert.equal(database.listCompanyProfiles(result.runId).length, 4);

    const artifacts = database.listStageArtifacts(result.runId);
    assert.equal(
      artifacts.find(
        (artifact) =>
          artifact.stage === "company_sourcing" && artifact.status === "failed",
      )?.error,
      "Directory returned 503",
    );
    assert.deepEqual(
      artifacts.find(
        (artifact) =>
          artifact.stage === "company_enrichment" &&
          artifact.companyDomain === null &&
          artifact.status === "completed",
      )?.output,
      { status: "skipped", reason: "missing_company_url" },
    );
    assert.equal(
      artifacts.find(
        (artifact) =>
          artifact.companyDomain === "company-2.example" &&
          artifact.status === "failed",
      )?.error,
      "Apollo returned 503",
    );
    assert.equal(
      artifacts.find(
        (artifact) =>
          artifact.stage === "company_qualification" &&
          artifact.companyDomain === "company-3.example" &&
          artifact.status === "failed",
      )?.error,
      "Gemini quota exhausted",
    );
  } finally {
    database.close();
  }
});

test("reuses Apollo data and records where the cached artifact came from", async () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const cachedRunId = database.createRun({ mode: "probe" });
    const cachedArtifactId = database.recordStageArtifact({
      runId: cachedRunId,
      stage: "company_enrichment",
      companyDomain: "cached.example",
      status: "completed",
      input: { domain: "cached.example" },
      output: enrichment("https://cached.example"),
      provider: "apollo",
    });
    database.completeRun(cachedRunId);

    const result = await runPipeline(
      database,
      { icp: "durable graphics" },
      {
        findEvents: async () =>
          discovery([
            event("Cached event", 0.9, "https://events.example/cached"),
          ]),
        findCompanies: async (eventName) =>
          sourcing(eventName, [company("Cached Company", "https://cached.example")]),
        enrichCompany: async () => {
          throw new Error("Apollo should not be called for cached data");
        },
        qualifyCompany: qualifier(),
      },
    );

    assert.equal(result.enrichedCompanies, 1);
    const artifact = database
      .listStageArtifacts(result.runId)
      .find((candidate) => candidate.stage === "company_enrichment");
    assert.deepEqual(
      (artifact?.output as { cache_reference: unknown }).cache_reference,
      {
        source_run_id: cachedRunId,
        source_artifact_id: cachedArtifactId,
      },
    );
    assert.deepEqual(
      database.getCompanyProfile(result.runId, "cached.example")?.profile,
      {
        name: "Cached Company",
        event: "Cached event",
        company_url: "https://cached.example",
        enrichment: enrichment("https://cached.example"),
        cache_reference: {
          source_run_id: cachedRunId,
          source_artifact_id: cachedArtifactId,
        },
        qualification: qualification(),
        rank: 1,
      },
    );
  } finally {
    database.close();
  }
});

test("fails the run when no event meets the threshold", async () => {
  const database = new PipelineDatabase(":memory:");

  try {
    await assert.rejects(
      runPipeline(
        database,
        { icp: "durable graphics" },
        {
          findEvents: async () =>
            discovery([
              event("Low score", 0.69, "https://events.example/low"),
            ]),
          findCompanies: async () => sourcing("unused", []),
          enrichCompany: async (companyUrl) => enrichment(companyUrl),
          qualifyCompany: qualifier(),
        },
      ),
      /0.7 relevance threshold/,
    );

    const [run] = database.listRuns();
    assert.equal(run?.status, "failed");
    assert.match(run?.error ?? "", /0.7 relevance threshold/);
  } finally {
    database.close();
  }
});
