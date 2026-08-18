import assert from "node:assert/strict";
import { test } from "node:test";

import { buildICPSnapshot } from "./icp-builder.ts";

test("builds an ICP from required and supplied optional fields", () => {
  const snapshot = buildICPSnapshot({
    offering: " Protective films ",
    targetCompanies: " Sign manufacturers ",
    applications: " Outdoor graphics ",
    strongFitSignals: "Weather exposure",
    exclusions: "Indoor-only products",
  });

  assert.deepEqual(snapshot, {
    version: 1,
    criteria: {
      offering: "Protective films",
      targetCompanies: "Sign manufacturers",
      applications: "Outdoor graphics",
      strongFitSignals: "Weather exposure",
      exclusions: "Indoor-only products",
    },
    text: [
      "# Ideal Customer Profile",
      "",
      "## Offering",
      "Protective films",
      "",
      "## Ideal customers",
      "Sign manufacturers",
      "",
      "## Target applications",
      "Outdoor graphics",
      "",
      "## Qualification criteria",
      "",
      "### Strong-fit signals",
      "Weather exposure",
      "",
      "### Exclusions",
      "Indoor-only products",
    ].join("\n"),
  });
});

test("requires only the three core ICP fields", () => {
  assert.throws(
    () =>
      buildICPSnapshot({
        offering: "",
        targetCompanies: "Sign manufacturers",
        applications: "",
      }),
    /offering, applications/,
  );
});
