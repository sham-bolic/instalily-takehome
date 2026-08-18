import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEventSearchQuery } from "./event-sourcing.ts";

const EVENT_QUERY_TARGET_CHARACTERS = 500;

test("builds a concise event query from structured ICP criteria", () => {
  const query = buildEventSearchQuery(
    "# Ideal Customer Profile\n\nA much longer rendered ICP with qualification details.",
    new Date("2026-03-01T00:00:00.000Z"),
    {
      offering: "Protective film",
      targetCompanies: "Graphic film manufacturers and signage converters",
      applications: "Vehicle wraps and architectural graphics",
      geography: "North America",
      exclusions: "Short-term indoor applications",
    },
  );

  assert.ok(Array.from(query).length <= EVENT_QUERY_TARGET_CHARACTERS);
  assert.match(query, /graphic film manufacturers and signage converters/i);
  assert.match(query, /vehicle wraps and architectural graphics/i);
  assert.match(query, /North America/i);
  assert.doesNotMatch(query, /qualification|short-term|protective film/i);
});

test("keeps unstructured ICP queries concise", () => {
  const query = buildEventSearchQuery(
    "😀".repeat(1_500),
    new Date("2026-03-01T00:00:00.000Z"),
  );

  assert.equal(Array.from(query).length, EVENT_QUERY_TARGET_CHARACTERS);
  assert.doesNotMatch(query, /[\uD800-\uDBFF]$/);
  assert.match(query, /…$/);
});
