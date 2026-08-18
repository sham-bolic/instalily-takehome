import { z } from "zod";

const SURFE_PEOPLE_SEARCH_URL = "https://api.surfe.com/v2/people/search";
const MAX_DECISION_MAKERS = 10;

export const DECISION_MAKER_SENIORITIES = ["VP", "Director", "Head"] as const;

export const decisionMakerSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  companyName: z.string().min(1),
  companyDomain: z.string().min(1),
  linkedInUrl: z.string().url(),
  jobTitle: z.string().min(1),
  seniorities: z.array(z.string()),
  departments: z.array(z.string()),
  country: z.string().nullable().optional(),
});

const surfeResponseSchema = z.object({
  people: z.array(decisionMakerSchema),
  total: z.number().int().nonnegative(),
});

export type DecisionMaker = z.infer<typeof decisionMakerSchema>;

export type DecisionMakerSearchInput = {
  companyName: string;
  domain: string;
};

export type DecisionMakerSearchResult = {
  searched_at: string;
  company: DecisionMakerSearchInput;
  criteria: {
    seniorities: string[];
  };
  people: DecisionMaker[];
  total: number;
};

type Fetcher = typeof fetch;

export async function searchDecisionMakers(
  apiKey: string,
  input: DecisionMakerSearchInput,
  fetcher: Fetcher = fetch,
): Promise<DecisionMakerSearchResult> {
  const companyName = input.companyName.trim();
  const domain = normalizeDomain(input.domain);
  if (!companyName) throw new Error("Decision-maker search requires a company name.");

  const request = {
    companies: { domains: [domain] },
    people: {
      seniorities: [...DECISION_MAKER_SENIORITIES],
    },
    limit: MAX_DECISION_MAKERS,
    peoplePerCompany: MAX_DECISION_MAKERS,
  };
  const response = await fetcher(SURFE_PEOPLE_SEARCH_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(request),
  });
  const providerResponse: unknown = await response.json();

  if (!response.ok) {
    throw new Error(
      `Surfe decision-maker search failed (${response.status}): ${JSON.stringify(providerResponse).slice(0, 500)}`,
    );
  }

  const parsed = surfeResponseSchema.safeParse(providerResponse);
  if (!parsed.success) {
    throw new Error(
      `Surfe decision-maker search returned an invalid response: ${parsed.error.message}`,
    );
  }

  return {
    searched_at: new Date().toISOString(),
    company: { companyName, domain },
    criteria: {
      seniorities: [...DECISION_MAKER_SENIORITIES],
    },
    people: parsed.data.people,
    total: parsed.data.total,
  };
}

function normalizeDomain(value: string): string {
  const clean = value.trim().toLocaleLowerCase("en-US");
  if (!clean) throw new Error("Decision-maker search requires a company domain.");
  if (clean.includes("://")) {
    const hostname = new URL(clean).hostname;
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  }
  return clean.startsWith("www.") ? clean.slice(4) : clean;
}
