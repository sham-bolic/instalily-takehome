import assert from "node:assert/strict";
import { test } from "node:test";

import { enrichCompany } from "../backend/company-enrichment.ts";

test("enriches by website and includes the company name", async () => {
  let requestUrl = "";
  const fetcher: typeof fetch = async (input) => {
    requestUrl = String(input);
    return new Response(
      JSON.stringify({ organization: { name: "Linked Company" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await enrichCompany(
    "test-key",
    { name: "Linked Company", website: "https://www.linked.example" },
    fetcher,
  );

  const url = new URL(requestUrl);
  assert.equal(url.pathname, "/api/v1/organizations/enrich");
  assert.equal(url.searchParams.get("name"), "Linked Company");
  assert.equal(url.searchParams.get("domain"), "linked.example");
  assert.equal(url.searchParams.get("website"), "https://www.linked.example/");
});

test("falls back to matching by company name when no website is available", async () => {
  let requestUrl = "";
  const fetcher: typeof fetch = async (input) => {
    requestUrl = String(input);
    return new Response(
      JSON.stringify({ organization: { name: "Name Only Company" } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };

  await enrichCompany(
    "test-key",
    { name: "Name Only Company", website: null },
    fetcher,
  );

  const url = new URL(requestUrl);
  assert.equal(url.searchParams.get("name"), "Name Only Company");
  assert.equal(url.searchParams.has("domain"), false);
  assert.equal(url.searchParams.has("website"), false);
});
