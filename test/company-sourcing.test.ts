import assert from "node:assert/strict";
import { test } from "node:test";

import {
  findOfficialCompanyUrl,
  type RenderedPage,
} from "../backend/company-sourcing.ts";

function profile(links: RenderedPage["links"]): RenderedPage {
  return {
    url: "https://directory.event.example/exhibitors/acme",
    title: "Acme Signs",
    status: 200,
    text: "Acme Signs",
    links,
    frameUrls: [],
  };
}

test("selects a labeled official website from an exhibitor profile", () => {
  const result = findOfficialCompanyUrl(
    "Acme Signs",
    profile([
      { text: "Event home", url: "https://event.example" },
      { text: "LinkedIn", url: "https://linkedin.com/company/acme" },
      { text: "Company website", url: "https://www.acmesigns.example/about" },
    ]),
    "https://directory.event.example/exhibitors",
  );

  assert.equal(result, "https://www.acmesigns.example/about");
});

test("does not guess from unrelated external links", () => {
  const result = findOfficialCompanyUrl(
    "Acme Signs",
    profile([
      { text: "Privacy policy", url: "https://event-organizer.example/privacy" },
      { text: "Instagram", url: "https://instagram.com/acme" },
    ]),
    "https://directory.event.example/exhibitors",
  );

  assert.equal(result, null);
});
