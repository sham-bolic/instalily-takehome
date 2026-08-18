import assert from "node:assert/strict";
import { test } from "node:test";

import { researchCompany } from "./company-research.ts";

test("researches a company with one neutral Tavily search and resolves its official website", async () => {
  const queries: string[] = [];

  const result = await researchCompany(
    "test-key",
    { name: "Acme Graphics", event: "Print Expo", knownWebsite: null },
    async (_apiKey, query) => {
      queries.push(query);
      return {
        requestId: "request-1",
        answer:
          "Acme Graphics manufactures printed signs and is headquartered in Cleveland.",
        results: [
          {
            title: "Acme Graphics | Signs and displays",
            url: "https://www.acmegraphics.example/products/signs",
            content:
              "Acme Graphics manufactures signs, displays, and architectural graphics from Cleveland, Ohio.",
            score: 0.91,
          },
          {
            title: "Acme Graphics on LinkedIn",
            url: "https://linkedin.com/company/acme-graphics",
            content: "Company profile.",
            score: 0.95,
          },
        ],
      };
    },
  );

  assert.equal(queries.length, 1);
  assert.match(queries[0] ?? "", /Acme Graphics/);
  assert.match(queries[0] ?? "", /Print Expo/);
  assert.doesNotMatch(queries[0] ?? "", /ICP|ideal customer/i);
  assert.equal(result.company_url, "https://www.acmegraphics.example/");
  assert.equal(result.identity_confidence, "high");
  assert.equal(result.summary, "Acme Graphics manufactures printed signs and is headquartered in Cleveland.");
  assert.deepEqual(result.sources, [
    {
      title: "Acme Graphics | Signs and displays",
      url: "https://www.acmegraphics.example/products/signs",
      excerpt:
        "Acme Graphics manufactures signs, displays, and architectural graphics from Cleveland, Ohio.",
      score: 0.91,
    },
    {
      title: "Acme Graphics on LinkedIn",
      url: "https://linkedin.com/company/acme-graphics",
      excerpt: "Company profile.",
      score: 0.95,
    },
  ]);
});

test("keeps a known website while still collecting general company information", async () => {
  let calls = 0;
  const result = await researchCompany(
    "test-key",
    {
      name: "Known Company",
      event: "Industry Expo",
      knownWebsite: "https://known.example/about",
    },
    async () => {
      calls += 1;
      return {
        requestId: "request-2",
        results: [],
      };
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.company_url, "https://known.example/about");
  assert.equal(result.identity_confidence, "high");
  assert.equal(result.summary, null);
});
