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

  const lines = [
    `Offering: ${criteria.offering}`,
    `Ideal customers: ${criteria.targetCompanies}`,
    `Target applications: ${criteria.applications}`,
  ];

  addLine(lines, "Strong-fit signals", criteria.strongFitSignals);
  addLine(lines, "Company size", criteria.companySize);
  addLine(lines, "Geography", criteria.geography);
  addLine(lines, "Exclusions", criteria.exclusions);

  if (criteria.idealCompany) {
    const reason = criteria.idealCompanyReason
      ? ` because ${criteria.idealCompanyReason}`
      : "";
    lines.push(
      `Representative ideal company: ${criteria.idealCompany}${reason}`,
    );
  }

  return { version: 1, criteria, text: lines.join("\n") };
}

function cleanInput(input: ICPFormInput): ICPFormInput {
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => [key, value?.trim() ?? ""]),
  ) as ICPFormInput;
}

function addLine(
  lines: string[],
  label: string,
  value: string | undefined,
): void {
  if (value) lines.push(`${label}: ${value}`);
}
