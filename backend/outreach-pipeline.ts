import { pathToFileURL } from "node:url";

import { companyDomainsMatch } from "./company-domain.ts";
import {
  DEFAULT_OUTREACH_RELEVANCE_THRESHOLD,
  evaluateOutreachCandidates,
  type CandidateAssessment,
  type CandidateEvaluationInput,
} from "./outreach-candidate-evaluation.ts";
import {
  draftPersonalizedOutreach,
  type OutreachDraftInput,
  type PersonalizedOutreach,
} from "./outreach-drafting.ts";
import {
  researchOutreachSignals,
  type OutreachResearchInput,
  type OutreachResearchResult,
} from "./outreach-research.ts";
import { decisionMakerSchema, type DecisionMaker } from "./decision-maker-search.ts";
import { PipelineDatabase, type CompanyProfile } from "./pipeline-database.ts";
import { PipelineRun } from "./pipeline-run.ts";

export type OutreachPipelineDependencies = {
  evaluate: (input: CandidateEvaluationInput) => Promise<CandidateAssessment[]>;
  research: (input: OutreachResearchInput) => Promise<OutreachResearchResult>;
  draft: (input: OutreachDraftInput) => Promise<PersonalizedOutreach>;
};

export type OutreachGenerationResult = {
  evaluatedCompanies: number;
  failedEvaluations: number;
  researchedCompanies: number;
  failedResearches: number;
  draftedMessages: number;
  failedDrafts: number;
};

export type OutreachPipelineResult = OutreachGenerationResult & {
  runId: number;
  sourceRunId: number;
  importedCompanies: number;
};

export function startOutreachPipeline(
  database: PipelineDatabase,
  sourceRunId: number,
  dependencies: OutreachPipelineDependencies,
  relevanceThreshold = DEFAULT_OUTREACH_RELEVANCE_THRESHOLD,
): { runId: number; completion: Promise<OutreachPipelineResult> } {
  if (!Number.isInteger(relevanceThreshold) || relevanceThreshold < 0 || relevanceThreshold > 100) {
    throw new Error("Outreach relevance threshold must be an integer from 0 to 100.");
  }

  const sourceRun = database.getRun(sourceRunId);
  if (!sourceRun || sourceRun.status !== "completed") {
    throw new Error(`Run ${sourceRunId} is not a completed pipeline run.`);
  }

  const sourceInput = objectValue(sourceRun.rootInput);
  const profiles = database
    .listCompanyProfiles(sourceRunId)
    .filter((profile) => decisionMakers(profile).length > 0);
  if (profiles.length === 0) {
    throw new Error(`Run ${sourceRunId} does not contain any matched people.`);
  }

  const run = new PipelineRun(database, {
    label: `Outreach: ${sourceRun.label ?? `run ${sourceRunId}`}`,
    rootInput: {
      ...(textValue(sourceInput.icp) ? { icp: textValue(sourceInput.icp) } : {}),
      ...(positiveInteger(sourceInput.icp_id) !== null
        ? { icp_id: positiveInteger(sourceInput.icp_id) }
        : {}),
      ...(textValue(sourceInput.icp_name)
        ? { icp_name: textValue(sourceInput.icp_name) }
        : {}),
      outreach_from_run_id: sourceRunId,
      outreach_relevance_threshold: relevanceThreshold,
    },
  });

  for (const profile of profiles) {
    run.saveProfile({
      domain: profile.domain,
      companyUrl: profile.companyUrl,
      profile: {
        ...objectValue(profile.profile),
        source_profile: { run_id: sourceRunId, profile_id: profile.id },
      },
    });
  }
  run.completed(
    {
      name: "decision_maker_import",
      provider: "sqlite",
      input: { source_run_id: sourceRunId },
    },
    {
      imported_companies: profiles.map((profile) => ({
        domain: profile.domain,
        people: decisionMakers(profile).length,
      })),
    },
  );

  return {
    runId: run.id,
    completion: executeOutreachPipeline(
      run,
      sourceRunId,
      textValue(sourceInput.icp) ?? "DuPont Tedlar Graphics and Signage",
      profiles,
      dependencies,
      relevanceThreshold,
    ),
  };
}

async function executeOutreachPipeline(
  run: PipelineRun,
  sourceRunId: number,
  icp: string,
  profiles: CompanyProfile[],
  dependencies: OutreachPipelineDependencies,
  relevanceThreshold: number,
): Promise<OutreachPipelineResult> {
  try {
    const result = await generateOutreach(
      run,
      icp,
      dependencies,
      relevanceThreshold,
    );
    run.complete();
    return {
      runId: run.id,
      sourceRunId,
      importedCompanies: profiles.length,
      ...result,
    };
  } catch (error) {
    run.fail(error);
    throw error;
  }
}

export async function generateOutreach(
  run: PipelineRun,
  icp: string,
  dependencies: OutreachPipelineDependencies,
  relevanceThreshold = DEFAULT_OUTREACH_RELEVANCE_THRESHOLD,
): Promise<OutreachGenerationResult> {
  const profiles = run
    .profiles()
    .filter((profile) => decisionMakers(profile).length > 0);
  let evaluatedCompanies = 0;
  let failedEvaluations = 0;
  let researchedCompanies = 0;
  let failedResearches = 0;
  let draftedMessages = 0;
  let failedDrafts = 0;

  for (const sourceProfile of profiles) {
    const current = run.profiles().find(
      (profile) => profile.domain === sourceProfile.domain,
    )!;
    const value = objectValue(current.profile);
    const companyName = textValue(value.name) ?? current.domain;
    const allPeople = decisionMakers(current);
    let assessments: CandidateAssessment[];
    try {
      assessments = await run.stage(
        {
          name: "outreach_candidate_evaluation",
          companyDomain: current.domain,
          provider: "google",
          input: {
            company_domain: current.domain,
            candidate_linkedin_urls: allPeople.map((person) => person.linkedInUrl),
            relevance_threshold: relevanceThreshold,
          },
        },
        () => dependencies.evaluate({
          icp,
          company: {
            name: companyName,
            domain: current.domain,
            qualificationRationale: companyContext(current).qualificationRationale,
          },
          people: allPeople,
        }),
      );
      evaluatedCompanies += 1;
    } catch {
      failedEvaluations += 1;
      run.saveProfile({
        domain: current.domain,
        companyUrl: current.companyUrl,
        profile: {
          ...value,
          outreach_selection: {
            relevance_threshold: relevanceThreshold,
            evaluations: [],
            selected_person_linkedin_urls: [],
            excluded: allPeople.map((person) => ({
              person_linkedin_url: person.linkedInUrl,
              reason: "Candidate relevance evaluation failed; no message was generated.",
            })),
            error: "Candidate relevance evaluation failed.",
          },
          outreach_drafts: [],
        },
      });
      continue;
    }

    const selectedAssessments = assessments.filter(
      (assessment) => assessment.relevanceScore >= relevanceThreshold,
    );
    const assessmentByUrl = new Map(
      selectedAssessments.map((assessment) => [assessment.personLinkedInUrl, assessment]),
    );
    const peopleByUrl = new Map(
      allPeople.map((person) => [person.linkedInUrl, person]),
    );
    const selectedPeople = selectedAssessments.map(
      (assessment) => peopleByUrl.get(assessment.personLinkedInUrl)!,
    );

    let research: OutreachResearchResult = fallbackResearch(current.domain);
    if (selectedPeople.length > 0) try {
      research = await run.stage(
        {
          name: "outreach_research",
          companyDomain: current.domain,
          provider: "tavily",
          input: {
            company_name: companyName,
            company_domain: current.domain,
            icp,
          },
        },
        () => dependencies.research({
          companyName,
          companyDomain: current.domain,
          icp,
        }),
      );
      researchedCompanies += 1;
    } catch {
      failedResearches += 1;
    }

    const drafts: PersonalizedOutreach[] = [];
    const selectedUrls = new Set(
      selectedPeople.map((person) => person.linkedInUrl),
    );
    for (const person of selectedPeople) {
      try {
        const draft = await run.stage(
          {
            name: "outreach_drafting",
            companyDomain: current.domain,
            provider: "google",
            input: {
              company_domain: current.domain,
              person_linkedin_url: person.linkedInUrl,
            },
          },
          () => dependencies.draft({
            company: companyContext(current),
            person,
            assessment: assessmentByUrl.get(person.linkedInUrl)!,
            research,
          }),
        );
        drafts.push(draft);
        draftedMessages += 1;
      } catch {
        failedDrafts += 1;
      }
    }

    run.saveProfile({
      domain: current.domain,
      companyUrl: current.companyUrl,
      profile: {
        ...value,
        outreach_research: research,
        outreach_selection: {
          relevance_threshold: relevanceThreshold,
          evaluations: assessments,
          selected_person_linkedin_urls: [...selectedUrls],
          excluded: assessments
            .filter((assessment) => !selectedUrls.has(assessment.personLinkedInUrl))
            .map((assessment) => ({
              person_linkedin_url: assessment.personLinkedInUrl,
              reason: `Relevance score ${assessment.relevanceScore} is below the ${relevanceThreshold} threshold. ${assessment.rationale}`,
            })),
        },
        outreach_drafts: drafts,
      },
    });
  }

  return {
    evaluatedCompanies,
    failedEvaluations,
    researchedCompanies,
    failedResearches,
    draftedMessages,
    failedDrafts,
  };
}

function companyContext(profile: CompanyProfile): OutreachDraftInput["company"] {
  const value = objectValue(profile.profile);
  const qualification = objectValue(value.qualification);
  return {
    name: textValue(value.name) ?? profile.domain,
    domain: profile.domain,
    event: textValue(value.event),
    qualificationRationale:
      textValue(qualification.rationale) ?? "This company is a qualified Tedlar lead.",
    qualificationEvidence: stringArray(qualification.evidence),
  };
}

function decisionMakers(profile: CompanyProfile): DecisionMaker[] {
  const parsed = decisionMakerSchema.array().safeParse(
    objectValue(profile.profile).decision_makers,
  );
  return parsed.success
    ? parsed.data.filter((person) =>
        companyDomainsMatch(person.companyDomain, profile.domain),
      )
    : [];
}

function fallbackResearch(companyDomain: string): OutreachResearchResult {
  return {
    researched_at: new Date().toISOString(),
    query: "",
    request_id: "",
    company_domain: companyDomain,
    evidence: [],
    warnings: [
      "Company signal research failed; this draft uses role and qualification context only.",
    ],
  };
}

function objectValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

async function main(): Promise<void> {
  const sourceRunId = Number(process.argv[2]);
  if (!Number.isInteger(sourceRunId) || sourceRunId < 1) {
    console.error("Usage: npm run outreach -- <completed decision-maker run ID>");
    process.exitCode = 2;
    return;
  }

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!tavilyApiKey || !geminiApiKey) {
    console.error(
      "Set TAVILY_API_KEY and GOOGLE_GENERATIVE_AI_API_KEY before generating outreach.",
    );
    process.exitCode = 2;
    return;
  }

  const database = new PipelineDatabase();
  try {
    const execution = startOutreachPipeline(database, sourceRunId, {
      evaluate: (input) => evaluateOutreachCandidates(geminiApiKey, input),
      research: (input) => researchOutreachSignals(tavilyApiKey, input),
      draft: (input) => draftPersonalizedOutreach(geminiApiKey, input),
    });
    const result = await execution.completion;
    console.log(
      `Outreach run ${result.runId} completed from run ${sourceRunId}: ` +
        `${result.draftedMessages} messages drafted across ${result.importedCompanies} companies.`,
    );
    console.log(`Open /runs/${result.runId}?tab=people in the dashboard.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
