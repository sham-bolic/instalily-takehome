import assert from "node:assert/strict";
import { test } from "node:test";

import { startOutreachPipeline } from "../backend/outreach-pipeline.ts";
import { PipelineDatabase } from "../backend/pipeline-database.ts";

test("creates a linked outreach run and drafts only matched people", async () => {
  const database = new PipelineDatabase(":memory:");
  const qualificationRunId = database.createRun({ mode: "pipeline" });
  database.completeRun(qualificationRunId);
  const sourceRunId = database.createRun({
    mode: "pipeline",
    label: "Decision-makers fixture",
    rootInput: {
      icp: "Durable graphics",
      decision_makers_from_run_id: qualificationRunId,
    },
  });
  saveProfile(database, sourceRunId, "graphics.example", true);
  saveProfile(database, sourceRunId, "empty.example", false);
  database.completeRun(sourceRunId);
  const draftedPeople: string[] = [];

  try {
    const execution = startOutreachPipeline(database, sourceRunId, {
      evaluate: async (input) => input.people.map((person) => ({
        personLinkedInUrl: person.linkedInUrl,
        relevanceScore: 88,
        confidence: "high" as const,
        rationale: "The product development role is directly relevant to the ICP.",
      })),
      research: async (input) => ({
        researched_at: "2026-08-18T00:00:00.000Z",
        query: "test query",
        request_id: "request-1",
        company_domain: input.companyDomain,
        evidence: [{
          id: "company_signal_1",
          title: "Outdoor graphics",
          url: `https://${input.companyDomain}/outdoor`,
          excerpt: "The company makes outdoor graphics films.",
          score: 0.9,
        }],
        warnings: [],
      }),
      draft: async (input) => {
        draftedPeople.push(input.person.linkedInUrl);
        return {
          personLinkedInUrl: input.person.linkedInUrl,
          message: "Hi Dana - I saw your team's work in outdoor graphics films. Given your product development role, surface durability may be relevant. Tedlar Clear Protection film is designed to protect graphics from UV exposure and fading. Would exploring its fit for the films your team develops be relevant?",
          whyThisPerson: "Product development role.",
          whyThisCompany: input.company.qualificationRationale,
          evidenceIds: ["company_signal_1"],
          productClaimId: "tedlar_uv_fading",
          productClaim: "Tedlar protects graphics from UV exposure and fading.",
          productClaimSourceUrl: "https://www.dupont.com/tedlar/tedlar-signage-applications.html",
          confidence: "high",
          warnings: [],
          draftedAt: "2026-08-18T00:00:01.000Z",
        };
      },
    });
    const result = await execution.completion;

    assert.deepEqual(result, {
      runId: execution.runId,
      sourceRunId,
      importedCompanies: 1,
      evaluatedCompanies: 1,
      failedEvaluations: 0,
      researchedCompanies: 1,
      failedResearches: 0,
      draftedMessages: 1,
      failedDrafts: 0,
    });
    assert.deepEqual(draftedPeople, [
      "https://www.linkedin.com/in/dana-director",
    ]);
    assert.deepEqual(database.getRun(execution.runId)?.rootInput, {
      icp: "Durable graphics",
      outreach_from_run_id: sourceRunId,
      outreach_relevance_threshold: 70,
    });
    const profile = database.listCompanyProfiles(execution.runId)[0]?.profile as {
      outreach_drafts: unknown[];
    };
    assert.equal(profile.outreach_drafts.length, 1);
    assert.deepEqual(
      database.listStageArtifacts(execution.runId).map(({ stage, provider }) => ({
        stage,
        provider,
      })),
      [
        { stage: "decision_maker_import", provider: "sqlite" },
        { stage: "outreach_candidate_evaluation", provider: "google" },
        { stage: "outreach_research", provider: "tavily" },
        { stage: "outreach_drafting", provider: "google" },
      ],
    );
  } finally {
    database.close();
  }
});

test("creates outreach for a completed full pipeline run with matched people", async () => {
  const database = new PipelineDatabase(":memory:");
  const sourceRunId = database.createRun({
    mode: "pipeline",
    label: "Full pipeline fixture",
    rootInput: { icp: "Durable graphics" },
  });
  saveProfile(
    database,
    sourceRunId,
    "careers.graphics.example",
    true,
    "graphics.example",
  );
  database.completeRun(sourceRunId);

  try {
    const execution = startOutreachPipeline(database, sourceRunId, {
      evaluate: async (input) => input.people.map((person) => ({
        personLinkedInUrl: person.linkedInUrl,
        relevanceScore: 80,
        confidence: "high" as const,
        rationale: "The role is relevant to the ICP.",
      })),
      research: async (input) => ({
        researched_at: "2026-08-18T00:00:00.000Z",
        query: "test query",
        request_id: "request-1",
        company_domain: input.companyDomain,
        evidence: [],
        warnings: [],
      }),
      draft: async (input) => ({
        personLinkedInUrl: input.person.linkedInUrl,
        message: "Personalized message",
        whyThisPerson: "Relevant role",
        whyThisCompany: input.company.qualificationRationale,
        evidenceIds: [],
        productClaimId: "tedlar_uv_fading",
        productClaim: "Tedlar protects graphics from UV exposure and fading.",
        productClaimSourceUrl: "https://www.dupont.com/tedlar/tedlar-signage-applications.html",
        confidence: "high",
        warnings: [],
        draftedAt: "2026-08-18T00:00:01.000Z",
      }),
    });
    const result = await execution.completion;

    assert.equal(result.sourceRunId, sourceRunId);
    assert.equal(result.draftedMessages, 1);
  } finally {
    database.close();
  }
});

test("only researches and drafts candidates who meet the relevance threshold", async () => {
  const database = new PipelineDatabase(":memory:");
  const qualificationRunId = database.createRun({ mode: "pipeline" });
  database.completeRun(qualificationRunId);
  const sourceRunId = database.createRun({
    mode: "pipeline",
    rootInput: { decision_makers_from_run_id: qualificationRunId },
  });
  saveProfile(database, sourceRunId, "graphics.example", true);
  database.completeRun(sourceRunId);

  try {
    const execution = startOutreachPipeline(database, sourceRunId, {
      evaluate: async (input) => input.people.map((person) => ({
        personLinkedInUrl: person.linkedInUrl,
        relevanceScore: 69,
        confidence: "medium" as const,
        rationale: "The role has some relevance but does not clearly match the ICP.",
      })),
      research: async () => {
        throw new Error("Research should not run below the threshold.");
      },
      draft: async () => {
        throw new Error("Drafting should not run below the threshold.");
      },
    });
    const result = await execution.completion;

    assert.equal(result.researchedCompanies, 0);
    assert.equal(result.draftedMessages, 0);
    const profile = database.listCompanyProfiles(execution.runId)[0]?.profile as {
      outreach_selection: {
        selected_person_linkedin_urls: string[];
        excluded: Array<{ reason: string }>;
      };
    };
    assert.deepEqual(profile.outreach_selection.selected_person_linkedin_urls, []);
    assert.match(profile.outreach_selection.excluded[0]?.reason ?? "", /69.*70 threshold/);
  } finally {
    database.close();
  }
});

test("falls back to role context when company research fails", async () => {
  const database = new PipelineDatabase(":memory:");
  const qualificationRunId = database.createRun({ mode: "pipeline" });
  database.completeRun(qualificationRunId);
  const sourceRunId = database.createRun({
    mode: "pipeline",
    rootInput: { decision_makers_from_run_id: qualificationRunId },
  });
  saveProfile(database, sourceRunId, "graphics.example", true);
  database.completeRun(sourceRunId);
  let fallbackWarning = "";

  try {
    const execution = startOutreachPipeline(database, sourceRunId, {
      evaluate: async (input) => input.people.map((person) => ({
        personLinkedInUrl: person.linkedInUrl,
        relevanceScore: 80,
        confidence: "high" as const,
        rationale: "The role is relevant to the ICP.",
      })),
      research: async () => {
        throw new Error("Tavily unavailable");
      },
      draft: async (input) => {
        fallbackWarning = input.research.warnings[0] ?? "";
        throw new Error("Draft unavailable");
      },
    });
    const result = await execution.completion;

    assert.equal(result.failedResearches, 1);
    assert.equal(result.failedDrafts, 1);
    assert.equal(result.draftedMessages, 0);
    assert.match(fallbackWarning, /research failed/);
    assert.equal(database.getRun(execution.runId)?.status, "completed");
  } finally {
    database.close();
  }
});

function saveProfile(
  database: PipelineDatabase,
  runId: number,
  domain: string,
  withPerson: boolean,
  personDomain = domain,
): void {
  database.upsertCompanyProfile({
    runId,
    domain,
    companyUrl: `https://${domain}/`,
    profile: {
      name: withPerson ? "Example Graphics" : "No Match Company",
      event: "ISA Sign Expo",
      qualification: {
        fit: "high",
        confidence: "high",
        rationale: "The company manufactures durable outdoor graphics.",
        evidence: ["The company makes weather-resistant films."],
      },
      decision_makers: withPerson
        ? [{
            firstName: "Dana",
            lastName: "Director",
            companyName: "Example Graphics",
            companyDomain: personDomain,
            linkedInUrl: "https://www.linkedin.com/in/dana-director",
            jobTitle: "Director of Product Development",
            seniorities: ["Director"],
            departments: ["Product Development"],
            country: "US",
          }]
        : [],
    },
  });
}
