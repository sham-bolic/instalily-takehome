import assert from "node:assert/strict";
import { test } from "node:test";

import { researchCompany } from "../backend/company-research.ts";

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

  assert.deepEqual(queries, ['"Acme Graphics" official website']);
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

test("does not resolve a generic one-word name from one matching domain", async () => {
  const result = await researchCompany(
    "test-key",
    { name: "Cline", event: "Defense Expo", knownWebsite: null },
    async () => ({
      requestId: "request-cline",
      results: [
        {
          title: "Cline Music",
          url: "https://www.clinemusic.com/",
          content: "Official site for musician Cline.",
          score: 0.82,
        },
        {
          title: "Cline - an AI coding agent",
          url: "https://github.com/cline/cline",
          content: "Open source coding agent.",
          score: 0.95,
        },
      ],
    }),
  );

  assert.equal(result.company_url, null);
  assert.equal(result.identity_confidence, "unresolved");
});

test("resolves a DBA name independently from the legal exhibitor name", async () => {
  const result = await researchCompany(
    "test-key",
    {
      name: "Stratascor LLC, dba: StratasCorp Technologies",
      event: "Defense Expo",
      knownWebsite: null,
    },
    async () => ({
      requestId: "request-dba",
      results: [
        {
          title: "StratasCorp Technologies | Digital transformation",
          url: "https://stratascorp.com/services",
          content: "StratasCorp Technologies serves government customers.",
          score: 0.87,
        },
      ],
    }),
  );

  assert.equal(result.company_url, "https://stratascorp.com/");
  assert.equal(result.identity_confidence, "high");
});

test("uses corroborating title and excerpt when the official domain uses another brand", async () => {
  const result = await researchCompany(
    "test-key",
    { name: "Everight Position", event: "Defense Expo", knownWebsite: null },
    async () => ({
      requestId: "request-branded-domain",
      results: [
        {
          title: "Everight Position: Home",
          url: "https://sensorguys.com/",
          content:
            "Everight Position is the official source for position measurement sensors.",
          score: 0.93,
        },
      ],
    }),
  );

  assert.equal(result.company_url, "https://sensorguys.com/");
  assert.equal(result.identity_confidence, "medium");
});

test("replays Run 16 Tavily results for the companies that exposed identity failures", async () => {
  const cases = [
    {
      name: "Seeing Systems",
      expectedUrl: null,
      results: [
        {
          title: "Seeing Systems (YC W26) - We build autonomous drones for the most contested environments on Earth.",
          url: "https://www.linkedin.com/company/seeing-systems",
          content: "We build autonomous drones for the most contested combat environments on Earth.",
          score: 0.62303346,
        },
        {
          title: "Launch YC: Seeing Systems: Modular Autonomous Drones for Modern Warfare | Y Combinator",
          url: "https://www.ycombinator.com/launches/PLA-seeing-systems-modular-autonomous-drones-for-modern-warfare",
          content: "Contact us at founders@seeing-systems.com and www.seeing-systems.com.",
          score: 0.5176446,
        },
      ],
    },
    {
      name: "Everight Position",
      expectedUrl: "https://sensorguys.com/",
      results: [
        {
          title: "Everight Position: Home",
          url: "https://sensorguys.com",
          content: "Everight Position is dedicated to helping customers find the best solution for their positioning needs.",
          score: 0.6429039,
        },
        {
          title: "Sensors and Absolute Rotary Encoders | Everight Position",
          url: "https://evrtp.com",
          content: "At Everight Position, we specialize in providing high-performance feedback solutions.",
          score: 0.52422476,
        },
      ],
    },
    {
      name: "Cline",
      expectedUrl: null,
      results: [
        {
          title: "GitHub - cline/cline: Autonomous coding agent as an SDK, IDE ...",
          url: "https://github.com/cline/cline",
          content: "Open source coding agent.",
          score: 0.48806435,
        },
        {
          title: "CLINE",
          url: "https://www.clinemusic.com",
          content: "Every release is approached as an opportunity to serve someone's faith journey.",
          score: 0.41151342,
        },
      ],
    },
    {
      name: "Stratascor LLC, dba: StratasCorp Technologies",
      expectedUrl: "https://stratascorp.com/",
      results: [
        {
          title: "StratasCorp Technologies Awarded $44 Million Navy Electronic Warfare Support Services IDIQ | StratasCorp",
          url: "https://stratascorp.com/stratascorp-technologies-awarded-44-million-navy-electronic-warfare-support-services-idiq",
          content: "Stratascor, LLC (dba: StratasCorp Technologies) was awarded a $44 Million IDIQ.",
          score: 0.7213709,
        },
        {
          title: "StratasCorp Technologies | Your Essential Technology Partner",
          url: "https://stratastech.com",
          content: "Founded in 2015, StratasCorp Technologies supports federal government and defense requirements.",
          score: 0.65861565,
        },
      ],
    },
    {
      name: "Vannevar Labs",
      expectedUrl: "https://www.vannevarlabs.com/",
      results: [
        {
          title: "Vannevar Labs | Border Technology Summit",
          url: "https://www.idga.org/events-border-tech-summit/sponsors/vannevar-labs",
          content: "Vannevar Labs builds new defense capabilities for modern conflict.",
          score: 0.6816637,
        },
        {
          title: "Vannevar Labs",
          url: "https://www.vannevarlabs.com",
          content: "Vannevar builds agentic AI for 21st-century conflict.",
          score: 0.44840267,
        },
      ],
    },
  ];

  for (const fixture of cases) {
    const result = await researchCompany(
      "test-key",
      { name: fixture.name, event: "Apex Defense 2027", knownWebsite: null },
      async () => ({
        requestId: `run-16-${fixture.name}`,
        results: fixture.results,
      }),
    );

    assert.equal(result.company_url, fixture.expectedUrl, fixture.name);
  }
});

test("uses Tavily to verify a sourced website before trusting it", async () => {
  let calls = 0;
  const result = await researchCompany(
    "test-key",
    {
      name: "Known Company",
      event: "Industry Expo",
      knownWebsite: "https://website-vendor.example/client",
    },
    async () => {
      calls += 1;
      return {
        requestId: "request-2",
        results: [
          {
            title: "Known Company | Official website",
            url: "https://knowncompany.example/about",
            content: "Known Company makes industrial equipment.",
            score: 0.9,
          },
        ],
      };
    },
  );

  assert.equal(calls, 1);
  assert.equal(result.company_url, "https://knowncompany.example/");
  assert.equal(result.identity_confidence, "high");
  assert.equal(result.summary, null);
});
