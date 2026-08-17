import * as cheerio from "cheerio";

import { PipelineDatabase } from "./pipeline-database.ts";
import { runStageProbe } from "./stage-probe.ts";

const MAX_COMPANIES = 10;

async function fetchDirectory(directoryUrl: string): Promise<string> {
  const response = await fetch(directoryUrl);
  if (!response.ok) {
    throw new Error(
      `Could not fetch exhibitor directory: ${response.status} ${response.statusText}`,
    );
  }

  return response.text();
}

function createCompany(
  name: string,
  booth: string,
  profilePath: string | undefined,
  directoryUrl: string,
) {
  return {
    name,
    booth: booth || null,
    profile_url: profilePath ? new URL(profilePath, directoryUrl).href : null,
    company_url: null as string | null,
    attendance_evidence: {
      type: "official_exhibitor_directory",
      url: directoryUrl,
    },
  };
}

function extractProfileDirectory($: cheerio.CheerioAPI, directoryUrl: string) {
  return $("a.exhibitorName")
    .slice(0, MAX_COMPANIES)
    .map((_, element) => {
      const link = $(element);
      const booth = link
        .closest("tr")
        .find("a.boothLabel")
        .first()
        .text()
        .trim();

      return createCompany(
        link.text().trim(),
        booth,
        link.attr("href"),
        directoryUrl,
      );
    })
    .get();
}

function extractExhibitorTable($: cheerio.CheerioAPI, directoryUrl: string) {
  const table = $("table")
    .filter((_, element) => {
      const headers = $(element)
        .find("thead th")
        .map((__, header) => $(header).text().trim())
        .get();

      return (
        /company|exhibitor|organization/i.test(headers[0] ?? "") &&
        /booth|exhibit space|stand/i.test(headers[1] ?? "")
      );
    })
    .first();

  return table
    .find("tbody tr")
    .slice(0, MAX_COMPANIES)
    .map((_, element) => {
      const cells = $(element).find("td");
      const nameCell = cells.eq(0);
      const link = nameCell.find("a").first();

      return createCompany(
        nameCell.text().trim(),
        cells.eq(1).text().trim(),
        link.attr("href"),
        directoryUrl,
      );
    })
    .get()
    .filter(({ name }) => name.length > 0);
}

function extractCompanies(html: string, directoryUrl: string) {
  const $ = cheerio.load(html);
  const profileCompanies = extractProfileDirectory($, directoryUrl);

  return profileCompanies.length > 0
    ? profileCompanies
    : extractExhibitorTable($, directoryUrl);
}

function parseHttpUrl(value: string, baseUrl: string): string | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function extractCompanyUrl(html: string, profileUrl: string): string | null {
  const $ = cheerio.load(html);
  const websiteLink = $("a.aa-BoothContactUrl").first();
  const displayedUrl = parseHttpUrl(websiteLink.text().trim(), profileUrl);

  if (displayedUrl) {
    return displayedUrl;
  }

  const href = websiteLink.attr("href");
  const linkedUrl = href ? parseHttpUrl(href, profileUrl) : null;
  if (!linkedUrl) {
    return null;
  }

  return new URL(linkedUrl).hostname === new URL(profileUrl).hostname
    ? null
    : linkedUrl;
}

async function addCompanyUrl<T extends { profile_url: string | null }>(
  company: T,
): Promise<T> {
  if (!company.profile_url) {
    return company;
  }

  try {
    const html = await fetchDirectory(company.profile_url);
    return {
      ...company,
      company_url: extractCompanyUrl(html, company.profile_url),
    };
  } catch {
    return company;
  }
}

async function findCompanies(event: string, directoryUrl: string) {
  const html = await fetchDirectory(directoryUrl);
  const companies = extractCompanies(html, directoryUrl);

  return {
    sourced_at: new Date().toISOString(),
    event: {
      name: event,
      exhibitor_directory_url: directoryUrl,
    },
    companies: await Promise.all(companies.map(addCompanyUrl)),
  };
}

async function main(): Promise<void> {
  const [event, directoryUrl, ...extraArguments] = process.argv.slice(2);
  if (!event || !directoryUrl || extraArguments.length > 0) {
    console.error(
      'Usage: npm run company-sourcing -- "<event name>" "<official exhibitor directory URL>"',
    );
    process.exitCode = 2;
    return;
  }

  const database = new PipelineDatabase(process.env.PIPELINE_DATABASE_PATH);
  try {
    const { runId, output } = await runStageProbe(database, {
      stage: "company_sourcing",
      label: `Company sourcing: ${event}`,
      input: { event, directory_url: directoryUrl },
      execute: () => findCompanies(event, directoryUrl),
    });

    if (output.companies.length === 0) {
      console.error("The directory did not contain any recognizable exhibitors.");
      process.exitCode = 1;
      return;
    }

    console.log(
      `Saved ${output.companies.length} candidate companies to SQLite run ${runId}`,
    );
  } finally {
    database.close();
  }
}

await main();
