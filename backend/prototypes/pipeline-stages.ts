import {
  extractDomain,
  normalizeCompanyUrl,
  type CompanyMatchInput,
} from "./company-enrichment.ts";
import { findCompanies } from "./company-sourcing.ts";
import {
  type CompanyResearch,
  type CompanyResearchInput,
} from "./company-research.ts";
import {
  type CompanyQualification,
  type QualificationInput,
} from "./company-qualification.ts";
import { findEvents } from "./event-sourcing.ts";
import { type CompanyProfile } from "./pipeline-database.ts";
import { PipelineRun } from "./pipeline-run.ts";

type EventDiscovery = Awaited<ReturnType<typeof findEvents>>;
type Event = EventDiscovery["events"][number];
type CompanySourcing = Awaited<ReturnType<typeof findCompanies>>;
type Company = CompanySourcing["companies"][number];
type Enrichment = {
  enriched_at: string;
  provider: unknown;
  provider_response: unknown;
};

type ApolloOrganization = {
  name?: unknown;
  website_url?: unknown;
  primary_domain?: unknown;
};

export type PipelineDependencies = {
  findEvents: (icp: string) => Promise<EventDiscovery>;
  findCompanies: (event: string, directoryUrl: string) => Promise<CompanySourcing>;
  researchCompany: (company: CompanyResearchInput) => Promise<CompanyResearch>;
  enrichCompany: (company: CompanyMatchInput) => Promise<Enrichment>;
  qualifyCompany: (
    input: QualificationInput,
  ) => Promise<CompanyQualification>;
};

export type EnrichmentCounts = {
  enrichedCompanies: number;
  skippedCompanies: number;
  failedEnrichments: number;
};

export type QualificationResult = {
  qualifiedCompanies: number;
  failedQualifications: number;
  rankedCompanies: RankedCompany[];
};

export type RankedCompany = {
  rank: number;
  domain: string;
  companyName: string;
  fit: CompanyQualification["fit"];
  confidence: CompanyQualification["confidence"];
};

export async function discoverEvents(
  run: PipelineRun,
  icp: string,
  threshold: number,
  discover: PipelineDependencies["findEvents"],
): Promise<EventDiscovery> {
  return run.stage(
    {
      name: "event_sourcing",
      input: { icp, threshold },
      provider: "tavily",
    },
    () => discover(icp),
  );
}

export async function sourceCompanies(
  run: PipelineRun,
  events: Event[],
  threshold: number,
  findForEvent: PipelineDependencies["findCompanies"],
): Promise<{ event: Event; sourcing: CompanySourcing }> {
  const candidates = events
    .filter(
      (event): event is Event & {
        company_source: NonNullable<Event["company_source"]>;
      } => event.relevance_score >= threshold && event.company_source !== null,
    )
    .sort((left, right) => right.relevance_score - left.relevance_score);

  if (candidates.length === 0) {
    throw new Error(
      `No event with a company directory met the ${threshold} relevance threshold.`,
    );
  }

  for (const event of candidates) {
    try {
      return await sourceEvent(run, event, findForEvent);
    } catch {
      // The failed artifact is persisted. Try the next event.
    }
  }

  throw new Error("No qualifying event had a usable company directory.");
}

export async function sourceSelectedEvent(
  run: PipelineRun,
  event: Event & { company_source: NonNullable<Event["company_source"]> },
  findForEvent: PipelineDependencies["findCompanies"],
): Promise<{ event: Event; sourcing: CompanySourcing }> {
  return sourceEvent(run, event, findForEvent);
}

async function sourceEvent(
  run: PipelineRun,
  event: Event & { company_source: NonNullable<Event["company_source"]> },
  findForEvent: PipelineDependencies["findCompanies"],
): Promise<{ event: Event; sourcing: CompanySourcing }> {
  const sourcing = await run.stage(
    {
      name: "company_sourcing",
      input: {
        event: event.name,
        directory_url: event.company_source.url,
      },
    },
    async () => {
      const result = await findForEvent(event.name, event.company_source.url);
      if (result.companies.length === 0) {
        throw new Error("The directory did not contain any recognizable exhibitors.");
      }
      return result;
    },
  );
  return { event, sourcing };
}

export async function enrichCompanies(
  run: PipelineRun,
  event: Event,
  companies: Company[],
  limit: number,
  research: PipelineDependencies["researchCompany"],
  enrich: PipelineDependencies["enrichCompany"],
): Promise<EnrichmentCounts> {
  let enrichedCompanies = 0;
  let skippedCompanies = 0;
  let failedEnrichments = 0;

  for (const company of companies.slice(0, limit)) {
    try {
      const status = await enrichOneCompany(
        run,
        event,
        company,
        research,
        enrich,
      );
      if (status === "enriched") enrichedCompanies += 1;
      else skippedCompanies += 1;
    } catch {
      failedEnrichments += 1;
    }
  }

  return { enrichedCompanies, skippedCompanies, failedEnrichments };
}

async function enrichOneCompany(
  run: PipelineRun,
  event: Event,
  company: Company,
  research: PipelineDependencies["researchCompany"],
  enrich: PipelineDependencies["enrichCompany"],
): Promise<"enriched" | "skipped"> {
  const initialInput = companyMatchInput(company);
  let companyResearch: CompanyResearch | null = null;
  try {
    companyResearch = await run.stage(
      {
        name: "company_research",
        provider: "tavily",
        input: {
          event: event.name,
          company: initialInput,
        },
      },
      () =>
        research({
          name: company.name,
          event: event.name,
          knownWebsite: company.company_url,
        }),
    );
  } catch {
    // Apollo remains a fallback when public-web research fails.
  }

  const researchedWebsite = companyResearch?.company_url ?? null;
  const input = { name: company.name, website: researchedWebsite };
  const knownDomain = researchedWebsite ? extractDomain(researchedWebsite) : null;
  const cached = knownDomain ? run.cachedEnrichment(knownDomain) : null;
  const cacheReference = cached
    ? { source_run_id: cached.runId, source_artifact_id: cached.id }
    : null;
  let providerOutput: unknown = null;
  let apolloError: string | null = null;

  try {
    providerOutput = cached
      ? providerOutputFromCache(cached.output)
      : await run.stage(
          {
            name: "apollo_enrichment",
            ...(knownDomain ? { companyDomain: knownDomain } : {}),
            provider: "apollo",
            input: { event: event.name, company: input },
          },
          () => enrich(input),
        );
  } catch (error) {
    apolloError = error instanceof Error ? error.message : String(error);
  }

  const organization = organizationFrom(providerOutput);
  const researchedCompany = { ...company, company_url: researchedWebsite };
  const apolloMatched =
    organization !== null && isAcceptableMatch(researchedCompany, organization);
  const apolloConflicted = organization !== null && !apolloMatched;
  const companyUrl = researchedWebsite && !apolloConflicted
    ? normalizeCompanyUrl(researchedWebsite)
    : apolloMatched
      ? resolvedCompanyUrl(researchedCompany, organization)
      : null;
  const output = companyUrl
    ? {
        status: "enriched" as const,
        company_url: companyUrl,
        research: companyResearch,
        apollo: {
          status: apolloMatched ? ("success" as const) : apolloError ? ("error" as const) : ("no_match" as const),
          provider_output: providerOutput,
          error: apolloError,
        },
        cache_reference: cacheReference,
      }
    : {
        status: "skipped" as const,
        reason: "company_identity_not_resolved" as const,
        research: companyResearch,
        apollo: {
          status: apolloError ? ("error" as const) : ("no_match" as const),
          provider_output: providerOutput,
          error: apolloError,
        },
      };

  run.completed(
    {
      name: "company_enrichment",
      ...(companyUrl ? { companyDomain: extractDomain(companyUrl) } : {}),
      provider: "coordinator",
      input: { event: event.name, company: input },
    },
    output,
  );
  if (output.status === "skipped") return "skipped";

  const domain = extractDomain(output.company_url);
  run.saveProfile({
    domain,
    companyUrl: output.company_url,
    profile: {
      name: company.name,
      event: event.name,
      company_url: output.company_url,
      research: output.research,
      enrichment: output.apollo.provider_output,
      provider_outcomes: { apollo: output.apollo.status },
      cache_reference: output.cache_reference,
    },
  });
  return "enriched";
}

function companyMatchInput(company: Company): CompanyMatchInput {
  return { name: company.name, website: company.company_url };
}

function organizationFrom(enrichment: unknown): ApolloOrganization | null {
  const response = objectValue(objectValue(enrichment).provider_response);
  const organization = response.organization;
  return typeof organization === "object" && organization !== null
    ? (organization as ApolloOrganization)
    : null;
}

function canonicalCompanyName(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLocaleLowerCase("en-US")
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(?:incorporated|inc|limited|ltd|llc|corp|corporation|company|co)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function isAcceptableMatch(
  company: Company,
  organization: ApolloOrganization,
): boolean {
  const apolloWebsite = organizationWebsite(organization);
  if (
    company.company_url &&
    apolloWebsite &&
    extractDomain(company.company_url) === extractDomain(apolloWebsite)
  ) {
    return true;
  }

  const expected = canonicalCompanyName(company.name);
  const actual = canonicalCompanyName(organization.name);
  if (actual === "") return company.company_url !== null;
  return expected !== "" && expected === actual;
}

function organizationWebsite(organization: ApolloOrganization): string | null {
  if (typeof organization.website_url === "string") {
    try {
      return normalizeCompanyUrl(organization.website_url);
    } catch {
      return null;
    }
  }
  if (typeof organization.primary_domain === "string") {
    try {
      return normalizeCompanyUrl(`https://${organization.primary_domain}`);
    } catch {
      return null;
    }
  }
  return null;
}

function resolvedCompanyUrl(
  company: Company,
  organization: ApolloOrganization | null,
): string | null {
  if (!organization) return null;
  return company.company_url
    ? normalizeCompanyUrl(company.company_url)
    : organizationWebsite(organization);
}

export async function qualifyCompanies(
  run: PipelineRun,
  icp: string,
  qualify: PipelineDependencies["qualifyCompany"],
): Promise<QualificationResult> {
  const assessed: Array<{
    profile: CompanyProfile;
    assessment: CompanyQualification;
  }> = [];
  let failedQualifications = 0;

  for (const profile of run.profiles()) {
    try {
      const assessment = await run.stage(
        {
          name: "company_qualification",
          companyDomain: profile.domain,
          provider: "google",
          input: { icp, company: profile.profile },
        },
        () => qualify({ icp, company: profile.profile }),
      );
      assessed.push({ profile, assessment });
    } catch {
      failedQualifications += 1;
    }
  }

  assessed.sort(
    (left, right) =>
      qualificationRank(right.assessment) - qualificationRank(left.assessment),
  );
  const rankedCompanies = assessed.map(({ profile, assessment }, index) => {
    const rank = index + 1;
    run.saveProfile({
      domain: profile.domain,
      companyUrl: profile.companyUrl,
      profile: {
        ...objectValue(profile.profile),
        qualification: assessment,
        rank,
      },
    });
    return {
      rank,
      domain: profile.domain,
      companyName: profileName(profile),
      fit: assessment.fit,
      confidence: assessment.confidence,
    };
  });

  return {
    qualifiedCompanies: assessed.length,
    failedQualifications,
    rankedCompanies,
  };
}

const ratingRank = { high: 3, medium: 2, low: 1 } as const;

function qualificationRank(assessment: CompanyQualification): number {
  return ratingRank[assessment.fit] * 10 + ratingRank[assessment.confidence];
}

function providerOutputFromCache(output: unknown): unknown {
  const value = objectValue(output);
  if (value.status !== "enriched") return output;
  if ("provider_output" in value) return value.provider_output;
  const apollo = objectValue(value.apollo);
  return "provider_output" in apollo ? apollo.provider_output : output;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function profileName(profile: CompanyProfile): string {
  const name = objectValue(profile.profile).name;
  return typeof name === "string" ? name : profile.domain;
}
