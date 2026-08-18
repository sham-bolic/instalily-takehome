import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildEventSearchQueries,
  findEvents,
} from "../backend/event-sourcing.ts";

const EVENT_QUERY_MAX_CHARACTERS = 260;

const criteria = {
  offering: "Protective film",
  targetCompanies: "Graphic film manufacturers and signage converters",
  applications: "Vehicle wraps and architectural graphics",
  strongFitSignals: "Participation in ISA Sign Expo, PRINTING United, and FESPA",
  geography: "North America",
  exclusions: "Short-term indoor applications",
};

test("builds several concise, event-specific queries from ICP criteria", () => {
  const queries = buildEventSearchQueries(
    "# Ideal Customer Profile\n\nA much longer rendered ICP.",
    new Date("2026-03-01T00:00:00.000Z"),
    criteria,
  );

  assert.equal(queries.length, 3);
  assert.ok(queries.every((query) => Array.from(query).length <= EVENT_QUERY_MAX_CHARACTERS));
  assert.match(queries[0] ?? "", /graphic film manufacturers signage converters/i);
  assert.match(queries[1] ?? "", /vehicle wraps architectural graphics/i);
  assert.match(queries[2] ?? "", /ISA Sign Expo PRINTING United FESPA/i);
  assert.ok(queries.every((query) => /trade show expo exhibitors directory/i.test(query)));
  assert.ok(queries.every((query) => !/short-term|protective film/i.test(query)));
});

test("keeps unstructured ICP queries concise", () => {
  const [query] = buildEventSearchQueries(
    "graphics".repeat(1_500),
    new Date("2026-03-01T00:00:00.000Z"),
  );

  assert.ok(Array.from(query ?? "").length <= EVENT_QUERY_MAX_CHARACTERS);
  assert.match(query ?? "", /trade show expo exhibitors directory$/);
});

test("deduplicates discovery results and resolves an event directory separately", async () => {
  const calls: Array<{ query: string; maxResults: number | undefined }> = [];
  const event = {
    title: "Graphics Expo 2026",
    url: "https://expo.example/2026",
    content: "The annual graphics trade show.",
    score: 0.91,
  };

  const result = await findEvents("test-key", "durable graphics", criteria, async (_key, query, maxResults) => {
    calls.push({ query, maxResults });
    if (/floor plan$/.test(query)) {
      return {
        requestId: "directory-request",
        results: [{
          title: "Graphics Expo Floor Plan",
          url: "https://graphics26.mapyourshow.com/8_0/floorplan/",
          content: "Participating companies",
          score: 0.88,
        }],
      };
    }
    return {
      requestId: `discovery-${calls.length}`,
      results: [event],
    };
  });

  assert.equal(calls.filter(({ query }) => !/floor plan$/.test(query)).length, 3);
  assert.equal(calls.filter(({ query }) => /floor plan$/.test(query)).length, 1);
  assert.equal(result.events.length, 1);
  assert.deepEqual(result.events[0]?.company_source, {
    type: "exhibitor_directory",
    url: "https://graphics26.mapyourshow.com/8_0/floorplan/",
  });
  assert.equal(result.events[0]?.relevance_score, 0.91);
  assert.equal(result.queries.length, 4);
  assert.equal(result.request_ids.length, 4);
});
