import assert from "node:assert/strict";
import { test } from "node:test";

import { findCompanies } from "./company-sourcing.ts";
import {
  type CompanyQualification,
  type QualificationInput,
} from "./company-qualification.ts";
import { findEvents } from "./event-sourcing.ts";
import { PipelineDatabase } from "./pipeline-database.ts";
import {
  runPipeline,
  startPipelineForEvent,
  startResumedPipeline,
} from "./pipeline.ts";

type Discovery = Awaited<ReturnType<typeof findEvents>>;
type Sourcing = Awaited<ReturnType<typeof findCompanies>>;

function discovery(events: Discovery["events"]): Discovery {
  return {
    searched_at: "2026-08-17T00:00:00.000Z",
    icp: "durable graphics",
    queries: ["test query"],
    request_ids: ["test-request"],
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

function research(input: {
  name: string;
  event: string;
  knownWebsite: string | null;
}) {
  const companyUrl =
    input.knownWebsite ??
    `https://${input.name.toLowerCase().replaceAll(" ", "-")}.example`;
  return {
    researched_at: "2026-08-17T00:00:00.000Z",
    query: `\"${input.name}\" company information`,
    request_id: `research-${input.name}`,
    company_url: companyUrl,
    identity_confidence: "high" as const,
    summary: `${input.name} general company information.`,
    sources: [],
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

test("researches every sourced company before Apollo and isolates provider failures", async () => {
  const database = new PipelineDatabase(":memory:");
  const sourceAttempts: string[] = [];
  const researchAttempts: Array<{
    name: string;
    event: string;
    knownWebsite: string | null;
  }> = [];
  const enrichmentAttempts: Array<{ name?: string; website?: string | null }> = [];
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
        researchCompany: async (input) => {
          researchAttempts.push(input);
          return research(input);
        },
        enrichCompany: async (input) => {
          enrichmentAttempts.push(input);
          if (input.name === "Company 2") {
            throw new Error("Apollo returned 503");
          }
          const companyUrl =
            input.website ??
            `https://${(input.name ?? "unknown").toLowerCase().replaceAll(" ", "-")}.example`;
          return {
            ...enrichment(companyUrl),
            provider_response: {
              organization:
                input.name === "Company 4"
                  ? null
                  : { name: input.name, website_url: companyUrl },
            },
          };
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
    assert.equal(researchAttempts.length, 8);
    assert.equal(enrichmentAttempts.length, 8);
    assert.deepEqual(enrichmentAttempts[0], {
      name: "Missing URL",
      website: "https://missing-url.example",
    });
    assert.deepEqual(result, {
      runId: result.runId,
      selectedEvent: "Working event",
      discoveredCompanies: 8,
      enrichedCompanies: 8,
      qualifiedCompanies: 7,
      skippedCompanies: 0,
      failedEnrichments: 0,
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
        ...["company-2", "company-4", "company-6", "company-7", "missing-url"].map(
          (domain, index) => ({
            rank: index + 3,
            domain: `${domain}.example`,
            companyName:
              domain === "missing-url"
                ? "Missing URL"
                : `Company ${domain.replace("company-", "")}`,
            fit: "medium" as const,
            confidence: "low" as const,
          }),
        ),
      ],
    });
    assert.equal(database.getRun(result.runId)?.status, "completed");
    assert.equal(database.listCompanyProfiles(result.runId).length, 8);

    const artifacts = database.listStageArtifacts(result.runId);
    assert.equal(
      artifacts.find(
        (artifact) =>
          artifact.stage === "company_sourcing" && artifact.status === "failed",
      )?.error,
      "Directory returned 503",
    );
    const companyFourOutput = artifacts.find((artifact) => {
      const input = artifact.input as { company?: { name?: string } };
      return (
        artifact.stage === "company_enrichment" &&
        input.company?.name === "Company 4"
      );
    })?.output as { status?: string; apollo?: { status?: string } } | undefined;
    assert.equal(companyFourOutput?.status, "enriched");
    assert.equal(companyFourOutput?.apollo?.status, "no_match");
    assert.equal(
      artifacts.find(
        (artifact) =>
          artifact.stage === "apollo_enrichment" &&
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

test("uses name-only Apollo lookup when Tavily cannot verify a website", async () => {
  const database = new PipelineDatabase(":memory:");
  const enrichmentAttempts: Array<{ name?: string; website?: string | null }> = [];

  try {
    const result = await runPipeline(
      database,
      { icp: "position sensors" },
      {
        findEvents: async () =>
          discovery([
            event("Sensor Expo", 0.9, "https://events.example/sensors"),
          ]),
        findCompanies: async (eventName) =>
          sourcing(eventName, [
            company("Everight Position", "https://asp.events/client"),
          ]),
        researchCompany: async (input) => ({
          ...research(input),
          company_url: null,
          identity_confidence: "unresolved",
        }),
        enrichCompany: async (input) => {
          enrichmentAttempts.push(input);
          return {
            ...enrichment("https://sensorguys.com/"),
            provider_response: {
              organization: {
                name: "Everight Position",
                website_url: "https://sensorguys.com/",
              },
            },
          };
        },
        qualifyCompany: qualifier(),
      },
    );

    assert.deepEqual(enrichmentAttempts, [
      { name: "Everight Position", website: null },
    ]);
    assert.equal(result.enrichedCompanies, 1);
    assert.equal(
      database.listCompanyProfiles(result.runId)[0]?.companyUrl,
      "https://sensorguys.com/",
    );
  } finally {
    database.close();
  }
});

test("accepts a shortened Apollo name when its domain confirms Tavily's website", async () => {
  const database = new PipelineDatabase(":memory:");

  try {
    const result = await runPipeline(
      database,
      { icp: "defense technology" },
      {
        findEvents: async () =>
          discovery([
            event("Defense Expo", 0.9, "https://events.example/defense"),
          ]),
        findCompanies: async (eventName) =>
          sourcing(eventName, [company("Vannevar Labs", null)]),
        researchCompany: async (input) => ({
          ...research(input),
          company_url: "https://vannevarlabs.com/",
        }),
        enrichCompany: async (input) => ({
          ...enrichment(input.website ?? "https://vannevarlabs.com/"),
          provider_response: {
            organization: {
              name: "Vannevar",
              primary_domain: "vannevarlabs.com",
            },
          },
        }),
        qualifyCompany: qualifier(),
      },
    );

    assert.equal(result.enrichedCompanies, 1);
    assert.equal(result.skippedCompanies, 0);
    assert.equal(
      database.listCompanyProfiles(result.runId)[0]?.companyUrl,
      "https://vannevarlabs.com/",
    );
  } finally {
    database.close();
  }
});

test("rejects an Apollo organization whose name conflicts with the candidate", async () => {
  const database = new PipelineDatabase(":memory:");
  let qualificationCalls = 0;

  try {
    const result = await runPipeline(
      database,
      { icp: "defense technology" },
      {
        findEvents: async () =>
          discovery([
            event("Defense Expo", 0.9, "https://events.example/defense"),
          ]),
        findCompanies: async (eventName) =>
          sourcing(eventName, [
            company("Vannevar Labs", "https://asp.events/client"),
          ]),
        researchCompany: async (input) => ({
          ...research(input),
          company_url: "https://vannevarlabs.com/",
        }),
        enrichCompany: async (input) => ({
          ...enrichment(input.website ?? "https://vannevarlabs.com/"),
          provider_response: {
            organization: {
              name: "ASP Events",
              website_url: "https://asp.events/client",
            },
          },
        }),
        qualifyCompany: qualifier(async () => {
          qualificationCalls += 1;
          return qualification();
        }),
      },
    );

    assert.equal(result.enrichedCompanies, 0);
    assert.equal(result.skippedCompanies, 1);
    assert.equal(qualificationCalls, 0);
    assert.deepEqual(database.listCompanyProfiles(result.runId), []);
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
        researchCompany: async (input) => research(input),
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
        company_url: "https://cached.example/",
        research: research({
          name: "Cached Company",
          event: "Cached event",
          knownWebsite: "https://cached.example",
        }),
        enrichment: enrichment("https://cached.example"),
        provider_outcomes: { apollo: "success" },
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
              event("Low score", 0.49, "https://events.example/low"),
            ]),
          findCompanies: async () => sourcing("unused", []),
          researchCompany: async (input) => research(input),
          enrichCompany: async (company) =>
            enrichment(company.website ?? "https://resolved.example"),
          qualifyCompany: qualifier(),
        },
      ),
      /0.5 relevance threshold/,
    );

    const [run] = database.listRuns();
    assert.equal(run?.status, "failed");
    assert.match(run?.error ?? "", /0.5 relevance threshold/);
  } finally {
    database.close();
  }
});

test("runs the pipeline for the event explicitly selected by the user", async () => {
  const database = new PipelineDatabase(":memory:");
  const sourceRunId = database.createRun({
    mode: "pipeline",
    label: "Original run",
    rootInput: {
      icp: "durable graphics",
      icp_id: 12,
      icp_name: "Durable graphics",
      event_threshold: 0.5,
      enrichment_limit: 5,
    },
  });
  const sourceDiscovery = discovery([
    event("Automatic choice", 0.95, "https://events.example/automatic"),
    event("User choice", 0.3, "https://events.example/selected"),
  ]);
  const sourceArtifactId = database.recordStageArtifact({
    runId: sourceRunId,
    stage: "event_sourcing",
    status: "completed",
    input: { icp: "durable graphics", threshold: 0.5 },
    output: sourceDiscovery,
    provider: "tavily",
  });
  database.completeRun(sourceRunId);
  const sourceAttempts: string[] = [];

  try {
    const execution = startPipelineForEvent(
      database,
      sourceRunId,
      "User choice",
      {
        findEvents: async () => discovery([]),
        findCompanies: async (eventName) => {
          sourceAttempts.push(eventName);
          return sourcing(eventName, [
            company("Selected Company", "https://selected.example"),
          ]);
        },
        researchCompany: async (input) => research(input),
        enrichCompany: async (input) =>
          enrichment(input.website ?? "https://resolved.example"),
        qualifyCompany: qualifier(),
      },
    );
    const result = await execution.completion;

    assert.deepEqual(sourceAttempts, ["User choice"]);
    assert.equal(result.selectedEvent, "User choice");
    assert.deepEqual(database.getRun(execution.runId)?.rootInput, {
      icp: "durable graphics",
      icp_id: 12,
      icp_name: "Durable graphics",
      event_threshold: 0.5,
      enrichment_limit: 5,
      selected_event: "User choice",
      continued_from_run_id: sourceRunId,
    });
    const [reusedDiscovery] = database.listStageArtifacts(execution.runId);
    assert.equal(reusedDiscovery?.stage, "event_sourcing");
    assert.equal(reusedDiscovery?.provider, "sqlite");
    assert.deepEqual(reusedDiscovery?.input, {
      icp: "durable graphics",
      threshold: 0.5,
      selected_event: "User choice",
      continued_from: {
        run_id: sourceRunId,
        artifact_id: sourceArtifactId,
      },
    });
    assert.deepEqual(reusedDiscovery?.output, sourceDiscovery);
  } finally {
    database.close();
  }
});

test("rejects an event that was not selectable in the source run", () => {
  const database = new PipelineDatabase(":memory:");
  const sourceRunId = database.createRun({
    mode: "pipeline",
    rootInput: { icp: "durable graphics" },
  });
  database.recordStageArtifact({
    runId: sourceRunId,
    stage: "event_sourcing",
    status: "completed",
    input: { icp: "durable graphics" },
    output: discovery([event("No directory", 0.9, null)]),
  });
  database.completeRun(sourceRunId);

  try {
    assert.throws(
      () =>
        startPipelineForEvent(
          database,
          sourceRunId,
          "No directory",
          pipelineDependencies(),
        ),
      /does not have a company directory/,
    );
    assert.equal(database.listRuns().length, 1);
  } finally {
    database.close();
  }
});

test("resumes a failed run from its completed event discovery artifact", async () => {
  const database = new PipelineDatabase(":memory:");
  const sourceRunId = database.createRun({
    mode: "pipeline",
    label: "Original run",
    rootInput: {
      icp: "durable graphics",
      icp_id: 12,
      icp_name: "Durable graphics",
      event_threshold: 0.7,
      enrichment_limit: 5,
    },
  });
  const sourceDiscovery = discovery([
    event("Resumed event", 0.6, "https://events.example/resumed"),
  ]);
  const sourceArtifactId = database.recordStageArtifact({
    runId: sourceRunId,
    stage: "event_sourcing",
    status: "completed",
    input: { icp: "durable graphics", threshold: 0.7 },
    output: sourceDiscovery,
    provider: "tavily",
  });
  database.failRun(sourceRunId, "No qualifying event had a usable company directory.");
  let discoveryCalls = 0;

  try {
    const execution = startResumedPipeline(database, sourceRunId, {
      findEvents: async () => {
        discoveryCalls += 1;
        return discovery([]);
      },
      findCompanies: async (eventName) =>
        sourcing(eventName, [company("Resumed Company", "https://resumed.example")]),
      researchCompany: async (input) => research(input),
      enrichCompany: async (company) =>
        enrichment(company.website ?? "https://resolved.example"),
      qualifyCompany: qualifier(),
    });
    const result = await execution.completion;

    assert.equal(discoveryCalls, 0);
    assert.equal(result.selectedEvent, "Resumed event");
    assert.equal(database.getRun(execution.runId)?.status, "completed");
    assert.deepEqual(database.getRun(execution.runId)?.rootInput, {
      icp: "durable graphics",
      icp_id: 12,
      icp_name: "Durable graphics",
      event_threshold: 0.5,
      enrichment_limit: 5,
      resumed_from_run_id: sourceRunId,
    });
    const [resumedDiscovery] = database.listStageArtifacts(execution.runId);
    assert.equal(resumedDiscovery?.stage, "event_sourcing");
    assert.equal(resumedDiscovery?.provider, "sqlite");
    assert.deepEqual(resumedDiscovery?.input, {
      icp: "durable graphics",
      threshold: 0.5,
      resumed_from: {
        run_id: sourceRunId,
        artifact_id: sourceArtifactId,
      },
    });
    assert.deepEqual(resumedDiscovery?.output, sourceDiscovery);
  } finally {
    database.close();
  }
});

test("rejects resuming a run without reusable event discovery", () => {
  const database = new PipelineDatabase(":memory:");
  try {
    const completedRunId = database.createRun({
      mode: "pipeline",
      rootInput: { icp: "durable graphics" },
    });
    database.completeRun(completedRunId);
    assert.throws(
      () => startResumedPipeline(database, completedRunId, pipelineDependencies()),
      /is not a failed pipeline run/,
    );

    const failedRunId = database.createRun({
      mode: "pipeline",
      rootInput: { icp: "durable graphics" },
    });
    database.failRun(failedRunId, "Discovery failed");
    assert.throws(
      () => startResumedPipeline(database, failedRunId, pipelineDependencies()),
      /does not have a completed event discovery artifact/,
    );
  } finally {
    database.close();
  }
});

function pipelineDependencies() {
  return {
    findEvents: async () => discovery([]),
    findCompanies: async () => sourcing("unused", []),
    researchCompany: async (input: {
      name: string;
      event: string;
      knownWebsite: string | null;
    }) => research(input),
    enrichCompany: async (company: { website?: string | null }) =>
      enrichment(company.website ?? "https://resolved.example"),
    qualifyCompany: qualifier(),
  };
}
