import assert from "node:assert/strict";
import { test } from "node:test";

import { startDecisionMakerPipeline } from "../backend/decision-maker-pipeline.ts";
import { PipelineDatabase } from "../backend/pipeline-database.ts";

test("creates a linked run and searches only high-fit profiles", async () => {
  const database = new PipelineDatabase(":memory:");
  const sourceRunId = database.createRun({
    mode: "pipeline",
    label: "Original qualification run",
    rootInput: {
      icp: "Durable graphics manufacturers",
      icp_id: 4,
      icp_name: "Graphics",
    },
  });
  saveProfile(database, sourceRunId, "high.example", "High Fit", "high");
  saveProfile(database, sourceRunId, "medium.example", "Medium Fit", "medium");
  database.completeRun(sourceRunId);
  const searches: Array<{ companyName: string; domain: string }> = [];

  try {
    const execution = startDecisionMakerPipeline(
      database,
      sourceRunId,
      async (input) => {
        searches.push(input);
        return {
          searched_at: "2026-08-18T00:00:00.000Z",
          company: input,
          criteria: {
            titles: ["Product Development"],
            seniorities: ["VP", "Director", "Head"],
          },
          people: [
            {
              firstName: "Dana",
              lastName: "Director",
              companyName: input.companyName,
              companyDomain: input.domain,
              linkedInUrl: "https://www.linkedin.com/in/dana-director",
              jobTitle: "Director of Product Development",
              seniorities: ["Director"],
              departments: ["Product"],
              country: "us",
            },
          ],
          total: 1,
        };
      },
    );
    const result = await execution.completion;

    assert.equal(database.getRun(sourceRunId)?.status, "completed");
    assert.deepEqual(database.listCompanyProfiles(sourceRunId).map(({ domain }) => domain), [
      "high.example",
      "medium.example",
    ]);
    assert.deepEqual(searches, [
      { companyName: "High Fit", domain: "high.example" },
    ]);
    assert.deepEqual(result, {
      runId: execution.runId,
      sourceRunId,
      importedQualifiedLeads: 1,
      searchedQualifiedLeads: 1,
      failedDecisionMakerSearches: 0,
      decisionMakersFound: 1,
    });
    assert.deepEqual(database.getRun(execution.runId)?.rootInput, {
      icp: "Durable graphics manufacturers",
      icp_id: 4,
      icp_name: "Graphics",
      decision_makers_from_run_id: sourceRunId,
    });
    const profiles = database.listCompanyProfiles(execution.runId);
    assert.equal(profiles.length, 1);
    assert.equal(
      ((profiles[0]?.profile as { decision_makers: unknown[] }).decision_makers)
        .length,
      1,
    );
    assert.deepEqual(
      database.listStageArtifacts(execution.runId).map(({ stage, provider }) => ({
        stage,
        provider,
      })),
      [
        { stage: "qualified_lead_import", provider: "sqlite" },
        { stage: "decision_maker_search", provider: "surfe" },
      ],
    );
  } finally {
    database.close();
  }
});

test("rejects a source run without high-fit leads before creating a run", () => {
  const database = new PipelineDatabase(":memory:");
  const sourceRunId = database.createRun({ mode: "pipeline" });
  saveProfile(database, sourceRunId, "low.example", "Low Fit", "low");
  database.completeRun(sourceRunId);

  try {
    assert.throws(
      () => startDecisionMakerPipeline(database, sourceRunId, async () => {
        throw new Error("should not search");
      }),
      /does not contain any high-fit leads/,
    );
    assert.equal(database.listRuns().length, 1);
  } finally {
    database.close();
  }
});

function saveProfile(
  database: PipelineDatabase,
  runId: number,
  domain: string,
  name: string,
  fit: "high" | "medium" | "low",
): void {
  database.upsertCompanyProfile({
    runId,
    domain,
    companyUrl: `https://${domain}/`,
    profile: {
      name,
      event: "ISA Sign Expo",
      qualification: {
        fit,
        confidence: "high",
        rationale: "Test assessment",
        evidence: [],
      },
    },
  });
}
