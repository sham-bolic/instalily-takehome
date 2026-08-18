import assert from "node:assert/strict";
import { test } from "node:test";

import { draftPersonalizedOutreach } from "../backend/outreach-drafting.ts";

test("rejects a candidate assessment for a different person before calling Gemini", async () => {
  await assert.rejects(
    () => draftPersonalizedOutreach("unused", {
      company: {
        name: "Example Materials",
        domain: "example.com",
        event: null,
        qualificationRationale: "The company fits the ICP.",
        qualificationEvidence: [],
      },
      person: {
        firstName: "Dana",
        lastName: "Director",
        companyName: "Example Materials",
        companyDomain: "example.com",
        linkedInUrl: "https://www.linkedin.com/in/dana",
        jobTitle: "Director of Product Development",
        seniorities: ["Director"],
        departments: ["Product Development"],
        country: "US",
      },
      assessment: {
        personLinkedInUrl: "https://www.linkedin.com/in/someone-else",
        relevanceScore: 90,
        confidence: "high",
        rationale: "A relevant product development role.",
      },
      research: {
        researched_at: "2026-08-18T00:00:00.000Z",
        query: "",
        request_id: "",
        company_domain: "example.com",
        evidence: [],
        warnings: [],
      },
    }),
    /assessment does not match/,
  );
});
