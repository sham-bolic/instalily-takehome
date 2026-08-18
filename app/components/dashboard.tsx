import Link from "next/link";
import ReactMarkdown from "react-markdown";

import type {
  Run,
  SavedICP,
  StageArtifact,
} from "../../backend/prototypes/pipeline-database.ts";
import { getDatabase } from "../lib/database.ts";
import {
  selectedICPIdFromRun,
  toLeadView,
  type LeadView,
} from "../lib/dashboard-data.ts";
import { ICPBuilder } from "./icp-builder.tsx";
import { RefreshWhileRunning } from "./refresh-while-running.tsx";

const pipelineStages = [
  ["event_sourcing", "Discover events"],
  ["company_sourcing", "Source companies"],
  ["company_enrichment", "Enrich profiles"],
  ["company_qualification", "Qualify leads"],
] as const;

type DashboardProps = {
  selectedRunId?: number;
  requestedICPId?: number;
  showICPBuilder?: boolean;
  error?: string;
};

export function Dashboard({
  selectedRunId,
  requestedICPId,
  showICPBuilder = false,
  error,
}: DashboardProps) {
  const database = getDatabase();
  const runs = database.listRuns().toReversed();
  const selectedRun = selectedRunId === undefined
    ? runs[0] ?? null
    : database.getRun(selectedRunId);
  const artifacts = selectedRun
    ? database.listStageArtifacts(selectedRun.id)
    : [];
  const leads = selectedRun
    ? database.listCompanyProfiles(selectedRun.id).map(toLeadView).sort(compareLeads)
    : [];
  const icps = database.listICPs();
  const selectedICPId = requestedICPId ?? selectedICPIdFromRun(selectedRun) ?? icps.at(-1)?.id ?? null;
  const selectedICP = selectedICPId === null ? null : database.getICP(selectedICPId);
  const completed = runs.filter((run) => run.status === "completed").length;
  const active = selectedRun?.status === "running";

  return (
    <>
      <RefreshWhileRunning active={active} />
      <header className="topbar">
        <div className="brand">
          <span className="brandMark">T</span>
          <div><strong>Tedlar lead intelligence</strong><span>Graphics & Signage</span></div>
        </div>
        <div className="topActions">
          <span className="liveDot"><i /> Pipeline connected</span>
          <Link className="secondaryButton" href={selectedRun ? `/runs/${selectedRun.id}` : "/"}>Refresh</Link>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div>
            <p className="eyebrow">Lead qualification workspace</p>
            <h1>Find the companies already showing up.</h1>
            <p>Discover credible industry events, identify participating companies, and turn public evidence into a focused sales queue.</p>
          </div>
          <div className="heroMetric"><strong>{leads.filter((lead) => lead.fit === "high").length}</strong><span>high-fit leads in view</span></div>
        </section>

        {error ? <div className="error pageError"><strong>Could not complete that action</strong><span>{error}</span></div> : null}
        <PipelineLauncher icps={icps} selectedICP={selectedICP} />
        {showICPBuilder ? <ICPBuilder error={error} /> : null}

        <section className="metricGrid" aria-label="Pipeline summary">
          <Metric label="Total runs" value={runs.length} detail="saved in SQLite" />
          <Metric label="Completed" value={completed} detail="available for review" />
          <Metric label="Companies" value={leads.length} detail="in selected run" />
          <Metric label="High fit" value={leads.filter((lead) => lead.fit === "high").length} detail="ready to prioritize" accent />
        </section>

        <div className="workspace">
          <RunHistory runs={runs} selectedRunId={selectedRun?.id} />
          <div className="mainColumn">
            {selectedRun ? (
              <>
                <RunOverview run={selectedRun} artifacts={artifacts} />
                <LeadResults leads={leads} running={active} />
                <ArtifactDetails artifacts={artifacts} />
              </>
            ) : <EmptyState />}
          </div>
        </div>
      </main>
    </>
  );
}

function PipelineLauncher({ icps, selectedICP }: { icps: SavedICP[]; selectedICP: SavedICP | null }) {
  return (
    <section className="panel launcher">
      <div>
        <p className="eyebrow">New qualification run</p>
        <h2>Choose the market you want to investigate</h2>
        <p className="subtle">The agent will discover events, source exhibitors, enrich companies, and rank the results.</p>
      </div>
      {icps.length ? (
        <form className="launchForm" action="/api/runs" method="post">
          <label className="selectField"><span>Ideal customer profile</span>
            <select name="icpId" defaultValue={selectedICP?.id}>
              {icps.map((icp) => <option value={icp.id} key={icp.id}>{icp.name}</option>)}
            </select>
          </label>
          <button className="primaryButton" type="submit">Run pipeline <span>→</span></button>
          <Link className="secondaryButton" href="/?new-icp=1#new-icp">Add ICP</Link>
        </form>
      ) : (
        <div className="emptyLaunch"><span>Create an ICP before starting a run.</span><Link className="primaryButton" href="/?new-icp=1#new-icp">Create ICP</Link></div>
      )}
      {selectedICP ? (
        <details className="icpPreview">
          <summary>Review {selectedICP.name}</summary>
          <div className="markdown">
            <ReactMarkdown>{selectedICP.snapshot.text}</ReactMarkdown>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Metric({ label, value, detail, accent = false }: { label: string; value: number; detail: string; accent?: boolean }) {
  return <article className={`metric ${accent ? "accent" : ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function RunHistory({ runs, selectedRunId }: { runs: Run[]; selectedRunId?: number }) {
  return (
    <aside className="panel runHistory">
      <div className="panelTitle"><div><p className="eyebrow">Activity</p><h2>Recent runs</h2></div><span className="count">{runs.length}</span></div>
      <nav>
        {runs.length ? runs.map((run) => (
          <Link className={`runLink ${run.id === selectedRunId ? "selected" : ""}`} href={`/runs/${run.id}`} key={run.id}>
            <span className={`statusIcon ${run.status}`}>{run.status === "completed" ? "✓" : run.status === "failed" ? "!" : "•"}</span>
            <span className="runCopy"><strong>{runName(run)}</strong><small>{formatDate(run.startedAt)}</small></span>
            <span className="chevron">›</span>
          </Link>
        )) : <p className="asideEmpty">Your pipeline runs will appear here.</p>}
      </nav>
    </aside>
  );
}

function RunOverview({ run, artifacts }: { run: Run; artifacts: StageArtifact[] }) {
  return (
    <section className="panel runOverview">
      <div className="runHeading">
        <div><p className="eyebrow">Run #{run.id}</p><h2>{runName(run)}</h2><p className="subtle">Started {formatDate(run.startedAt)}</p></div>
        <StatusBadge status={run.status} />
      </div>
      <div className="stageRail">
        {pipelineStages.map(([key, label], index) => {
          const stageArtifacts = artifacts.filter((artifact) => artifact.stage === key);
          const hasFailure = stageArtifacts.some((artifact) => artifact.status === "failed");
          const complete = stageArtifacts.some((artifact) => artifact.status === "completed");
          const state = hasFailure && !complete ? "failed" : complete ? "complete" : run.status === "running" ? "pending" : "idle";
          return <div className={`stage ${state}`} key={key}><span>{complete ? "✓" : hasFailure ? "!" : index + 1}</span><div><strong>{label}</strong><small>{stageSummary(key, stageArtifacts, run.status)}</small></div></div>;
        })}
      </div>
      {run.error ? <div className="error"><strong>Run stopped</strong><span>{run.error}</span></div> : null}
    </section>
  );
}

function LeadResults({ leads, running }: { leads: LeadView[]; running: boolean }) {
  return (
    <section className="resultsSection">
      <div className="sectionHeading"><div><p className="eyebrow">Sales queue</p><h2>Qualified companies</h2><p className="subtle">Ranked by ICP fit and confidence in the available evidence.</p></div><span className="resultCount">{leads.length} companies</span></div>
      {leads.length ? <div className="leadList">{leads.map((lead) => <LeadCard lead={lead} key={lead.domain} />)}</div> : (
        <div className="panel emptyResults"><span className="emptyIcon">⌁</span><h3>{running ? "Research is underway" : "No qualified companies yet"}</h3><p>{running ? "This view updates as company profiles and assessments arrive." : "Start a pipeline run to build an evidence-backed sales queue."}</p></div>
      )}
    </section>
  );
}

function LeadCard({ lead }: { lead: LeadView }) {
  return (
    <article className="panel leadCard">
      <div className="rank">{lead.rank ? String(lead.rank).padStart(2, "0") : "--"}</div>
      <div className="leadBody">
        <div className="leadHeader">
          <div><span className="eventTag">{lead.event}</span><h3>{lead.name}</h3><a href={lead.companyUrl} target="_blank" rel="noreferrer">{lead.domain} ↗</a></div>
          <div className="ratings"><Rating label="Fit" value={lead.fit} /><Rating label="Confidence" value={lead.confidence} /></div>
        </div>
        <div className="leadFacts">
          <Fact label="Employees" value={lead.employeeCount?.toLocaleString() ?? "Unknown"} />
          <Fact label="Revenue" value={lead.revenue ?? "Unknown"} />
          <Fact label="Decision-maker" value="Not sourced" muted />
          <Fact label="Outreach" value="Not drafted" muted />
        </div>
        <div className="assessment"><p className="assessmentLabel">Why this company</p><p>{lead.rationale ?? "Qualification is still pending for this company."}</p></div>
        {lead.evidence.length ? <details className="evidence"><summary>{lead.evidence.length} supporting evidence point{lead.evidence.length === 1 ? "" : "s"}</summary><ul>{lead.evidence.map((item) => <li key={item}>{item}</li>)}</ul></details> : null}
      </div>
    </article>
  );
}

function Rating({ label, value }: { label: string; value: string | null }) {
  return <div className="rating"><span>{label}</span><strong className={value ?? "pending"}>{value ?? "Pending"}</strong></div>;
}

function Fact({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return <div><span>{label}</span><strong className={muted ? "mutedValue" : ""}>{value}</strong></div>;
}

function ArtifactDetails({ artifacts }: { artifacts: StageArtifact[] }) {
  return (
    <details className="panel developerDetails">
      <summary><span><b>Developer trace</b><small>{artifacts.length} persisted stage artifacts</small></span><span>View details +</span></summary>
      <div className="artifactList">
        {artifacts.map((artifact) => <details key={artifact.id}><summary><span>{titleCase(artifact.stage)}{artifact.companyDomain ? ` · ${artifact.companyDomain}` : ""}</span><StatusBadge status={artifact.status} /></summary><div className="artifactJson"><pre>{JSON.stringify({ input: artifact.input, output: artifact.output, error: artifact.error }, null, 2)}</pre></div></details>)}
      </div>
    </details>
  );
}

function StatusBadge({ status }: { status: Run["status"] | StageArtifact["status"] }) {
  return <span className={`statusBadge ${status}`}><i />{titleCase(status)}</span>;
}

function EmptyState() {
  return <section className="panel emptyResults large"><span className="emptyIcon">◇</span><h2>No pipeline runs yet</h2><p>Create an ICP and start a run. Results will appear here as the agents complete each stage.</p></section>;
}

function runName(run: Run): string {
  const input = objectValue(run.rootInput);
  return typeof input.icp_name === "string" ? input.icp_name : run.label ?? titleCase(run.mode);
}

function stageSummary(stage: string, artifacts: StageArtifact[], status: Run["status"]): string {
  if (!artifacts.length) return status === "running" ? "Waiting" : "Not reached";
  if (artifacts.some((artifact) => artifact.status === "failed") && !artifacts.some((artifact) => artifact.status === "completed")) return "Needs attention";
  const completed = artifacts.filter((artifact) => artifact.status === "completed").length;
  if (stage === "company_enrichment" || stage === "company_qualification") return `${completed} processed`;
  return "Complete";
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function compareLeads(left: LeadView, right: LeadView): number {
  return (left.rank ?? Number.MAX_SAFE_INTEGER) - (right.rank ?? Number.MAX_SAFE_INTEGER);
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}
