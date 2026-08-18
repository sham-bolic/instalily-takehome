import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

import { enrichCompany } from "./company-enrichment.ts";
import { qualifyCompany } from "./company-qualification.ts";
import { researchCompany } from "./company-research.ts";
import { findCompanies } from "./company-sourcing.ts";
import { findEvents } from "./event-sourcing.ts";
import {
  buildICPSnapshot,
  DUPONT_TEDLAR_ICP,
  type ICPFormInput,
} from "./icp-builder.ts";
import {
  PipelineDatabase,
  type CompanyProfile,
  type Run,
  type SavedICP,
  type StageArtifact,
} from "./pipeline-database.ts";
import { startPipeline } from "./pipeline.ts";

const DEFAULT_PORT = 4173;

type DashboardRunStarter = (
  database: PipelineDatabase,
  icp: SavedICP,
) => number;

export function createDashboardServer(
  database: PipelineDatabase,
  startRun: DashboardRunStarter = startLiveRun,
): Server {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");

      if (request.method === "POST" && url.pathname === "/icps") {
        const values = await readForm(request);
        const icpInput = readICPInput(values);
        try {
          const snapshot = buildICPSnapshot(icpInput);
          const icpId = database.createICP({
            name: values.get("name") ?? "",
            snapshot,
          });
          redirect(response, `/?icp=${icpId}`);
        } catch (error) {
          sendHtml(
            response,
            400,
            dashboardView(database, url, {
              icpInput,
              icpName: values.get("name") ?? "",
              icpError: errorMessage(error, "Could not create the ICP."),
              showICPForm: true,
            }),
          );
        }
        return;
      }

      if (request.method === "POST" && url.pathname === "/runs") {
        const values = await readForm(request);
        const icpId = parsePositiveId(values.get("icpId"), "ICP ID");
        const icp = database.getICP(icpId);
        if (!icp) {
          sendHtml(
            response,
            404,
            renderMessage(
              `ICP ${icpId} was not found`,
              "Choose an existing ICP.",
            ),
          );
          return;
        }
        const runId = startRun(database, icp);
        redirect(response, `/?run=${runId}&icp=${icpId}`);
        return;
      }

      if (request.method !== "GET" || url.pathname !== "/") {
        sendHtml(
          response,
          404,
          renderMessage("Page not found", "Return to the dashboard."),
        );
        return;
      }

      const requestedRunId = parseRunId(url.searchParams.get("run"));
      if (requestedRunId !== null && database.getRun(requestedRunId) === null) {
        sendHtml(
          response,
          404,
          renderMessage(
            `Run ${requestedRunId} was not found`,
            "Choose an existing run from the dashboard.",
          ),
        );
        return;
      }
      const requestedICP = url.searchParams.get("icp");
      if (requestedICP !== null) {
        const requestedICPId = parsePositiveId(requestedICP, "ICP ID");
        if (database.getICP(requestedICPId) === null) {
          sendHtml(
            response,
            404,
            renderMessage(
              `ICP ${requestedICPId} was not found`,
              "Choose an existing ICP.",
            ),
          );
          return;
        }
      }

      sendHtml(response, 200, dashboardView(database, url));
    } catch (error) {
      const message = errorMessage(error, "Unknown error");
      const status = message.includes("ID must be") ? 400 : 500;
      sendHtml(response, status, renderMessage("Dashboard error", message));
    }
  });
}

function dashboardView(
  database: PipelineDatabase,
  url: URL,
  form: {
    icpInput?: ICPFormInput;
    icpName?: string;
    icpError?: string | null;
    showICPForm?: boolean;
  } = {},
): string {
  const runs = database.listRuns().toReversed();
  const requestedRunId = parseRunId(url.searchParams.get("run"));
  const selectedRun =
    requestedRunId === null
      ? (runs[0] ?? null)
      : database.getRun(requestedRunId);
  if (requestedRunId !== null && selectedRun === null) {
    throw new Error(`Run ${requestedRunId} was not found.`);
  }

  const icps = database.listICPs();
  const requestedICPId =
    url.searchParams.get("icp") === null
      ? null
      : parsePositiveId(url.searchParams.get("icp"), "ICP ID");
  const selectedICP =
    requestedICPId === null
      ? (icps.at(-1) ?? null)
      : database.getICP(requestedICPId);

  return renderDashboard({
    runs,
    selectedRun,
    artifacts: selectedRun ? database.listStageArtifacts(selectedRun.id) : [],
    profiles: selectedRun ? database.listCompanyProfiles(selectedRun.id) : [],
    icps,
    selectedICP,
    icpInput: form.icpInput ?? DUPONT_TEDLAR_ICP,
    icpName: form.icpName ?? "DuPont Tedlar Graphics & Signage",
    icpError: form.icpError ?? null,
    showICPForm: form.showICPForm ?? url.searchParams.get("new-icp") === "1",
  });
}

async function readForm(
  request: import("node:http").IncomingMessage,
): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
    if (body.length > 50_000) throw new Error("Form submission is too large.");
  }
  return new URLSearchParams(body);
}

function readICPInput(values: URLSearchParams): ICPFormInput {
  const value = (name: keyof ICPFormInput): string => values.get(name) ?? "";
  return {
    offering: value("offering"),
    targetCompanies: value("targetCompanies"),
    applications: value("applications"),
    strongFitSignals: value("strongFitSignals"),
    companySize: value("companySize"),
    geography: value("geography"),
    exclusions: value("exclusions"),
    idealCompany: value("idealCompany"),
    idealCompanyReason: value("idealCompanyReason"),
  };
}

function startLiveRun(database: PipelineDatabase, icp: SavedICP): number {
  const tavilyApiKey = process.env.TAVILY_API_KEY;
  const apolloApiKey = process.env.APOLLO_API_KEY;
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!tavilyApiKey || !apolloApiKey || !geminiApiKey) {
    throw new Error(
      "Set the Tavily, Apollo, and Gemini API keys before running the pipeline.",
    );
  }

  const execution = startPipeline(
    database,
    {
      icp: icp.snapshot.text,
      icpId: icp.id,
      icpName: icp.name,
      icpSnapshot: icp.snapshot,
    },
    {
      findEvents: (value) =>
        findEvents(tavilyApiKey, value, icp.snapshot.criteria),
      findCompanies,
      researchCompany: (company) => researchCompany(tavilyApiKey, company),
      enrichCompany: (company) => enrichCompany(apolloApiKey, company),
      qualifyCompany: (input) => qualifyCompany(geminiApiKey, input),
    },
  );
  void execution.completion.catch((error) => {
    console.error(
      `Pipeline run ${execution.runId} failed:`,
      errorMessage(error, "Unknown error"),
    );
  });
  return execution.runId;
}

function redirect(
  response: import("node:http").ServerResponse,
  location: string,
): void {
  response.writeHead(303, { location });
  response.end();
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function renderICPBuilder(
  input: ICPFormInput,
  name: string,
  error: string | null,
): string {
  return `
    <section class="panel icp-builder">
      <div class="builder-heading">
        <div class="builder-summary">
          <span class="builder-icon">＋</span>
          <div>
            <p class="eyebrow">Ideal customer profile</p>
            <h2>Add an ICP</h2>
            <p class="subtitle">Save a reusable target profile for future pipeline runs.</p>
          </div>
        </div>
        <a class="button" href="/">Cancel</a>
      </div>
      <div class="builder-content">
        ${error ? `<div class="error"><strong>ICP not created</strong><p>${escapeHtml(error)}</p></div>` : ""}
        <form method="post" action="/icps" class="icp-form">
          <label class="field"><span>ICP name *</span><input name="name" value="${escapeHtml(name)}" required></label>
          ${textField("offering", "Product or offering", input.offering, true)}
          ${textField("targetCompanies", "Target companies", input.targetCompanies, true)}
          ${textField("applications", "Applications or use cases", input.applications, true)}
          ${textField("strongFitSignals", "Strong-fit signals", input.strongFitSignals)}
          <div class="form-row">
            ${textField("companySize", "Company size", input.companySize)}
            ${textField("geography", "Geography", input.geography)}
          </div>
          ${textField("exclusions", "Exclusions", input.exclusions)}
          <div class="form-row">
            ${textField("idealCompany", "Example ideal company", input.idealCompany)}
            ${textField("idealCompanyReason", "Why it fits", input.idealCompanyReason)}
          </div>
          <button class="primary-button" type="submit">Save ICP</button>
        </form>
      </div>
    </section>`;
}

function renderPipelineLauncher(
  icps: SavedICP[],
  selectedICP: SavedICP | null,
): string {
  if (icps.length === 0) {
    return `
      <section class="panel launcher empty-launcher">
        <div><p class="eyebrow">Pipeline target</p><h2>No ICPs yet</h2><p class="subtitle">Create an ICP before starting a pipeline run.</p></div>
        <a class="primary-link" href="/?new-icp=1">Add New ICP</a>
      </section>`;
  }

  return `
    <section class="panel launcher">
      <div>
        <p class="eyebrow">Pipeline target</p>
        <h2>Run lead qualification</h2>
        <p class="subtitle">Choose a saved ICP. The full pipeline will run and save every stage to SQLite.</p>
      </div>
      <form method="post" action="/runs" class="run-form">
        <label class="select-field"><span>Ideal customer profile</span><select name="icpId" required onchange="location.href='/?icp='+encodeURIComponent(this.value)">${icps.map((icp) => `<option value="${icp.id}"${icp.id === selectedICP?.id ? " selected" : ""}>${escapeHtml(icp.name)}</option>`).join("")}</select></label>
        <button class="primary-button" type="submit">Run pipeline</button>
        <a class="button" href="/?new-icp=1">Add New ICP</a>
      </form>
      ${selectedICP ? `<details class="selected-icp"><summary>Review ${escapeHtml(selectedICP.name)}</summary><pre>${escapeHtml(selectedICP.snapshot.text)}</pre></details>` : ""}
    </section>`;
}

function textField(
  name: keyof ICPFormInput,
  label: string,
  value: string | undefined,
  required = false,
): string {
  return `<label class="field"><span>${escapeHtml(label)}${required ? " *" : ""}</span><textarea name="${name}" rows="2" ${required ? "required" : ""}>${escapeHtml(value ?? "")}</textarea></label>`;
}

function parseRunId(value: string | null): number | null {
  return value === null ? null : parsePositiveId(value, "Run ID");
}

function parsePositiveId(value: string | null, label: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(
      `${label} must be a positive integer: ${value ?? "missing"}`,
    );
  }
  return id;
}

function renderDashboard({
  runs,
  selectedRun,
  artifacts,
  profiles,
  icps,
  selectedICP,
  icpInput,
  icpName,
  icpError,
  showICPForm,
}: {
  runs: Run[];
  selectedRun: Run | null;
  artifacts: StageArtifact[];
  profiles: CompanyProfile[];
  icps: SavedICP[];
  selectedICP: SavedICP | null;
  icpInput: ICPFormInput;
  icpName: string;
  icpError: string | null;
  showICPForm: boolean;
}): string {
  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => run.status === "failed").length;
  const refreshParams = new URLSearchParams();
  if (selectedRun) refreshParams.set("run", String(selectedRun.id));
  if (selectedICP) refreshParams.set("icp", String(selectedICP.id));
  const refreshUrl = refreshParams.size > 0 ? `/?${refreshParams}` : "/";

  return page(
    "Pipeline observability",
    `
    <header class="topbar">
      <div>
        <p class="eyebrow">DuPont Tedlar</p>
        <h1>Lead intelligence</h1>
        <p class="subtitle">Build the target profile, monitor sourcing, and review qualified companies.</p>
      </div>
      <a class="button" href="${refreshUrl}">Refresh data</a>
    </header>

    ${renderPipelineLauncher(icps, selectedICP)}
    ${showICPForm ? renderICPBuilder(icpInput, icpName, icpError) : ""}

    <section class="metrics" aria-label="Database summary">
      ${metric("Runs", runs.length)}
      ${metric("Completed", completed)}
      ${metric("Failed", failed)}
      ${metric("Profiles in view", profiles.length)}
    </section>

    <div class="layout">
      <aside class="panel run-list">
        <div class="panel-heading">
          <div><p class="eyebrow">History</p><h2>Runs</h2></div>
          <span class="count">${runs.length}</span>
        </div>
        ${runs.length === 0 ? emptyRuns() : runs.map((run) => renderRunLink(run, selectedRun?.id)).join("")}
      </aside>

      <main class="content">
        ${selectedRun ? renderRun(selectedRun, artifacts, profiles) : emptyDatabase()}
      </main>
    </div>
    ${selectedRun?.status === "running" ? `<script>setTimeout(() => location.reload(), 2000)</script>` : ""}
  `,
  );
}

function renderRun(
  run: Run,
  artifacts: StageArtifact[],
  profiles: CompanyProfile[],
): string {
  return `
    <section class="panel run-header">
      <div class="run-title">
        <div>
          <p class="eyebrow">Selected run #${run.id}</p>
          <h2>${escapeHtml(run.label ?? titleCase(run.mode))}</h2>
        </div>
        ${statusBadge(run.status)}
      </div>
      <dl class="metadata">
        ${definition("Mode", run.mode)}
        ${definition("Started", formatTime(run.startedAt))}
        ${definition("Finished", run.finishedAt ? formatTime(run.finishedAt) : "In progress")}
        ${definition("Duration", duration(run.startedAt, run.finishedAt))}
      </dl>
      ${run.error ? `<div class="error"><strong>Run error</strong><p>${escapeHtml(run.error)}</p></div>` : ""}
      ${jsonDetails("Root input", run.rootInput)}
    </section>

    <section class="section-heading">
      <div><p class="eyebrow">Pipeline trace</p><h2>Stage artifacts</h2></div>
      <span class="count">${artifacts.length}</span>
    </section>
    ${artifacts.length === 0 ? emptyCard("No stage artifacts have been recorded for this run.") : `<div class="artifact-list">${artifacts.map(renderArtifact).join("")}</div>`}

    <section class="section-heading profiles-heading">
      <div><p class="eyebrow">Assembled data</p><h2>Company profiles</h2></div>
      <span class="count">${profiles.length}</span>
    </section>
    ${profiles.length === 0 ? emptyCard("No company profiles have been assembled for this run.") : `<div class="profile-grid">${profiles.map(renderProfile).join("")}</div>`}
  `;
}

function renderRunLink(run: Run, selectedRunId: number | undefined): string {
  return `
    <a class="run-link ${run.id === selectedRunId ? "selected" : ""}" href="/?run=${run.id}">
      <div class="run-link-top"><strong>#${run.id} ${escapeHtml(run.label ?? titleCase(run.mode))}</strong>${statusDot(run.status)}</div>
      <span>${escapeHtml(formatTime(run.startedAt))}</span>
      <small>${escapeHtml(run.mode)}</small>
    </a>`;
}

function renderArtifact(artifact: StageArtifact): string {
  return `
    <article class="panel artifact">
      <div class="artifact-summary">
        <div class="stage-index">${artifact.id}</div>
        <div class="artifact-title">
          <h3>${escapeHtml(titleCase(artifact.stage))}</h3>
          <p>${escapeHtml(artifact.companyDomain ?? "Run-level artifact")}</p>
        </div>
        <div class="artifact-meta">
          ${artifact.provider ? `<span class="provider">${escapeHtml(artifact.provider)}</span>` : ""}
          ${statusBadge(artifact.status)}
        </div>
      </div>
      <dl class="metadata compact">
        ${definition("Started", formatTime(artifact.startedAt))}
        ${definition("Duration", duration(artifact.startedAt, artifact.finishedAt))}
      </dl>
      ${artifact.error ? `<div class="error"><strong>Stage error</strong><p>${escapeHtml(artifact.error)}</p></div>` : ""}
      <div class="json-row">
        ${jsonDetails("Input", artifact.input)}
        ${jsonDetails("Output", artifact.output)}
      </div>
    </article>`;
}

function renderProfile(profile: CompanyProfile): string {
  const name = profileName(profile.profile) ?? profile.domain;
  const companyUrl = safeExternalUrl(profile.companyUrl);
  return `
    <article class="panel profile">
      <div class="profile-title">
        <div><p class="eyebrow">${escapeHtml(profile.domain)}</p><h3>${escapeHtml(name)}</h3></div>
        ${companyUrl ? `<a href="${escapeHtml(companyUrl)}" target="_blank" rel="noreferrer">Open site ↗</a>` : ""}
      </div>
      <p class="updated">Updated ${escapeHtml(formatTime(profile.updatedAt))}</p>
      ${jsonDetails("Profile data", profile.profile, true)}
    </article>`;
}

function profileName(profile: unknown): string | null {
  if (typeof profile !== "object" || profile === null || !("name" in profile))
    return null;
  return typeof profile.name === "string" ? profile.name : null;
}

function metric(label: string, value: number): string {
  return `<article class="metric"><span>${escapeHtml(label)}</span><strong>${value}</strong></article>`;
}

function definition(term: string, value: string): string {
  return `<div><dt>${escapeHtml(term)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function jsonDetails(label: string, value: unknown, open = false): string {
  return `<details class="json" ${open ? "open" : ""}><summary>${escapeHtml(label)}</summary><pre>${escapeHtml(JSON.stringify(value, null, 2) ?? "undefined")}</pre></details>`;
}

function statusBadge(status: Run["status"] | StageArtifact["status"]): string {
  return `<span class="badge ${status}">${escapeHtml(titleCase(status))}</span>`;
}

function statusDot(status: Run["status"]): string {
  return `<span class="dot ${status}" title="${escapeHtml(status)}"></span>`;
}

function emptyRuns(): string {
  return `<div class="aside-empty">No runs yet</div>`;
}

function emptyDatabase(): string {
  return `<section class="panel empty-state"><div class="empty-icon">◇</div><h2>No pipeline runs yet</h2><p>Choose an ICP above and run the pipeline. Its progress and saved results will appear here.</p></section>`;
}

function emptyCard(message: string): string {
  return `<div class="panel empty-card">${escapeHtml(message)}</div>`;
}

function renderMessage(title: string, message: string): string {
  return page(
    title,
    `<main class="message panel"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="/">Return to dashboard</a></main>`,
  );
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${styles}</style>
</head>
<body><div class="shell">${body}</div></body>
</html>`;
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function duration(start: string, finish: string | null): string {
  const milliseconds =
    new Date(finish ?? Date.now()).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unknown";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} sec`;
  return `${Math.floor(milliseconds / 60_000)} min ${Math.round((milliseconds % 60_000) / 1_000)} sec`;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}

function sendHtml(
  response: import("node:http").ServerResponse,
  status: number,
  html: string,
): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

const styles = `
:root { color-scheme: light; --ink:#18201c; --muted:#66716b; --line:#dfe5e1; --surface:#fff; --canvas:#f4f6f4; --green:#176b4d; --green-soft:#e7f3ed; --red:#a33c36; --red-soft:#f9eae8; --amber:#8a6116; --amber-soft:#fbf1d9; }
* { box-sizing:border-box; }
body { margin:0; background:var(--canvas); color:var(--ink); font:14px/1.5 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
a { color:var(--green); }
.shell { width:min(1440px,100%); margin:auto; padding:40px; }
.topbar { display:flex; justify-content:space-between; align-items:flex-end; gap:24px; margin-bottom:28px; }
h1,h2,h3,p { margin-top:0; } h1 { margin-bottom:4px; font-size:32px; letter-spacing:-.04em; } h2 { margin:0; font-size:20px; letter-spacing:-.02em; } h3 { margin:0; font-size:16px; }
.eyebrow { margin:0 0 5px; color:var(--green); font-size:11px; font-weight:750; letter-spacing:.11em; text-transform:uppercase; }
.subtitle,.artifact-title p,.updated { margin:0; color:var(--muted); }
.button { display:inline-flex; align-items:center; justify-content:center; padding:9px 14px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); font-weight:650; text-decoration:none; box-shadow:0 1px 2px #18201c0a; }
.launcher { display:grid; grid-template-columns:minmax(240px,1fr) minmax(360px,1.3fr); align-items:center; gap:24px; margin-bottom:20px; padding:20px; }
.run-form { display:flex; align-items:end; justify-content:flex-end; gap:10px; }
.select-field { display:grid; flex:1; gap:5px; color:#4e5a54; font-size:12px; font-weight:700; }
.select-field select { min-height:41px; width:100%; border:1px solid var(--line); border-radius:8px; background:#fafbfa; color:var(--ink); font:inherit; padding:8px 34px 8px 11px; }
.selected-icp { grid-column:1/-1; border-top:1px solid var(--line); padding-top:14px; }
.selected-icp summary { cursor:pointer; color:var(--green); font-weight:700; }
.selected-icp pre { margin-top:10px; border:1px solid var(--line); border-radius:8px; }
.empty-launcher { grid-template-columns:1fr auto; }
.primary-link { padding:10px 16px; border-radius:8px; background:var(--green); color:white; font-weight:700; text-decoration:none; }
.icp-builder { margin-bottom:20px; overflow:hidden; }
.builder-heading { display:flex; justify-content:space-between; align-items:center; gap:20px; padding:18px 20px; }
.builder-summary { display:flex; align-items:center; gap:14px; }
.builder-icon { display:grid; width:38px; height:38px; place-items:center; border-radius:10px; background:var(--green-soft); color:var(--green); font-size:20px; }
.builder-content { padding:20px; border-top:1px solid var(--line); background:#fcfdfc; }
.icp-form { display:grid; gap:12px; margin-top:18px; }
.form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.field { display:grid; gap:5px; color:#4e5a54; font-size:12px; font-weight:700; }
.field textarea,.field input { width:100%; resize:vertical; border:1px solid var(--line); border-radius:8px; background:#fafbfa; color:var(--ink); font:inherit; line-height:1.45; padding:10px 11px; }
.field textarea:focus,.field input:focus,.select-field select:focus { border-color:var(--green); outline:2px solid #176b4d20; }
.primary-button { justify-self:start; border:0; border-radius:8px; background:var(--green); color:white; cursor:pointer; font:inherit; font-weight:700; padding:10px 16px; }
.primary-button:hover { background:#125b41; }
.metrics { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; margin-bottom:20px; }
.metric { display:flex; justify-content:space-between; align-items:center; padding:16px 18px; border:1px solid var(--line); border-radius:10px; background:var(--surface); color:var(--muted); }
.metric strong { color:var(--ink); font-size:22px; }
.layout { display:grid; grid-template-columns:260px minmax(0,1fr); gap:20px; align-items:start; }
.panel { border:1px solid var(--line); border-radius:12px; background:var(--surface); box-shadow:0 1px 2px #18201c08; }
.run-list { position:sticky; top:20px; overflow:hidden; }
.panel-heading,.section-heading,.run-title,.profile-title,.artifact-summary { display:flex; justify-content:space-between; align-items:center; gap:16px; }
.panel-heading { padding:18px; border-bottom:1px solid var(--line); }
.count { display:inline-grid; min-width:26px; height:26px; padding:0 7px; place-items:center; border-radius:20px; background:#edf0ee; color:var(--muted); font-size:12px; font-weight:700; }
.run-link { display:block; padding:14px 18px; border-bottom:1px solid var(--line); color:var(--ink); text-decoration:none; }
.run-link:last-child { border:0; } .run-link:hover,.run-link.selected { background:#f0f6f2; } .run-link.selected { box-shadow:inset 3px 0 var(--green); }
.run-link-top { display:flex; justify-content:space-between; align-items:center; gap:8px; } .run-link span:not(.dot),.run-link small { display:block; color:var(--muted); font-size:12px; }
.dot { width:8px; height:8px; border-radius:50%; background:var(--amber); } .dot.completed { background:var(--green); } .dot.failed { background:var(--red); }
.content { min-width:0; }
.run-header { padding:22px; }
.badge,.provider { display:inline-block; padding:4px 8px; border-radius:20px; font-size:11px; font-weight:750; }
.badge.completed { color:var(--green); background:var(--green-soft); } .badge.failed { color:var(--red); background:var(--red-soft); } .badge.running { color:var(--amber); background:var(--amber-soft); }
.provider { background:#edf0ee; color:#53605a; }
.metadata { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin:20px 0 0; padding-top:18px; border-top:1px solid var(--line); }
.metadata div { min-width:0; } dt { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.06em; } dd { margin:3px 0 0; font-weight:650; overflow-wrap:anywhere; }
.metadata.compact { grid-template-columns:repeat(2,minmax(100px,180px)); margin-top:16px; padding-top:14px; }
.section-heading { margin:28px 2px 12px; }
.artifact-list { display:grid; gap:10px; }
.artifact { padding:18px; }
.artifact-summary { align-items:flex-start; }
.stage-index { display:grid; flex:0 0 30px; height:30px; place-items:center; border-radius:8px; background:#edf0ee; color:var(--muted); font-size:12px; font-weight:750; }
.artifact-title { flex:1; } .artifact-meta { display:flex; gap:7px; }
.json-row { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-top:14px; }
.json { min-width:0; border:1px solid var(--line); border-radius:8px; background:#fafbfa; overflow:hidden; }
.json summary { padding:9px 11px; cursor:pointer; color:#4e5a54; font-size:12px; font-weight:700; }
pre { max-height:380px; margin:0; padding:12px; overflow:auto; border-top:1px solid var(--line); background:#f7f9f7; color:#344039; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:pre-wrap; overflow-wrap:anywhere; }
.error { margin-top:16px; padding:11px 13px; border:1px solid #edc7c3; border-radius:8px; background:var(--red-soft); color:var(--red); } .error p { margin:3px 0 0; }
.profiles-heading { margin-top:34px; }
.profile-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:10px; }
.profile { min-width:0; padding:18px; } .profile-title { align-items:flex-start; } .profile-title a { font-size:12px; white-space:nowrap; } .profile .json { margin-top:14px; }
.updated { margin-top:7px; font-size:12px; }
.empty-state,.message { padding:64px 24px; text-align:center; } .empty-state p { color:var(--muted); } .empty-state code { display:inline-block; padding:9px 12px; border-radius:7px; background:#edf0ee; }
.empty-icon { color:var(--green); font-size:36px; }.empty-card,.aside-empty { padding:24px; color:var(--muted); text-align:center; }.message { width:min(560px,100%); margin:80px auto; }
@media (max-width:900px) { .shell{padding:22px}.launcher{grid-template-columns:1fr}.selected-icp{grid-column:1}.layout{grid-template-columns:1fr}.run-list{position:static}.metrics{grid-template-columns:repeat(2,1fr)}.profile-grid{grid-template-columns:1fr} }
@media (max-width:560px) { .shell{padding:14px}.topbar,.builder-heading{align-items:flex-start;flex-direction:column}.run-form{align-items:stretch;flex-direction:column}.form-row,.icp-result{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}.metadata{grid-template-columns:1fr 1fr}.json-row{grid-template-columns:1fr}.artifact-meta{align-items:flex-end;flex-direction:column} }
`;

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const database = new PipelineDatabase();
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const server = createDashboardServer(database);

  server.listen(port, () => {
    console.log(`Pipeline dashboard: http://localhost:${port}`);
  });

  const shutdown = (): void => {
    server.close(() => database.close());
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
