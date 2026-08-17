import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

import {
  PipelineDatabase,
  type CompanyProfile,
  type Run,
  type StageArtifact,
} from "./pipeline-database.ts";

const DEFAULT_PORT = 4173;

export function createDashboardServer(database: PipelineDatabase): Server {
  return createServer((request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method !== "GET" || url.pathname !== "/") {
        sendHtml(response, 404, renderMessage("Page not found", "Return to the dashboard."));
        return;
      }

      const runs = database.listRuns().toReversed();
      const requestedRunId = parseRunId(url.searchParams.get("run"));
      const selectedRun = requestedRunId === null ? runs[0] ?? null : database.getRun(requestedRunId);

      if (requestedRunId !== null && selectedRun === null) {
        sendHtml(
          response,
          404,
          renderMessage(`Run ${requestedRunId} was not found`, "Choose an existing run from the dashboard."),
        );
        return;
      }

      const artifacts = selectedRun
        ? database.listStageArtifacts(selectedRun.id)
        : [];
      const profiles = selectedRun
        ? database.listCompanyProfiles(selectedRun.id)
        : [];

      sendHtml(response, 200, renderDashboard({ runs, selectedRun, artifacts, profiles }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = message.startsWith("Run ID") ? 400 : 500;
      sendHtml(response, status, renderMessage("Dashboard error", message));
    }
  });
}

function parseRunId(value: string | null): number | null {
  if (value === null) return null;

  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) {
    throw new Error(`Run ID must be a positive integer: ${value}`);
  }
  return id;
}

function renderDashboard({
  runs,
  selectedRun,
  artifacts,
  profiles,
}: {
  runs: Run[];
  selectedRun: Run | null;
  artifacts: StageArtifact[];
  profiles: CompanyProfile[];
}): string {
  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) => run.status === "failed").length;

  return page("Pipeline observability", `
    <header class="topbar">
      <div>
        <p class="eyebrow">Lead qualification pipeline</p>
        <h1>Stored data</h1>
        <p class="subtitle">A direct view of the runs, artifacts, and company profiles in SQLite.</p>
      </div>
      <a class="button" href="${selectedRun ? `/?run=${selectedRun.id}` : "/"}">Refresh data</a>
    </header>

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
  `);
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
  if (typeof profile !== "object" || profile === null || !("name" in profile)) return null;
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
  return `<section class="panel empty-state"><div class="empty-icon">◇</div><h2>The database is empty</h2><p>Run a pipeline stage, then return here to inspect its saved artifacts.</p><code>npm run event-sourcing -- "your ICP"</code></section>`;
}

function emptyCard(message: string): string {
  return `<div class="panel empty-card">${escapeHtml(message)}</div>`;
}

function renderMessage(title: string, message: string): string {
  return page(title, `<main class="message panel"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><a href="/">Return to dashboard</a></main>`);
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
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function duration(start: string, finish: string | null): string {
  const milliseconds = new Date(finish ?? Date.now()).valueOf() - new Date(start).valueOf();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "Unknown";
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(1)} sec`;
  return `${Math.floor(milliseconds / 60_000)} min ${Math.round((milliseconds % 60_000) / 1_000)} sec`;
}

function safeExternalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function sendHtml(response: import("node:http").ServerResponse, status: number, html: string): void {
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
.button { padding:9px 14px; border:1px solid var(--line); border-radius:8px; background:var(--surface); color:var(--ink); font-weight:650; text-decoration:none; box-shadow:0 1px 2px #18201c0a; }
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
@media (max-width:900px) { .shell{padding:22px}.layout{grid-template-columns:1fr}.run-list{position:static}.metrics{grid-template-columns:repeat(2,1fr)}.profile-grid{grid-template-columns:1fr} }
@media (max-width:560px) { .shell{padding:14px}.topbar{align-items:flex-start;flex-direction:column}.metrics{grid-template-columns:1fr 1fr}.metadata{grid-template-columns:1fr 1fr}.json-row{grid-template-columns:1fr}.artifact-meta{align-items:flex-end;flex-direction:column} }
`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
