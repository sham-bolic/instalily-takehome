import type {
  CompanyProfile,
  Run,
  StageArtifact,
} from "../../backend/prototypes/pipeline-database.ts";

export type LeadView = {
  domain: string;
  companyUrl: string;
  name: string;
  event: string;
  rank: number | null;
  fit: string | null;
  confidence: string | null;
  rationale: string | null;
  evidence: string[];
  employeeCount: number | null;
  revenue: string | null;
};

export type EventView = {
  name: string;
  summary: string | null;
  discoveryUrl: string | null;
  relevanceScore: number | null;
  companySourceType: string | null;
  companySourceUrl: string | null;
  selectedForSourcing: boolean;
};

export type EnrichmentStatus =
  | "enriched"
  | "not_enriched"
  | "failed"
  | "not_attempted";

export type SourcedCompanyView = {
  key: string;
  name: string;
  event: string;
  booth: string | null;
  profileUrl: string | null;
  companyUrl: string | null;
  evidenceUrl: string | null;
  enrichmentStatus: EnrichmentStatus;
  enrichmentDetail: string | null;
};

export type PipelineInventory = {
  events: EventView[];
  companies: SourcedCompanyView[];
};

export type DashboardData = {
  runs: Run[];
  selectedRun: Run | null;
  artifacts: StageArtifact[];
  leads: LeadView[];
  selectedICPId: number | null;
};

export function toPipelineInventory(
  artifacts: StageArtifact[],
  profiles: CompanyProfile[],
): PipelineInventory {
  const sourcedEventNames = new Set<string>();
  const eventsByKey = new Map<string, EventView>();
  const companiesByKey = new Map<string, SourcedCompanyView>();
  const enrichmentByCompany = new Map<
    string,
    Pick<SourcedCompanyView, "enrichmentStatus" | "enrichmentDetail">
  >();

  for (const artifact of artifacts) {
    const output = objectValue(artifact.output);
    if (artifact.stage === "company_sourcing" && artifact.status === "completed") {
      const sourcedEvent = objectValue(output.event);
      const eventName = text(sourcedEvent.name) ?? "Event not recorded";
      sourcedEventNames.add(normalize(eventName));
      for (const candidate of objectArray(output.companies)) {
        const name = text(candidate.name);
        if (!name) continue;
        const evidence = objectValue(candidate.attendance_evidence);
        const key = companyKey(eventName, name);
        if (!companiesByKey.has(key)) {
          companiesByKey.set(key, {
            key,
            name,
            event: eventName,
            booth: text(candidate.booth),
            profileUrl: safeHttpUrl(candidate.profile_url),
            companyUrl: safeHttpUrl(candidate.company_url),
            evidenceUrl:
              safeHttpUrl(evidence.url) ??
              safeHttpUrl(sourcedEvent.exhibitor_directory_url),
            enrichmentStatus: "not_attempted",
            enrichmentDetail: null,
          });
        }
      }
    }

    if (artifact.stage === "company_enrichment") {
      const input = objectValue(artifact.input);
      const company = objectValue(input.company);
      const name = text(company.name);
      if (!name) continue;
      const key = companyKey(text(input.event) ?? "Event not recorded", name);
      if (artifact.status === "failed") {
        enrichmentByCompany.set(key, {
          enrichmentStatus: "failed",
          enrichmentDetail: artifact.error,
        });
      } else if (text(output.status) === "enriched") {
        enrichmentByCompany.set(key, {
          enrichmentStatus: "enriched",
          enrichmentDetail: null,
        });
      } else if (text(output.status) === "skipped") {
        enrichmentByCompany.set(key, {
          enrichmentStatus: "not_enriched",
          enrichmentDetail: readableReason(text(output.reason)),
        });
      }
    }
  }

  for (const artifact of artifacts) {
    if (artifact.stage !== "event_sourcing" || artifact.status !== "completed")
      continue;
    const output = objectValue(artifact.output);
    for (const candidate of objectArray(output.events)) {
      const name = text(candidate.name);
      if (!name) continue;
      const source = objectValue(candidate.company_source);
      const key = normalize(name);
      const view: EventView = {
        name,
        summary: text(candidate.summary),
        discoveryUrl: safeHttpUrl(candidate.discovery_url),
        relevanceScore: finiteNumber(candidate.relevance_score),
        companySourceType: text(source.type),
        companySourceUrl: safeHttpUrl(source.url),
        selectedForSourcing: sourcedEventNames.has(key),
      };
      const existing = eventsByKey.get(key);
      if (
        !existing ||
        (view.relevanceScore ?? -1) > (existing.relevanceScore ?? -1)
      ) {
        eventsByKey.set(key, view);
      }
    }
  }

  const enrichedProfileKeys = new Set(
    profiles.map((profile) => {
      const value = objectValue(profile.profile);
      return companyKey(
        text(value.event) ?? "Event not recorded",
        text(value.name) ?? profile.domain,
      );
    }),
  );
  const companies = [...companiesByKey.values()].map((company) => ({
    ...company,
    ...(enrichmentByCompany.get(company.key) ??
      (enrichedProfileKeys.has(company.key)
        ? { enrichmentStatus: "enriched" as const, enrichmentDetail: null }
        : {})),
  }));

  return {
    events: [...eventsByKey.values()].sort(
      (left, right) =>
        (right.relevanceScore ?? -1) - (left.relevanceScore ?? -1),
    ),
    companies,
  };
}

export function toLeadView(profile: CompanyProfile): LeadView {
  const value = objectValue(profile.profile);
  const qualification = objectValue(value.qualification);
  const enrichment = objectValue(value.enrichment);
  const providerResponse = objectValue(enrichment.provider_response);
  const organization = objectValue(providerResponse.organization);

  return {
    domain: profile.domain,
    companyUrl: profile.companyUrl,
    name: text(value.name) ?? text(organization.name) ?? profile.domain,
    event: text(value.event) ?? "Event not recorded",
    rank: finiteNumber(value.rank),
    fit: text(qualification.fit),
    confidence: text(qualification.confidence),
    rationale: text(qualification.rationale),
    evidence: stringArray(qualification.evidence),
    employeeCount:
      finiteNumber(organization.estimated_num_employees) ??
      finiteNumber(organization.employee_count),
    revenue:
      text(organization.annual_revenue_printed) ??
      formatRevenue(finiteNumber(organization.annual_revenue)),
  };
}

export function selectedICPIdFromRun(run: Run | null): number | null {
  const input = objectValue(run?.rootInput);
  return finiteNumber(input.icp_id);
}

function companyKey(event: string, company: string): string {
  return `${normalize(event)}:${normalize(company)}`;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(objectValue) : [];
}

function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function readableReason(value: string | null): string | null {
  if (!value) return null;
  if (value === "apollo_organization_not_resolved") return "No provider match";
  return value.replaceAll("_", " ");
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function formatRevenue(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
