import assert from "node:assert/strict";
import { test } from "node:test";

import {
  toDecisionMakerCompanies,
  toLeadView,
  toPipelineInventory,
  type LeadView,
} from "../../app/lib/dashboard-data.ts";
import type {
  CompanyProfile,
  StageArtifact,
} from "./pipeline-database.ts";

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
      decision_makers: [
        {
          firstName: "Dana",
          lastName: "Director",
          companyName: "Example Graphics",
          companyDomain: "graphics.example",
          jobTitle: "Director of Product Development",
          seniorities: ["Director"],
          departments: ["Product Development"],
          country: "United States",
          linkedInUrl: "https://www.linkedin.com/in/dana-director",
        },
      ],
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
    decisionMakers: [
      {
        name: "Dana Director",
        title: "Director of Product Development",
        linkedInUrl: "https://www.linkedin.com/in/dana-director",
        companyName: "Example Graphics",
        companyDomain: "graphics.example",
        seniorities: ["Director"],
        departments: ["Product Development"],
        country: "United States",
        outreach: null,
        outreachStatus: null,
        outreachExclusionReason: null,
        relevanceScore: null,
        relevanceConfidence: null,
        relevanceRationale: null,
      },
    ],
  });
});

test("distinguishes decision-maker matches, zero results, and API errors", () => {
  const leads = [
    leadView("matches.example", 1),
    leadView("empty.example", 0),
    leadView("failed.example", 0),
    leadView("pending.example", 0),
  ];
  const artifacts = [
    { ...artifact(1, "decision_maker_search", { total: 1 }), companyDomain: "matches.example" },
    { ...artifact(2, "decision_maker_search", { total: 0 }), companyDomain: "empty.example" },
    {
      ...artifact(3, "decision_maker_search", null),
      companyDomain: "failed.example",
      status: "failed" as const,
      output: null,
      error: "Surfe unavailable",
    },
  ];

  assert.deepEqual(
    toDecisionMakerCompanies(leads, artifacts).map(
      ({ domain, status, error, people }) => ({
        domain,
        status,
        error,
        people: people.length,
      }),
    ),
    [
      { domain: "matches.example", status: "matches_found", error: null, people: 1 },
      { domain: "empty.example", status: "no_matches", error: null, people: 0 },
      { domain: "failed.example", status: "api_error", error: "Surfe unavailable", people: 0 },
      { domain: "pending.example", status: "not_searched", error: null, people: 0 },
    ],
  );
});

test("builds a complete inventory from sourcing and enrichment artifacts", () => {
  const artifacts: StageArtifact[] = [
    artifact(1, "event_sourcing", {
      events: [
        {
          name: "ISA Sign Expo",
          discovery_url: "https://events.example/isa",
          summary: "Sign and graphics industry event.",
          relevance_score: 0.91,
          company_source: {
            type: "exhibitor_directory",
            url: "https://events.example/isa/exhibitors",
          },
        },
        {
          name: "Print Expo",
          discovery_url: "https://events.example/print",
          summary: "Printing event without a usable directory.",
          relevance_score: 0.72,
          company_source: null,
        },
      ],
    }),
    artifact(2, "company_sourcing", {
      event: {
        name: "ISA Sign Expo",
        exhibitor_directory_url: "https://events.example/isa/exhibitors",
      },
      companies: [
        {
          name: "Enriched Graphics",
          booth: "101",
          profile_url: "https://events.example/companies/enriched",
          company_url: "https://enriched.example",
          attendance_evidence: {
            type: "official_exhibitor_directory",
            url: "https://events.example/isa/exhibitors",
          },
        },
        {
          name: "Skipped Signs",
          booth: null,
          profile_url: null,
          company_url: null,
          attendance_evidence: {
            type: "official_exhibitor_directory",
            url: "https://events.example/isa/exhibitors",
          },
        },
        {
          name: "Waiting Wraps",
          booth: "303",
          profile_url: null,
          company_url: "https://waiting.example",
          attendance_evidence: {
            type: "official_exhibitor_directory",
            url: "https://events.example/isa/exhibitors",
          },
        },
      ],
    }),
    artifact(3, "company_enrichment", {
      status: "enriched",
      company_url: "https://enriched.example",
    }, {
      event: "ISA Sign Expo",
      company: { name: "Enriched Graphics", website: "https://enriched.example" },
    }),
    artifact(4, "company_enrichment", {
      status: "skipped",
      reason: "apollo_organization_not_resolved",
    }, {
      event: "ISA Sign Expo",
      company: { name: "Skipped Signs", website: null },
    }),
  ];
  const profiles: CompanyProfile[] = [{
    id: 1,
    runId: 1,
    domain: "enriched.example",
    companyUrl: "https://enriched.example",
    updatedAt: "2026-08-17T00:00:00.000Z",
    profile: { name: "Enriched Graphics", event: "ISA Sign Expo" },
  }];

  const inventory = toPipelineInventory(artifacts, profiles);

  assert.equal(inventory.events.length, 2);
  assert.equal(inventory.events[0]?.selectedForSourcing, true);
  assert.equal(inventory.events[1]?.selectedForSourcing, false);
  assert.deepEqual(
    inventory.companies.map((company) => [company.name, company.enrichmentStatus]),
    [
      ["Enriched Graphics", "enriched"],
      ["Skipped Signs", "not_enriched"],
      ["Waiting Wraps", "not_attempted"],
    ],
  );
});

test("replaces an event profile redirect with the website resolved by Tavily", () => {
  const inventory = toPipelineInventory([
    artifact(1, "company_sourcing", {
      event: {
        name: "Defense Expo",
        exhibitor_directory_url: "https://events.example/directory",
      },
      companies: [{
        name: "Axon Vision",
        booth: "12",
        profile_url: "https://events.example/exhibitors/axon-vision",
        company_url: "https://website-vendor.example/client",
        attendance_evidence: {
          type: "official_exhibitor_directory",
          url: "https://events.example/directory",
        },
      }],
    }),
    artifact(2, "company_research", {
      company_url: "https://axon-vision.example/",
      identity_confidence: "high",
    }, {
      event: "Defense Expo",
      company: {
        name: "Axon Vision",
        website: "https://website-vendor.example/client",
      },
    }),
  ], []);

  assert.equal(
    inventory.companies[0]?.companyUrl,
    "https://axon-vision.example/",
  );
});

test("removes an event profile redirect when Tavily cannot verify a website", () => {
  const inventory = toPipelineInventory([
    artifact(1, "company_sourcing", {
      event: {
        name: "Defense Expo",
        exhibitor_directory_url: "https://events.example/directory",
      },
      companies: [{
        name: "Ambiguous Company",
        booth: null,
        profile_url: null,
        company_url: "https://website-vendor.example/client",
        attendance_evidence: {
          type: "official_exhibitor_directory",
          url: "https://events.example/directory",
        },
      }],
    }),
    artifact(2, "company_research", {
      company_url: null,
      identity_confidence: "unresolved",
    }, {
      event: "Defense Expo",
      company: {
        name: "Ambiguous Company",
        website: "https://website-vendor.example/client",
      },
    }),
  ], []);

  assert.equal(inventory.companies[0]?.companyUrl, null);
});

test("keeps sourced companies visible when enrichment fails", () => {
  const failed = artifact(1, "company_enrichment", null, {
    event: "ISA Sign Expo",
    company: { name: "Broken Graphics", website: "https://broken.example" },
  }, "failed");
  failed.error = "Provider unavailable";

  const inventory = toPipelineInventory([
    artifact(2, "company_sourcing", {
      event: { name: "ISA Sign Expo", exhibitor_directory_url: "https://events.example/directory" },
      companies: [{
        name: "Broken Graphics",
        booth: null,
        profile_url: null,
        company_url: "https://broken.example",
        attendance_evidence: { type: "official_exhibitor_directory", url: "https://events.example/directory" },
      }],
    }),
    failed,
  ], []);

  assert.equal(inventory.companies[0]?.enrichmentStatus, "failed");
  assert.equal(inventory.companies[0]?.enrichmentDetail, "Provider unavailable");
});

function leadView(domain: string, people: number): LeadView {
  return {
    domain,
    companyUrl: `https://${domain}`,
    name: domain,
    event: "Test event",
    rank: 1,
    fit: "high",
    confidence: "high",
    rationale: "Test lead",
    evidence: [],
    employeeCount: null,
    revenue: null,
    decisionMakers: people
      ? [{
          name: "Dana Director",
          title: "Director of Product Development",
          linkedInUrl: `https://linkedin.com/in/${domain}`,
          companyName: domain,
          companyDomain: domain,
          seniorities: ["Director"],
          departments: ["Product Development"],
          country: "US",
          outreach: null,
          outreachStatus: null,
          outreachExclusionReason: null,
          relevanceScore: null,
          relevanceConfidence: null,
          relevanceRationale: null,
        }]
      : [],
  };
}

function artifact(
  id: number,
  stage: string,
  output: unknown,
  input: unknown = {},
  status: StageArtifact["status"] = "completed",
): StageArtifact {
  return {
    id,
    runId: 1,
    stage,
    companyDomain: null,
    status,
    input,
    output,
    error: null,
    provider: null,
    startedAt: "2026-08-17T00:00:00.000Z",
    finishedAt: "2026-08-17T00:00:01.000Z",
  };
}

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
