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

export type DashboardData = {
  runs: Run[];
  selectedRun: Run | null;
  artifacts: StageArtifact[];
  leads: LeadView[];
  selectedICPId: number | null;
};

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
