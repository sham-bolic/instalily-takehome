import assert from "node:assert/strict";
import { test } from "node:test";

import { researchOutreachSignals } from "../backend/outreach-research.ts";

test("keeps only first-party outreach evidence", async () => {
  const result = await researchOutreachSignals(
    "test-key",
    {
      companyName: "Example Graphics",
      companyDomain: "example.com",
      icp: "graphics and signage",
    },
    async (_key, query, domain) => {
      assert.match(query, /site:example\.com/);
      assert.equal(domain, "example.com");
      return {
        requestId: "request-1",
        results: [
          {
            title: "Outdoor fleet graphics",
            url: "https://products.example.com/fleet-wraps",
            content: "Weather-resistant films for outdoor fleet graphics.",
            score: 0.9,
          },
          {
            title: "Untrusted result",
            url: "https://other.example/fleet-wraps",
            content: "Graffiti-resistant signage.",
            score: 1,
          },
        ],
      };
    },
  );

  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0]?.id, "company_signal_1");
  assert.deepEqual(result.warnings, []);
});

test("returns an explicit warning when no first-party result survives", async () => {
  const result = await researchOutreachSignals(
    "test-key",
    {
      companyName: "Example Graphics",
      companyDomain: "example.com",
      icp: "graphics and signage",
    },
    async () => ({
      requestId: "request-2",
      results: [{
        title: "Third-party profile",
        url: "https://directory.example/company",
        content: "Example Graphics profile",
        score: 0.8,
      }],
    }),
  );

  assert.equal(result.evidence.length, 0);
  assert.match(result.warnings[0] ?? "", /No relevant first-party/);
});
