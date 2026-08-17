import assert from "node:assert/strict";
import { test } from "node:test";

import { companyQualificationSchema } from "./company-qualification.ts";

test("accepts the lean qualification result", () => {
  const result = companyQualificationSchema.parse({
    fit: "high",
    confidence: "medium",
    rationale: "The product matches the ICP, but company scale is unclear.",
    evidence: ["The company manufactures weather-resistant graphic films."],
  });

  assert.equal(result.fit, "high");
  assert.equal(result.confidence, "medium");
});

test("rejects ratings outside the supported categories", () => {
  assert.throws(() =>
    companyQualificationSchema.parse({
      fit: "excellent",
      confidence: "medium",
      rationale: "Strong fit.",
      evidence: [],
    }),
  );
});
