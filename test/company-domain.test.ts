import assert from "node:assert/strict";
import { test } from "node:test";

import { companyDomainsMatch } from "../backend/company-domain.ts";

test("matches a company subdomain to its parent domain", () => {
  assert.equal(companyDomainsMatch("careers.agfa.com", "agfa.com"), true);
  assert.equal(companyDomainsMatch("agfa.com", "careers.agfa.com"), true);
  assert.equal(companyDomainsMatch("notagfa.com", "agfa.com"), false);
});
