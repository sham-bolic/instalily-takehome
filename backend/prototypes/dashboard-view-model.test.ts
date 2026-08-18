import assert from "node:assert/strict";
import { test } from "node:test";

import { toLeadView } from "../../app/lib/dashboard-data.ts";
import type { CompanyProfile } from "./pipeline-database.ts";

test("maps a persisted profile into a sales-facing lead", () => {
  const profile: CompanyProfile = {
    id: 1,
    runId: 4,
    domain: "graphics.example",
    companyUrl: "https://graphics.example",
    updatedAt: "2026-08-17T00:00:00.000Z",
    profile: {
      name: "Example Graphics",
      event: "ISA Sign Expo",
      rank: 1,
      enrichment: {
        provider_response: {
          organization: {
            estimated_num_employees: 420,
            annual_revenue: 75_000_000,
          },
        },
      },
      qualification: {
        fit: "high",
        confidence: "medium",
        rationale: "Makes durable outdoor graphics.",
        evidence: ["Sells weather-resistant films."],
      },
    },
  };

  assert.deepEqual(toLeadView(profile), {
    domain: "graphics.example",
    companyUrl: "https://graphics.example",
    name: "Example Graphics",
    event: "ISA Sign Expo",
    rank: 1,
    fit: "high",
    confidence: "medium",
    rationale: "Makes durable outdoor graphics.",
    evidence: ["Sells weather-resistant films."],
    employeeCount: 420,
    revenue: "$75M",
  });
});

test("keeps unavailable sales facts explicit", () => {
  const profile: CompanyProfile = {
    id: 1,
    runId: 4,
    domain: "unknown.example",
    companyUrl: "https://unknown.example",
    updatedAt: "2026-08-17T00:00:00.000Z",
    profile: {},
  };

  const lead = toLeadView(profile);
  assert.equal(lead.name, "unknown.example");
  assert.equal(lead.fit, null);
  assert.equal(lead.employeeCount, null);
  assert.equal(lead.revenue, null);
  assert.deepEqual(lead.evidence, []);
});
