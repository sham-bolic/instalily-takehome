import Link from "next/link";
import ReactMarkdown from "react-markdown";

import type {
  CompanyProfile,
  Run,
  SavedICP,
  StageArtifact,
} from "../../backend/pipeline-database.ts";
import { getDatabase } from "../lib/database.ts";
import {
  selectedICPIdFromRun,
  toDecisionMakerCompanies,
  toLeadView,
  toPipelineInventory,
  type DecisionMakerCompanyView,
  type EventView,
  type LeadView,
  type SourcedCompanyView,
} from "../lib/dashboard-data.ts";
import { DeleteRunButton } from "./delete-run-button.tsx";
import { ICPBuilder } from "./icp-builder.tsx";
import { ICPSelector } from "./icp-selector.tsx";
import { OutreachMessage } from "./outreach-message.tsx";
import { RefreshWhileRunning } from "./refresh-while-running.tsx";

const pipelineStages = [
  ["event_sourcing", "Discover events"],
  ["company_sourcing", "Source companies"],
  ["company_enrichment", "Enrich profiles"],
  ["company_qualification", "Qualify leads"],
  ["decision_maker_search", "Find decision-makers"],
  ["outreach_candidate_evaluation", "Evaluate candidate relevance"],
  ["outreach_research", "Research outreach signals"],
  ["outreach_drafting", "Draft personalized messages"],
] as const;

type DashboardProps = {
  selectedRunId?: number;
  requestedICPId?: number;
  showICPBuilder?: boolean;
  selectedTab?: string;
  error?: string;
};

type DashboardTab = "events" | "companies" | "enriched" | "qualified" | "people";

export function Dashboard({
  selectedRunId,
  requestedICPId,
  showICPBuilder = false,
  selectedTab,
  error,
}: DashboardProps) {
  const database = getDatabase();
  const runs = database.listRuns().toReversed();
  const selectedRun =
    selectedRunId === undefined
      ? (runs[0] ?? null)
      : database.getRun(selectedRunId);
  const artifacts = selectedRun
    ? database.listStageArtifacts(selectedRun.id)
    : [];
  const profiles = selectedRun
    ? database.listCompanyProfiles(selectedRun.id)
    : [];
  const leads = profiles.map(toLeadView).sort(compareLeads);
  const inventory = toPipelineInventory(artifacts, profiles);
  const qualifiedLeads = leads.filter((lead) => lead.fit === "high");
  const decisionMakersFrom = selectedRun
    ? finitePositiveInteger(
        objectValue(selectedRun.rootInput).decision_makers_from_run_id,
      )
    : null;
  const outreachFrom = selectedRun
    ? finitePositiveInteger(objectValue(selectedRun.rootInput).outreach_from_run_id)
    : null;
  const isDecisionMakerRun = decisionMakersFrom !== null;
  const isOutreachRun = outreachFrom !== null;
  const isPeopleRun = isDecisionMakerRun || isOutreachRun;
  const hasEmbeddedPeople =
    !isPeopleRun &&
    artifacts.some(
      (artifact) =>
        artifact.stage === "decision_maker_search" ||
        artifact.stage === "outreach_candidate_evaluation",
    );
  const showPeople = isPeopleRun || hasEmbeddedPeople;
  const showOutreach =
    isOutreachRun ||
    artifacts.some(
      (artifact) => artifact.stage === "outreach_candidate_evaluation",
    );
  const decisionMakers = qualifiedLeads.flatMap((lead) => lead.decisionMakers);
  const decisionMakerCompanies = toDecisionMakerCompanies(
    qualifiedLeads,
    artifacts,
  );
  const activeTab = dashboardTab(selectedTab, isPeopleRun, showPeople);
  const icps = database.listICPs();
  const selectedICPId =
    requestedICPId ??
    selectedICPIdFromRun(selectedRun) ??
    icps.at(-1)?.id ??
    null;
  const selectedICP =
    selectedICPId === null ? null : database.getICP(selectedICPId);
  const active = selectedRun?.status === "running";

  return (
    <>
      <RefreshWhileRunning active={active} />
      <header className="topbar">
        <strong className="appTitle">Lead Generation and Outbound</strong>
        <div className="topActions">
          <span className="liveDot">
            <i /> Pipeline connected
          </span>
          <Link
            className="secondaryButton"
            href={selectedRun ? `/runs/${selectedRun.id}` : "/"}
          >
            Refresh
          </Link>
        </div>
      </header>

      <main className="page">
        <section className="hero">
          <div>
            <p className="eyebrow">Lead qualification workspace</p>
            <h1>Find the companies already showing up.</h1>
            <p>
              Discover credible industry events, identify participating
              companies, and turn public evidence into a focused sales queue.
            </p>
          </div>
          <div className="heroMetric">
            <strong>
              {leads.filter((lead) => lead.fit === "high").length}
            </strong>
            <span>high-fit leads in view</span>
          </div>
        </section>

        {error && !showICPBuilder ? (
          <div className="error pageError">
            <strong>Could not complete that action</strong>
            <span>{error}</span>
          </div>
        ) : null}
        <PipelineLauncher icps={icps} selectedICP={selectedICP} />
        {showICPBuilder ? <ICPBuilder error={error} /> : null}

        <section className="metricGrid" aria-label="Selected run data">
          {isOutreachRun ? (
            <>
              <Metric
                label="Companies researched"
                value={artifacts.filter(
                  (artifact) => artifact.stage === "outreach_research",
                ).length}
                detail="first-party signal searches"
              />
              <Metric
                label="People selected"
                value={artifacts.filter(
                  (artifact) => artifact.stage === "outreach_drafting",
                ).length}
                detail="relevant contacts drafted"
              />
              <Metric
                label="Messages drafted"
                value={decisionMakers.filter((person) => person.outreach).length}
                detail="ready to review and copy"
                accent
              />
              <Metric
                label="Draft failures"
                value={artifacts.filter(
                  (artifact) =>
                    artifact.stage === "outreach_drafting" &&
                    artifact.status === "failed",
                ).length}
                detail="isolated per person"
              />
            </>
          ) : isDecisionMakerRun ? (
            <>
              <Metric
                label="Qualified leads"
                value={qualifiedLeads.length}
                detail="imported from the source run"
              />
              <Metric
                label="Companies searched"
                value={artifacts.filter(
                  (artifact) => artifact.stage === "decision_maker_search",
                ).length}
                detail="sent to Surfe"
              />
              <Metric
                label="People found"
                value={decisionMakers.length}
                detail="returned by Surfe"
                accent
              />
              <Metric
                label="API failures"
                value={artifacts.filter(
                  (artifact) =>
                    artifact.stage === "decision_maker_search" &&
                    artifact.status === "failed",
                ).length}
                detail="isolated per company"
              />
            </>
          ) : (
            <>
              <Metric label="Events" value={inventory.events.length} detail="discovered" />
              <Metric label="Companies" value={inventory.companies.length} detail="sourced from events" />
              <Metric label="Enriched" value={leads.length} detail="profiles available" />
              <Metric label="Qualified" value={qualifiedLeads.length} detail="assessed for fit" accent />
            </>
          )}
        </section>

        <div className="workspace">
          <RunHistory runs={runs} selectedRunId={selectedRun?.id} />
          <div className="mainColumn">
            {selectedRun ? (
              <>
                <RunOverview
                  run={selectedRun}
                  artifacts={artifacts}
                  profiles={profiles}
                />
                <ResultTabs
                  runId={selectedRun.id}
                  activeTab={activeTab}
                  events={inventory.events}
                  companies={inventory.companies}
                  enrichedLeads={leads}
                  qualifiedLeads={qualifiedLeads}
                  decisionMakerCompanies={decisionMakerCompanies}
                  isPeopleRun={isPeopleRun}
                  showPeople={showPeople}
                  showOutreach={showOutreach}
                  running={active}
                />
                <ArtifactDetails artifacts={artifacts} />
              </>
            ) : (
              <EmptyState />
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function PipelineLauncher({
  icps,
  selectedICP,
}: {
  icps: SavedICP[];
  selectedICP: SavedICP | null;
}) {
  return (
    <section className="panel launcher">
      <div>
        <p className="eyebrow">New qualification run</p>
        <h2>Choose the market you want to investigate</h2>
        <p className="subtle">
          The agent will discover events, source exhibitors, enrich companies,
          and rank the results.
        </p>
      </div>
      {icps.length ? (
        <form className="launchForm" action="/api/runs" method="post">
          <label className="selectField">
            <span>Ideal customer profile</span>
            <ICPSelector
              options={icps.map(({ id, name }) => ({ id, name }))}
              selectedICPId={selectedICP?.id}
            />
          </label>
          <button className="primaryButton" type="submit">
            Run pipeline <span>→</span>
          </button>
          <Link className="secondaryButton" href="/?new-icp=1#new-icp">
            Add ICP
          </Link>
        </form>
      ) : (
        <div className="emptyLaunch">
          <span>Create an ICP before starting a run.</span>
          <Link className="primaryButton" href="/?new-icp=1#new-icp">
            Create ICP
          </Link>
        </div>
      )}
      {selectedICP ? (
        <details className="icpPreview" key={selectedICP.id}>
          <summary>Review {selectedICP.name}</summary>
          <div className="markdown">
            <ReactMarkdown>{selectedICP.snapshot.text}</ReactMarkdown>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  accent = false,
}: {
  label: string;
  value: number;
  detail: string;
  accent?: boolean;
}) {
  return (
    <article className={`metric ${accent ? "accent" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function RunHistory({
  runs,
  selectedRunId,
}: {
  runs: Run[];
  selectedRunId?: number;
}) {
  return (
    <aside className="panel runHistory">
      <div className="panelTitle">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>Recent runs</h2>
        </div>
        <span className="count">{runs.length}</span>
      </div>
      <nav>
        {runs.length ? (
          runs.map((run) => (
            <Link
              className={`runLink ${run.id === selectedRunId ? "selected" : ""}`}
              href={`/runs/${run.id}`}
              key={run.id}
            >
              <span className={`statusIcon ${run.status}`}>
                {run.status === "completed"
                  ? "✓"
                  : run.status === "failed"
                    ? "!"
                    : "•"}
              </span>
              <span className="runCopy">
                <strong>{runName(run)}</strong>
                <small>{formatDate(run.startedAt)}</small>
              </span>
              <span className="chevron">›</span>
            </Link>
          ))
        ) : (
          <p className="asideEmpty">Your pipeline runs will appear here.</p>
        )}
      </nav>
    </aside>
  );
}

function RunOverview({
  run,
  artifacts,
  profiles,
}: {
  run: Run;
  artifacts: StageArtifact[];
  profiles: CompanyProfile[];
}) {
  const input = objectValue(run.rootInput);
  const resumedFrom = finitePositiveInteger(input.resumed_from_run_id);
  const decisionMakersFrom = finitePositiveInteger(
    input.decision_makers_from_run_id,
  );
  const outreachFrom = finitePositiveInteger(input.outreach_from_run_id);
  const resumable =
    run.status === "failed" &&
    artifacts.some(
      (artifact) =>
        artifact.stage === "event_sourcing" && artifact.status === "completed",
    );
  const canSearchDecisionMakers =
    run.status === "completed" &&
    decisionMakersFrom === null &&
    outreachFrom === null &&
    !artifacts.some((artifact) => artifact.stage === "decision_maker_search") &&
    profiles.some((profile) => {
      const value = objectValue(profile.profile);
      return objectValue(value.qualification).fit === "high";
    });
  const canGenerateOutreach =
    run.status === "completed" &&
    outreachFrom === null &&
    !artifacts.some((artifact) =>
      [
        "outreach_candidate_evaluation",
        "outreach_research",
        "outreach_drafting",
      ].includes(artifact.stage),
    ) &&
    profiles.some((profile) => {
      const makers = objectValue(profile.profile).decision_makers;
      return Array.isArray(makers) && makers.length > 0;
    });
  const displayedStages = outreachFrom
    ? pipelineStages.slice(-3)
    : decisionMakersFrom
      ? pipelineStages.slice(4, 5)
      : pipelineStages;
  const activeStageIndex =
    run.status === "running"
      ? displayedStages.findIndex(([stage]) =>
          !artifacts.some(
            (artifact) => artifact.stage === stage && artifact.status === "completed",
          ),
        )
      : -1;

  return (
    <section className="panel runOverview">
      <div className="runHeading">
        <div>
          <p className="eyebrow">Run #{run.id}</p>
          <h2>{runName(run)}</h2>
          <p className="subtle">
            Started {formatDate(run.startedAt)}
            {resumedFrom ? (
              <>
                {" "}
                · Resumed from{" "}
                <Link href={`/runs/${resumedFrom}`}>run #{resumedFrom}</Link>
              </>
            ) : null}
            {decisionMakersFrom ? (
              <>
                {" "}
                · Qualified leads from{" "}
                <Link href={`/runs/${decisionMakersFrom}?tab=qualified`}>
                  run #{decisionMakersFrom}
                </Link>
              </>
            ) : null}
            {outreachFrom ? (
              <>
                {" "}
                · People from{" "}
                <Link href={`/runs/${outreachFrom}?tab=people`}>
                  run #{outreachFrom}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <div className="runActions">
          <StatusBadge status={run.status} />
          {resumable ? (
            <form action="/api/runs" method="post">
              <input name="resumeRunId" type="hidden" value={run.id} />
              <button className="secondaryButton" type="submit">
                Resume run
              </button>
            </form>
          ) : null}
          {canGenerateOutreach ? (
            <form action="/api/runs" method="post">
              <input name="outreachRunId" type="hidden" value={run.id} />
              <button className="primaryButton" type="submit">
                Generate outreach
              </button>
            </form>
          ) : null}
          {canSearchDecisionMakers ? (
            <form action="/api/runs" method="post">
              <input
                name="decisionMakerRunId"
                type="hidden"
                value={run.id}
              />
              <button className="secondaryButton" type="submit">
                Find decision-makers
              </button>
            </form>
          ) : null}
          {run.status !== "running" ? <DeleteRunButton runId={run.id} /> : null}
        </div>
      </div>
      {run.status === "running" ? (
        <div
          className="runProgress"
          role="status"
          aria-label="Pipeline progress"
          aria-live="polite"
        >
          <span className="runProgressSpinner" aria-hidden="true" />
          <div>
            <strong>Pipeline is working</strong>
            <span>
              {displayedStages[activeStageIndex]?.[1] ?? "Processing results"} is
              in progress. New results appear automatically.
            </span>
          </div>
          <small>Checking every 2 seconds</small>
        </div>
      ) : null}
      <div className="stageRail">
        {displayedStages.map(([key, label], index) => {
          const stageArtifacts = artifacts.filter(
            (artifact) => artifact.stage === key,
          );
          const hasFailure = stageArtifacts.some(
            (artifact) => artifact.status === "failed",
          );
          const complete = stageArtifacts.some(
            (artifact) => artifact.status === "completed",
          );
          const active = index === activeStageIndex;
          const state =
            hasFailure && !complete
              ? "failed"
              : complete
                ? "complete"
                : run.status === "running"
                  ? "pending"
                  : "idle";
          return (
            <div className={`stage ${state} ${active ? "active" : ""}`} key={key}>
              <span>{active ? "…" : complete ? "✓" : hasFailure ? "!" : index + 1}</span>
              <div>
                <strong>{label}</strong>
                <small>
                  {stageSummary(key, stageArtifacts, run.status, active)}
                </small>
              </div>
            </div>
          );
        })}
      </div>
      {run.error ? (
        <div className="error">
          <strong>Run stopped</strong>
          <span>{run.error}</span>
        </div>
      ) : null}
    </section>
  );
}

function ResultTabs({
  runId,
  activeTab,
  events,
  companies,
  enrichedLeads,
  qualifiedLeads,
  decisionMakerCompanies,
  isPeopleRun,
  showPeople,
  showOutreach,
  running,
}: {
  runId: number;
  activeTab: DashboardTab;
  events: EventView[];
  companies: SourcedCompanyView[];
  enrichedLeads: LeadView[];
  qualifiedLeads: LeadView[];
  decisionMakerCompanies: DecisionMakerCompanyView[];
  isPeopleRun: boolean;
  showPeople: boolean;
  showOutreach: boolean;
  running: boolean;
}) {
  const peopleTab: [DashboardTab, string, number] = [
    "people",
    "People found",
    decisionMakerCompanies.reduce(
      (count, company) => count + company.people.length,
      0,
    ),
  ];
  const tabs: Array<[DashboardTab, string, number]> = isPeopleRun
    ? [peopleTab, ["qualified", "Qualified companies", qualifiedLeads.length]]
    : [
        ["events", "Events", events.length],
        ["companies", "Companies", companies.length],
        ["enriched", "Enriched companies", enrichedLeads.length],
        ["qualified", "Qualified companies", qualifiedLeads.length],
        ...(showPeople ? [peopleTab] : []),
      ];

  return (
    <section className="resultsSection">
      <nav className="resultTabs" aria-label="Run data">
        {tabs.map(([key, label, count]) => (
          <Link
            className={activeTab === key ? "active" : ""}
            href={`/runs/${runId}?tab=${key}#results`}
            aria-current={activeTab === key ? "page" : undefined}
            key={key}
          >
            {label} <span>{count}</span>
          </Link>
        ))}
      </nav>
      <div id="results">
        {activeTab === "people" ? (
          <PeopleResults
            companies={decisionMakerCompanies}
            running={running}
            showOutreach={showOutreach}
          />
        ) : activeTab === "events" ? (
          <EventResults runId={runId} events={events} running={running} />
        ) : activeTab === "companies" ? (
          <CompanyResults companies={companies} running={running} />
        ) : activeTab === "enriched" ? (
          <LeadResults
            leads={enrichedLeads}
            running={running}
            title="Enriched companies"
            eyebrow="Available profiles"
            description="Every company with a saved enrichment profile, including those not yet qualified."
          />
        ) : (
          <LeadResults
            leads={qualifiedLeads}
            running={running}
            title="Qualified companies"
            eyebrow="Sales queue"
            description="Ranked by ICP fit and confidence in the available evidence."
          />
        )}
      </div>
    </section>
  );
}

function EventResults({
  runId,
  events,
  running,
}: {
  runId: number;
  events: EventView[];
  running: boolean;
}) {
  return (
    <>
      <ResultsHeading
        eyebrow="Discovery inventory"
        title="Sourced events"
        description="Choose any event with a company directory to source and enrich its participating companies."
        count={`${events.length} events`}
      />
      {events.length ? (
        <div className="inventoryGrid">
          {events.map((event) => (
            <article className="panel inventoryCard" key={`${event.name}:${event.discoveryUrl}`}>
              <div className="inventoryHeader">
                <div>
                  <span className={`inventoryStatus ${event.selectedForSourcing ? "selected" : "available"}`}>
                    {event.selectedForSourcing ? "Used for sourcing" : "Discovered"}
                  </span>
                  <h3>{event.name}</h3>
                </div>
                <strong className="relevanceScore">
                  {event.relevanceScore === null
                    ? "-"
                    : `${Math.round(event.relevanceScore * 100)}%`}
                  <small> relevance</small>
                </strong>
              </div>
              <p>{event.summary ?? "No event summary was returned."}</p>
              <div className="inventoryFooter">
                <div className="inventoryLinks">
                  {event.discoveryUrl ? (
                    <a href={event.discoveryUrl} target="_blank" rel="noreferrer">
                      Event source ↗
                    </a>
                  ) : null}
                  {event.companySourceUrl ? (
                    <a href={event.companySourceUrl} target="_blank" rel="noreferrer">
                      {event.companySourceType
                        ? titleCase(event.companySourceType)
                        : "Company directory"} ↗
                    </a>
                  ) : (
                    <span>No company directory found</span>
                  )}
                </div>
                {event.companySourceUrl ? (
                  <form action="/api/runs" method="post">
                    <input name="eventRunId" type="hidden" value={runId} />
                    <input name="eventName" type="hidden" value={event.name} />
                    <button
                      className="eventEnrichmentButton"
                      disabled={running}
                      type="submit"
                    >
                      {running
                        ? "Run in progress"
                        : event.selectedForSourcing
                          ? "Enrich again"
                          : "Enrich companies"}
                      {!running ? <span>→</span> : null}
                    </button>
                  </form>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <InventoryEmpty
          running={running}
          title="No events discovered yet"
          detail="Event candidates will appear here as soon as discovery completes."
        />
      )}
    </>
  );
}

function CompanyResults({
  companies,
  running,
}: {
  companies: SourcedCompanyView[];
  running: boolean;
}) {
  return (
    <>
      <ResultsHeading
        eyebrow="Sourcing inventory"
        title="Sourced companies"
        description="Every company found in an event directory, including companies that were skipped, failed, or have not reached enrichment."
        count={`${companies.length} companies`}
      />
      {companies.length ? (
        <div className="companyTable panel">
          <div className="companyTableHeader" aria-hidden="true">
            <span>Company</span>
            <span>Event</span>
            <span>Booth</span>
            <span>Enrichment</span>
            <span>Source</span>
          </div>
          {companies.map((company) => (
            <article className="companyRow" key={company.key}>
              <div className="companyIdentity">
                <strong>{company.name}</strong>
                {company.companyUrl ? (
                  <a href={company.companyUrl} target="_blank" rel="noreferrer">
                    Check website ↗
                  </a>
                ) : (
                  <small>No verified website found</small>
                )}
              </div>
              <span className="companyEvent">{company.event}</span>
              <span className="companyBooth">{company.booth ?? "-"}</span>
              <div className="enrichmentCell">
                <EnrichmentBadge company={company} />
                {company.enrichmentDetail ? <small>{company.enrichmentDetail}</small> : null}
              </div>
              <div className="sourceLinks">
                {company.profileUrl ? (
                  <a href={company.profileUrl} target="_blank" rel="noreferrer">Profile ↗</a>
                ) : null}
                {company.evidenceUrl ? (
                  <a href={company.evidenceUrl} target="_blank" rel="noreferrer">Evidence ↗</a>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <InventoryEmpty
          running={running}
          title="No companies sourced yet"
          detail="Companies will remain visible here even when enrichment does not produce a match."
        />
      )}
    </>
  );
}

function EnrichmentBadge({ company }: { company: SourcedCompanyView }) {
  const labels = {
    enriched: "Enriched",
    not_enriched: "Not enriched",
    failed: "Failed",
    not_attempted: "Not attempted",
  } as const;
  return (
    <span className={`enrichmentBadge ${company.enrichmentStatus}`}>
      {labels[company.enrichmentStatus]}
    </span>
  );
}

function LeadResults({
  leads,
  running,
  title,
  eyebrow,
  description,
}: {
  leads: LeadView[];
  running: boolean;
  title: string;
  eyebrow: string;
  description: string;
}) {
  return (
    <>
      <ResultsHeading
        eyebrow={eyebrow}
        title={title}
        description={description}
        count={`${leads.length} companies`}
      />
      {leads.length ? (
        <div className="leadList">
          {leads.map((lead) => (
            <LeadCard lead={lead} key={lead.domain} />
          ))}
        </div>
      ) : (
        <InventoryEmpty
          running={running}
          title={`No ${title.toLocaleLowerCase("en-US")} yet`}
          detail="This view updates as company profiles and assessments arrive."
        />
      )}
    </>
  );
}

function PeopleResults({
  companies,
  running,
  showOutreach,
}: {
  companies: DecisionMakerCompanyView[];
  running: boolean;
  showOutreach: boolean;
}) {
  const peopleFound = companies.reduce(
    (count, company) => count + company.people.length,
    0,
  );
  const initiallyOpenDomain = companies.find(
    (company) => company.status === "matches_found",
  )?.domain;

  return (
    <>
      <ResultsHeading
        eyebrow={showOutreach ? "Personalized outbound" : "Surfe people search"}
        title={showOutreach ? "Outreach drafts by company" : "Decision-maker search by company"}
        description={showOutreach
          ? "Review the evidence-grounded message for each selected person, edit it, and copy it when ready."
          : "Each qualified company shows whether Surfe returned matching people, returned no matches, encountered an API error, or has not been searched yet."}
        count={`${peopleFound} people · ${companies.length} companies`}
      />
      {companies.length ? (
        <div className="decisionMakerGroups">
          {companies.map((company) => (
            <details
              className={`panel decisionMakerGroup ${company.status}`}
              key={company.domain}
              open={company.domain === initiallyOpenDomain}
            >
              <summary>
                <span className="companyDisclosure" aria-hidden="true">›</span>
                <span className="decisionMakerCompanyIdentity">
                  <strong>{company.name}</strong>
                  <small>{company.domain}</small>
                </span>
                <DecisionMakerSearchBadge company={company} />
              </summary>
              {company.status === "no_matches" ? null : (
                <div className="decisionMakerGroupBody">
                  <a
                    className="companyWebsiteLink"
                    href={company.companyUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Company website ↗
                  </a>
                  {company.status === "api_error" ? (
                  <div className="searchOutcome apiError">
                    <strong>Surfe search failed</strong>
                    <span>{company.error}</span>
                  </div>
                  ) : company.status === "not_searched" ? (
                  <div className="searchOutcome notSearched">
                    <strong>{running ? "Waiting to be searched" : "Search not recorded"}</strong>
                    <span>No completed or failed Surfe request was found for this company.</span>
                  </div>
                ) : (
                  <div className="companyPeopleTable">
                    <div className="companyPersonHeader" aria-hidden="true">
                      <span>Person</span>
                      <span>Current role</span>
                      <span>{showOutreach ? "Relevance" : "Search match"}</span>
                      <span>Location</span>
                    </div>
                    {company.people.map((person) => (
                      <article className="companyPersonRow" key={person.linkedInUrl}>
                        <div className="personIdentity">
                          <strong>{person.name}</strong>
                          <a href={person.linkedInUrl} target="_blank" rel="noreferrer">
                            LinkedIn profile ↗
                          </a>
                        </div>
                        <span className="personRole">{person.title}</span>
                        <div className="personMatches">
                          {showOutreach && person.relevanceScore !== null ? (
                            <span>{person.relevanceScore}/100 · {person.relevanceConfidence ?? "unrated"}</span>
                          ) : (
                            [...person.seniorities, ...person.departments].map((match) => (
                              <span key={match}>{match}</span>
                            ))
                          )}
                        </div>
                        <span>{formatCountry(person.country)}</span>
                        {showOutreach ? (
                          person.outreach ? (
                            <OutreachMessage
                              personName={person.name}
                              outreach={person.outreach}
                            />
                          ) : person.outreachStatus === "excluded" ? (
                            <div className="draftExcluded">
                              <strong>Not selected for outreach</strong>
                              <span>{person.outreachExclusionReason}</span>
                            </div>
                          ) : (
                            <div className="draftUnavailable">
                              <strong>No message generated</strong>
                              <span>Check the developer trace for this person's drafting error.</span>
                            </div>
                          )
                        ) : null}
                      </article>
                    ))}
                  </div>
                  )}
                </div>
              )}
            </details>
          ))}
        </div>
      ) : (
        <InventoryEmpty
          running={running}
          title="No qualified companies imported"
          detail="This decision-maker run does not contain companies to search."
        />
      )}
    </>
  );
}

function DecisionMakerSearchBadge({
  company,
}: {
  company: DecisionMakerCompanyView;
}) {
  const label = {
    matches_found: `${company.people.length} matching ${company.people.length === 1 ? "person" : "people"}`,
    no_matches: "0 matches",
    api_error: "API error",
    not_searched: "Not searched",
  }[company.status];

  return <span className={`searchStatus ${company.status}`}>{label}</span>;
}

function ResultsHeading({
  eyebrow,
  title,
  description,
  count,
}: {
  eyebrow: string;
  title: string;
  description: string;
  count: string;
}) {
  return (
    <div className="sectionHeading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="subtle">{description}</p>
      </div>
      <span className="resultCount">{count}</span>
    </div>
  );
}

function InventoryEmpty({
  running,
  title,
  detail,
}: {
  running: boolean;
  title: string;
  detail: string;
}) {
  return (
    <div className={`panel emptyResults ${running ? "loading" : ""}`}>
      {running ? (
        <span className="runLoadingDots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <span className="emptyIcon">⌁</span>
      )}
      <h3>{running ? "Research is underway" : title}</h3>
      <p>{running ? "This view updates as the pipeline saves new data." : detail}</p>
    </div>
  );
}

function LeadCard({ lead }: { lead: LeadView }) {
  return (
    <article className="panel leadCard">
      <div className="rank">
        {lead.rank ? String(lead.rank).padStart(2, "0") : "--"}
      </div>
      <div className="leadBody">
        <div className="leadHeader">
          <div>
            <span className="eventTag">{lead.event}</span>
            <h3>{lead.name}</h3>
            <a href={lead.companyUrl} target="_blank" rel="noreferrer">
              {lead.domain} ↗
            </a>
          </div>
          <div className="ratings">
            <Rating label="Fit" value={lead.fit} />
            <Rating label="Confidence" value={lead.confidence} />
          </div>
        </div>
        <div className="leadFacts">
          <Fact
            label="Employees"
            value={lead.employeeCount?.toLocaleString() ?? "Unknown"}
          />
          <Fact label="Revenue" value={lead.revenue ?? "Unknown"} />
          <Fact
            label="Decision-makers"
            value={
              lead.decisionMakers.length
                ? `${lead.decisionMakers.length} found`
                : "Not sourced"
            }
            muted={!lead.decisionMakers.length}
          />
          <Fact label="Outreach" value="Not drafted" muted />
        </div>
        {lead.decisionMakers.length ? (
          <div className="decisionMakers">
            <p className="assessmentLabel">Key decision-makers</p>
            <ul>
              {lead.decisionMakers.map((person) => (
                <li key={person.linkedInUrl}>
                  <a href={person.linkedInUrl} target="_blank" rel="noreferrer">
                    {person.name} ↗
                  </a>
                  <span>{person.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="assessment">
          <p className="assessmentLabel">Why this company</p>
          <p>
            {lead.rationale ??
              "Qualification is still pending for this company."}
          </p>
        </div>
        {lead.evidence.length ? (
          <details className="evidence">
            <summary>
              {lead.evidence.length} supporting evidence point
              {lead.evidence.length === 1 ? "" : "s"}
            </summary>
            <ul>
              {lead.evidence.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}

function Rating({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rating">
      <span>{label}</span>
      <strong className={value ?? "pending"}>{value ?? "Pending"}</strong>
    </div>
  );
}

function Fact({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <span>{label}</span>
      <strong className={muted ? "mutedValue" : ""}>{value}</strong>
    </div>
  );
}

function ArtifactDetails({ artifacts }: { artifacts: StageArtifact[] }) {
  return (
    <details className="panel developerDetails">
      <summary>
        <span>
          <b>Developer trace</b>
          <small>{artifacts.length} persisted stage artifacts</small>
        </span>
        <span>View details +</span>
      </summary>
      <div className="artifactList">
        {artifacts.map((artifact) => (
          <details key={artifact.id}>
            <summary>
              <span>
                {titleCase(artifact.stage)}
                {artifact.companyDomain ? ` · ${artifact.companyDomain}` : ""}
              </span>
              <StatusBadge status={artifact.status} />
            </summary>
            <div className="artifactJson">
              <pre>
                {JSON.stringify(
                  {
                    input: artifact.input,
                    output: artifact.output,
                    error: artifact.error,
                  },
                  null,
                  2,
                )}
              </pre>
            </div>
          </details>
        ))}
      </div>
    </details>
  );
}

function StatusBadge({
  status,
}: {
  status: Run["status"] | StageArtifact["status"];
}) {
  return (
    <span className={`statusBadge ${status}`}>
      <i />
      {titleCase(status)}
    </span>
  );
}

function EmptyState() {
  return (
    <section className="panel emptyResults large">
      <span className="emptyIcon">◇</span>
      <h2>No pipeline runs yet</h2>
      <p>
        Create an ICP and start a run. Results will appear here as the agents
        complete each stage.
      </p>
    </section>
  );
}

function runName(run: Run): string {
  const input = objectValue(run.rootInput);
  return typeof input.icp_name === "string"
    ? input.icp_name
    : (run.label ?? titleCase(run.mode));
}

function stageSummary(
  stage: string,
  artifacts: StageArtifact[],
  status: Run["status"],
  active: boolean,
): string {
  if (!artifacts.length)
    return active ? "Working" : status === "running" ? "Waiting" : "Not reached";
  if (
    artifacts.some((artifact) => artifact.status === "failed") &&
    !artifacts.some((artifact) => artifact.status === "completed")
  )
    return "Needs attention";
  const completed = artifacts.filter(
    (artifact) => artifact.status === "completed",
  ).length;
  if (
    stage === "company_enrichment" ||
    stage === "company_qualification" ||
    stage === "decision_maker_search"
  )
    return `${completed} processed${active ? " · working" : ""}`;
  return active ? "Working" : "Complete";
}

function currentPipelineStageIndex(artifacts: StageArtifact[]): number {
  const completed = (stage: string) =>
    artifacts.some(
      (artifact) => artifact.stage === stage && artifact.status === "completed",
    );

  if (!completed("event_sourcing")) return 0;
  if (!completed("company_sourcing")) return 1;
  if (!artifacts.some((artifact) => artifact.stage === "company_qualification"))
    return 2;
  if (!artifacts.some((artifact) => artifact.stage === "decision_maker_search"))
    return 3;
  return 4;
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function dashboardTab(
  value: string | undefined,
  isDecisionMakerRun: boolean,
  showPeople: boolean,
): DashboardTab {
  if (isDecisionMakerRun) {
    return value === "qualified" || value === "people" ? value : "people";
  }
  return value === "events" ||
    value === "companies" ||
    value === "enriched" ||
    value === "qualified" ||
    (value === "people" && showPeople)
    ? value
    : "companies";
}

function compareLeads(left: LeadView, right: LeadView): number {
  return (
    (left.rank ?? Number.MAX_SAFE_INTEGER) -
    (right.rank ?? Number.MAX_SAFE_INTEGER)
  );
}

function finitePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatCountry(value: string | null): string {
  if (!value) return "Not provided";
  return value.length === 2 ? value.toLocaleUpperCase("en-US") : value;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
}
