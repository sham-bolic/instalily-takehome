import { extractDomain } from "./company-enrichment.ts";
import { findCompanies } from "./company-sourcing.ts";
import {
  type CompanyQualifier,
  type QualificationAssessment,
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

export type PipelineDependencies = {
  findEvents: (icp: string) => Promise<EventDiscovery>;
  findCompanies: (event: string, directoryUrl: string) => Promise<CompanySourcing>;
  enrichCompany: (companyUrl: string) => Promise<Enrichment>;
  qualifyCompany: CompanyQualifier;
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
  fit: QualificationAssessment["fit"];
  confidence: QualificationAssessment["confidence"];
  score: number;
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
    } catch {
      // The failed artifact is persisted. Try the next event.
    }
  }

  throw new Error("No qualifying event had a usable company directory.");
}

export async function enrichCompanies(
  run: PipelineRun,
  event: Event,
  companies: Company[],
  limit: number,
  enrich: PipelineDependencies["enrichCompany"],
): Promise<EnrichmentCounts> {
  const missingUrls = companies.filter((company) => company.company_url === null);
  for (const company of missingUrls) {
    run.completed(
      { name: "company_enrichment", input: { event: event.name, company } },
      { status: "skipped", reason: "missing_company_url" },
    );
  }

  const enrichable = companies
    .filter(
      (company): company is Company & { company_url: string } =>
        company.company_url !== null,
    )
    .slice(0, limit);
  let enrichedCompanies = 0;
  let failedEnrichments = 0;

  for (const company of enrichable) {
    try {
      await enrichOneCompany(run, event, company, enrich);
      enrichedCompanies += 1;
    } catch {
      failedEnrichments += 1;
    }
  }

  return {
    enrichedCompanies,
    skippedCompanies: missingUrls.length,
    failedEnrichments,
  };
}

async function enrichOneCompany(
  run: PipelineRun,
  event: Event,
  company: Company & { company_url: string },
  enrich: PipelineDependencies["enrichCompany"],
): Promise<void> {
  const domain = extractDomain(company.company_url);
  const cached = run.cachedEnrichment(domain);
  const cacheReference = cached
    ? { source_run_id: cached.runId, source_artifact_id: cached.id }
    : null;
  const output = await run.stage(
    {
      name: "company_enrichment",
      companyDomain: domain,
      provider: "apollo",
      input: {
        event: event.name,
        company_name: company.name,
        domain,
        website: company.company_url,
      },
    },
    async () => ({
      status: "enriched",
      cache_reference: cacheReference,
      provider_output: cached
        ? providerOutputFromCache(cached.output)
        : await enrich(company.company_url),
    }),
  );

  run.saveProfile({
    domain,
    companyUrl: company.company_url,
    profile: {
      name: company.name,
      event: event.name,
      company_url: company.company_url,
      enrichment: output.provider_output,
      cache_reference: cacheReference,
    },
  });
}

export async function qualifyCompanies(
  run: PipelineRun,
  icp: string,
  qualifier: CompanyQualifier,
): Promise<QualificationResult> {
  const assessed: Array<{
    profile: CompanyProfile;
    assessment: QualificationAssessment;
  }> = [];
  let failedQualifications = 0;

  for (const profile of run.profiles()) {
    try {
      const assessment = await run.stage(
        {
          name: "company_qualification",
          companyDomain: profile.domain,
          provider: qualifier.provider,
          input: { icp, company: profile.profile },
        },
        () => qualifier.assess({ icp, company: profile.profile }),
      );
      assessed.push({ profile, assessment });
    } catch {
      failedQualifications += 1;
    }
  }

  assessed.sort(
    (left, right) =>
      right.assessment.calculatedScore - left.assessment.calculatedScore,
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
      score: assessment.calculatedScore,
    };
  });

  return {
    qualifiedCompanies: assessed.length,
    failedQualifications,
    rankedCompanies,
  };
}

function providerOutputFromCache(output: unknown): unknown {
  if (
    typeof output === "object" &&
    output !== null &&
    "status" in output &&
    output.status === "enriched" &&
    "provider_output" in output
  ) {
    return output.provider_output;
  }
  return output;
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
