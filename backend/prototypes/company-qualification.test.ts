import assert from "node:assert/strict";
import { test } from "node:test";

import {
  calculateQualification,
  createCompanyQualifier,
  type GeneratedAssessment,
} from "./company-qualification.ts";

function assessment(
  overrides: Partial<GeneratedAssessment> = {},
): GeneratedAssessment {
  return {
    summary: "The supplied facts indicate a close ICP match.",
    criteria: [
      {
        criterionId: "industry_fit",
        rating: "strong",
        rationale: "The company serves graphics customers.",
        evidenceIds: ["E1"],
        missingInformation: [],
      },
      {
        criterionId: "product_application_fit",
        rating: "strong",
        rationale: "Its films require weather resistance.",
        evidenceIds: ["E2"],
        missingInformation: [],
      },
      {
        criterionId: "company_scale",
        rating: "partial",
        rationale: "Employee data indicates meaningful scale.",
        evidenceIds: ["E3"],
        missingInformation: ["Revenue was not supplied."],
      },
      {
        criterionId: "strategic_relevance",
        rating: "strong",
        rationale: "Its durable film products align with the ICP.",
        evidenceIds: ["E2"],
        missingInformation: [],
      },
      {
        criterionId: "industry_engagement",
        rating: "unknown",
        rationale: "No event evidence was supplied.",
        evidenceIds: [],
        missingInformation: ["Relevant event participation."],
      },
    ],
    confidence: "medium",
    confidenceRationale: "The evidence is useful but event and revenue facts are missing.",
    ...overrides,
  };
}

test("creates an evidence-backed assessment and calculates fit outside the model", async () => {
  const requests: Array<{ system: string; prompt: string }> = [];
  const qualifier = createCompanyQualifier({
    provider: "test-provider",
    model: "test-model",
    generate: async (request) => {
      requests.push(request);
      return {
        output: assessment(),
        usage: { inputTokens: 120, outputTokens: 80 },
      };
    },
  });

  const result = await qualifier.assess({
    icp: "Companies making durable graphics and protective films",
    company: {
      industry: "Graphics",
      products: "Durable weather-resistant films",
      employees: 5_000,
    },
  });

  assert.equal(result.fit, "high");
  assert.equal(result.calculatedScore, 94);
  assert.equal(result.confidence, "medium");
  assert.deepEqual(result.model, {
    provider: "test-provider",
    name: "test-model",
  });
  assert.deepEqual(result.usage, { inputTokens: 120, outputTokens: 80 });
  assert.match(requests[0]?.system ?? "", /Avery Dennison Graphics Solutions/);
  assert.match(requests[0]?.prompt ?? "", /Companies making durable graphics/);
  assert.match(requests[0]?.prompt ?? "", /E1 \| \$profile\.employees \| 5000/);
});

test("retries when the model cites evidence that was not supplied", async () => {
  const corrections: Array<string | null> = [];
  const qualifier = createCompanyQualifier({
    provider: "test-provider",
    model: "test-model",
    generate: async (request) => {
      corrections.push(request.correction);
      if (corrections.length === 1) {
        const invalid = assessment();
        invalid.criteria[0] = {
          ...invalid.criteria[0],
          evidenceIds: ["E999"],
        };
        return { output: invalid };
      }
      return { output: assessment() };
    },
  });

  await qualifier.assess({
    icp: "Durable graphics companies",
    company: {
      industry: "Graphics",
      products: "Protective films",
      employees: 500,
    },
  });

  assert.equal(corrections.length, 2);
  assert.match(corrections[1] ?? "", /invalid evidence IDs: E999/);
});

test("fails only after the bounded correction attempts are exhausted", async () => {
  let attempts = 0;
  const qualifier = createCompanyQualifier({
    provider: "test-provider",
    model: "test-model",
    generate: async () => {
      attempts += 1;
      throw new Error("invalid structured output");
    },
  });

  await assert.rejects(
    qualifier.assess({ icp: "test ICP", company: { name: "Test" } }),
    /failed after 3 attempts: invalid structured output/,
  );
  assert.equal(attempts, 3);
});

test("unknown criteria do not reduce the score for supported criteria", () => {
  const criteria = assessment().criteria.map((criterion) =>
    criterion.criterionId === "industry_fit"
      ? criterion
      : {
          ...criterion,
          rating: "unknown" as const,
          evidenceIds: [],
          missingInformation: ["Not supplied."],
        },
  );

  assert.deepEqual(calculateQualification(criteria), { score: 100, fit: "high" });
});
