export type ICPFormInput = {
  offering: string;
  targetCompanies: string;
  applications: string;
  strongFitSignals?: string;
  companySize?: string;
  geography?: string;
  exclusions?: string;
  idealCompany?: string;
  idealCompanyReason?: string;
};

export type ICPSnapshot = {
  version: 1;
  criteria: ICPFormInput;
  text: string;
};

export const DUPONT_TEDLAR_ICP: ICPFormInput = {
  offering:
    "DuPont Tedlar transparent PVF clear protective overlaminate film for indoor and outdoor graphics and signage",
  targetCompanies:
    "Scaled manufacturers and converters of graphic films, overlaminates, signage materials, vehicle-wrap materials, and durable finished graphics",
  applications:
    "Outdoor signs and business logos, billboards, building murals, fleet and vehicle graphics, traffic or utility box wraps, and architectural graphics",
  strongFitSignals:
    "Products exposed to harsh UV, moisture, weather, graffiti, dirt, chemicals, fading, or corrosion; frequent cleaning or costly replacement needs; and active development of premium durable graphic products",
  companySize:
    "Established companies with meaningful commercial scale and distribution",
  geography: "No geographic restriction",
  exclusions:
    "Companies with no graphics or signage offering, no need for a protective overlaminate, or only short-term indoor applications",
  idealCompany: "Avery Dennison Graphics Solutions",
  idealCompanyReason:
    "It supplies large-format signage, vehicle-wrap, and architectural-graphics materials at global scale and develops durable, weather-resistant graphic films",
};

export function buildICPSnapshot(input: ICPFormInput): ICPSnapshot {
  const criteria = cleanInput(input);
  const missing = [
    ["offering", criteria.offering],
    ["target companies", criteria.targetCompanies],
    ["applications", criteria.applications],
  ]
    .filter(([, value]) => !value)
    .map(([label]) => label);

  if (missing.length > 0) {
    throw new Error(`Complete the required fields: ${missing.join(", ")}.`);
  }

  return { version: 1, criteria, text: renderICPMarkdown(criteria) };
}

function cleanInput(input: ICPFormInput): ICPFormInput {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value?.trim() ?? ""]),
  ) as ICPFormInput;
}

export function renderICPMarkdown(criteria: ICPFormInput): string {
  const core = `# Ideal Customer Profile

## Offering
${criteria.offering}

## Ideal customers
${criteria.targetCompanies}

## Target applications
${criteria.applications}`;

  const qualificationCriteria = [
    markdownSection("Strong-fit signals", criteria.strongFitSignals, 3),
    markdownSection("Company size", criteria.companySize, 3),
    markdownSection("Geography", criteria.geography, 3),
    markdownSection("Exclusions", criteria.exclusions, 3),
  ].filter(Boolean);

  const blocks = [core];
  if (qualificationCriteria.length > 0) {
    blocks.push(`## Qualification criteria\n\n${qualificationCriteria.join("\n\n")}`);
  }

  if (criteria.idealCompany) {
    const reason = criteria.idealCompanyReason
      ? `\n\n${criteria.idealCompanyReason}`
      : "";
    blocks.push(`## Representative ideal company\n\n**${criteria.idealCompany}**${reason}`);
  }

  return blocks.join("\n\n");
}

function markdownSection(
  heading: string,
  value: string | undefined,
  level: 2 | 3,
): string {
  return value ? `${"#".repeat(level)} ${heading}\n${value}` : "";
}
