import assert from "node:assert/strict";
import { test } from "node:test";

import { searchDecisionMakers } from "./decision-maker-search.ts";

test("searches Surfe by company domain for the required roles", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const result = await searchDecisionMakers(
    "secret-key",
    { companyName: "Avery Dennison", domain: "www.averydennison.com" },
    async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({
        people: [
          {
            firstName: "Diana",
            lastName: "Smirnova",
            companyName: "Avery Dennison Corporation",
            companyDomain: "averydennison.com",
            linkedInUrl: "https://www.linkedin.com/in/dssmirnova",
            jobTitle: "Vice President Research And Development",
            seniorities: ["VP"],
            departments: ["R&D", "Management"],
            country: "us",
          },
        ],
        total: 1,
      });
    },
  );

  assert.equal(requestUrl, "https://api.surfe.com/v2/people/search");
  assert.equal(requestInit?.method, "POST");
  assert.equal(
    (requestInit?.headers as Record<string, string>).authorization,
    "Bearer secret-key",
  );
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    companies: { domains: ["averydennison.com"] },
    people: {
      jobTitles: [
        "Product Development",
        "Innovation",
        "Research and Development",
        "R&D",
        "Coatings",
        "Protective Solutions",
      ],
      seniorities: ["VP", "Director", "Head"],
    },
    limit: 10,
    peoplePerCompany: 10,
  });
  assert.equal(result.people[0]?.firstName, "Diana");
  assert.equal(result.company.domain, "averydennison.com");
});

test("reports Surfe errors without exposing the API key", async () => {
  await assert.rejects(
    searchDecisionMakers(
      "secret-key",
      { companyName: "Avery Dennison", domain: "averydennison.com" },
      async () =>
        Response.json(
          { code: 429, message: "quota_exceeded" },
          { status: 429 },
        ),
    ),
    (error: unknown) => {
      assert.match(String(error), /Surfe decision-maker search failed \(429\)/);
      assert.doesNotMatch(String(error), /secret-key/);
      return true;
    },
  );
});
